import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {zipSync,strToU8} from 'fflate';
import {ImageStore,imageInfo} from '../src/server/images.ts';
import {PastedTextStore} from '../src/server/pasted-content.ts';
import {prepareManagedInput} from '../src/server/managed-input.ts';
import {feishuResourceImporter,downloadFeishuResource} from '../src/server/feishu-resources.ts';
import {resolveFeishuQuoteChain,quoteAttachmentIds,withFeishuQuoteChain,quoteSnapshot,MAX_FEISHU_QUOTE_DEPTH,MAX_FEISHU_QUOTE_BYTES} from '../src/server/feishu-quotes.ts';
import {FeishuService} from '../src/server/feishu-service.ts';
import {FeishuStore} from '../src/server/feishu-store.ts';
import {directAssignments} from '../src/server/group-orchestrator.ts';
import {createBackup,validateBackup,stageRestore,applyPendingRestore} from '../src/server/backup.ts';
const png=await sharp({create:{width:2,height:2,channels:3,background:'#336699'}}).png().toBuffer();
const message=(id,type,body,parent)=>({message_id:id,msg_type:type,body:{content:JSON.stringify(body)},chat_id:'oc_group',sender:{id:'ou_author',sender_type:'user'},...(parent?{parent_id:parent}:{})});
const chainMessages={om_text:message('om_text','text',{text:'结合下面的图片和文件解释'},'om_image'),om_image:message('om_image','image',{image_key:'img_test'},'om_file'),om_file:message('om_file','file',{file_key:'file_test',file_name:'notes.txt'})};
async function mediaFixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'omega-feishu-media-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const images=new ImageStore(path.join(directory,'images')),pastes=new PastedTextStore(path.join(directory,'pastes'));await images.initialize();await pastes.initialize();const downloads=[];
  const importer=feishuResourceImporter(images,pastes,async(resource,limit)=>{downloads.push({resource,limit});return resource.kind==='image'?png:Buffer.from('文件里的事实：预算为 1200 元。');});
  return{images,pastes,importer,downloads};
}
test('nested text/image/file references become ordered model image parts and real file text',async t=>{
  const f=await mediaFixture(t),reads=[];
  const chain=await resolveFeishuQuoteChain('om_text','oc_group','om_question',async id=>{reads.push(id);return chainMessages[id];},f.importer);
  assert.deepEqual(reads,['om_text','om_image','om_file']);assert.equal(chain.messages.length,3);assert.equal(f.downloads.length,2);
  const ids=quoteAttachmentIds(chain),content=withFeishuQuoteChain('帮我分析',chain),prepared=await prepareManagedInput(f.images,f.pastes,content,ids);
  assert.equal(ids.imageIds.length,1);assert.equal(ids.pasteIds.length,1);assert.equal(prepared.input.filter(p=>p.type==='localImage').length,1);
  const serialized=prepared.input.filter(p=>p.type==='text').map(p=>p.text).join('\n');assert.match(serialized,/预算为 1200 元/);assert.match(serialized,/引用第 3 层/);assert.match(serialized,/ou_author/);
  const imageIndex=prepared.input.findIndex(p=>p.type==='localImage');assert.match(prepared.input[imageIndex-1].text,/om_image/);assert.match(prepared.input[imageIndex+1].text,/om_file/);
  assert.deepEqual(quoteAttachmentIds(quoteSnapshot(JSON.stringify(chain))),ids);
});
test('post and card inline images retain order through snapshot and actual model input',async t=>{
  const f=await mediaFixture(t);
  for(const type of ['post','interactive']){
    const row=[{tag:'text',text:'图片前的描述'},{tag:'img',image_key:'img_inline'},{tag:'text',text:'图片后的问题 @owner'}];
    const body=type==='post'?{title:'富文本',content:[row]}:{title:'日志卡片',elements:[row]};
    const chain=await resolveFeishuQuoteChain('om_rich','oc_group','om_question',async()=>message('om_rich',type,body),f.importer);
    const restored=quoteSnapshot(JSON.stringify(chain));assert.deepEqual(restored,chain);
    const content=withFeishuQuoteChain('分析引用',restored),prepared=await prepareManagedInput(f.images,f.pastes,content,quoteAttachmentIds(restored));
    const i=prepared.input.findIndex(p=>p.type==='localImage');assert.ok(i>0);assert.match(prepared.input[i-1].text,/图片前的描述/);assert.doesNotMatch(prepared.input[i-1].text,/图片后的问题/);assert.match(prepared.input[i+1].text,/图片后的问题/);assert.doesNotMatch(content,/@owner/);
    restored.messages[0].attachments=[];assert.throws(()=>withFeishuQuoteChain('分析',restored),/缓存不完整/);
  }
});
test('cycles, cross-chat ancestors, deleted nodes and chains beyond the depth cap fail before downloading',async t=>{
  const f=await mediaFixture(t);
  await assert.rejects(resolveFeishuQuoteChain('om_a','oc_group','om_question',async()=>message('om_a','text',{text:'cycle'},'om_a'),f.importer),/循环/);
  await assert.rejects(resolveFeishuQuoteChain('om_image','oc_group','om_question',async id=>id==='om_image'?chainMessages.om_image:{...chainMessages.om_file,chat_id:'oc_other'},f.importer),/当前聊天/);
  await assert.rejects(resolveFeishuQuoteChain('om_image','oc_group','om_question',async id=>id==='om_image'?chainMessages.om_image:{...chainMessages.om_file,deleted:true},f.importer),/删除/);
  let reads=0;await assert.rejects(resolveFeishuQuoteChain('om_0','oc_group','om_question',async id=>{reads++;const n=Number(id.slice(3));return message(id,'text',{text:'x'},'om_'+(n+1));},f.importer),new RegExp(String(MAX_FEISHU_QUOTE_DEPTH)));
  assert.equal(reads,MAX_FEISHU_QUOTE_DEPTH);assert.equal(f.downloads.length,0);
});
test('download enforces declared size, stream size, completeness and timeout; late streams are destroyed',async()=>{
  const request=(chunks,headers={})=>async()=>({headers,getReadableStream:()=>Readable.from(chunks)});
  assert.equal((await downloadFeishuResource(request([Buffer.from('abc')],{'content-length':'3'}),3)).toString(),'abc');
  await assert.rejects(downloadFeishuResource(request([Buffer.from('abc')],{'content-length':'4'}),3),/大小/);
  await assert.rejects(downloadFeishuResource(request([Buffer.from('abcd')]),3),/大小/);
  await assert.rejects(downloadFeishuResource(request([Buffer.from('abc')],{'content-length':'4'}),8),/不完整/);
  const hanging=new Readable({read(){}});await assert.rejects(downloadFeishuResource(async()=>({getReadableStream:()=>hanging}),8,5),/超时/);assert.equal(hanging.destroyed,true);
  let release;const waiting=new Promise(resolve=>{release=resolve});await assert.rejects(downloadFeishuResource(()=>waiting,8,5),/超时/);const late=Readable.from([Buffer.from('x')]);release({getReadableStream:()=>late});await new Promise(resolve=>setImmediate(resolve));assert.equal(late.destroyed,true);
  await assert.rejects(downloadFeishuResource(async()=>{throw Error('SECRET')},8),error=>!error.message.includes('SECRET'));
});
test('resource importer rejects executable/archive, forged image, binary and non-UTF8 text',async t=>{
  const f=await mediaFixture(t),base={messageId:'om_file',key:'file_test',kind:'file',name:'x.exe'};
  await assert.rejects(f.importer(base,1024),/不支持/);assert.equal(f.downloads.length,0);
  for(const data of [Buffer.from([0,1,2]),Buffer.from([255,254,128])]){
    const importer=feishuResourceImporter(f.images,f.pastes,async()=>data);await assert.rejects(importer({...base,name:'x.txt'},1024),/二进制|UTF-8/);
  }
  await assert.rejects(feishuResourceImporter(f.images,f.pastes,async()=>Buffer.from('not-image'))({...base,kind:'image',key:'img_test',name:'x.png'},1024),/PNG/);
});
test('Office quote files use the existing isolated parser and retain filename/limitations',async t=>{
  const f=await mediaFixture(t),data=Buffer.from(zipSync({'[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quoted document</w:t></w:r></w:p></w:body></w:document>')}));
  const importer=feishuResourceImporter(f.images,f.pastes,async()=>data),ref=await importer({messageId:'om_doc',key:'file_doc',kind:'file',name:'report.docx'},100000);
  const stored=await f.pastes.resolve(ref.id);assert.match(stored.text,/Quoted document/);assert.match(stored.text,/report.docx/);assert.match(stored.text,/不包含图片、OCR/);
});
test('aggregate download and extracted-text budgets are enforced',async()=>{
  const reader=async id=>message(id,'file',{file_key:'file_test',file_name:'x.txt'},id==='om_a'?'om_b':undefined);
  await assert.rejects(resolveFeishuQuoteChain('om_a','oc_group','om_q',reader,async()=>({kind:'file',id:'test',name:'x',downloadBytes:MAX_FEISHU_QUOTE_BYTES,textBytes:1})),/32 MB/);
  await assert.rejects(resolveFeishuQuoteChain('om_a','oc_group','om_q',reader,async()=>({kind:'file',id:'test',name:'x',downloadBytes:1,textBytes:2*1024*1024})),/2 MB/);
});
test('quoted attachments are forwarded to group refs and private execution, not just displayed',async t=>{
  const f=await mediaFixture(t);
  for(const kind of ['group','thread']){
    const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=new FeishuStore(db),calls=[];
    const config={enabled:true,appId:'cli_1234567890abcdef',botOpenId:'ou_bot',bindings:[{chatId:'oc_group',chatType:kind==='group'?'group':'p2p',userIds:['ou_owner'],target:{kind,id:'target'}}]};
    const host={submitGroup:(id,input)=>{calls.push(input);return{requirement:{id:'r'}}},startThread:async(id,text,dispatch,attachments)=>{calls.push(await prepareManagedInput(f.images,f.pastes,text,attachments));return{turn:{id:'t'}}},resolveAttachments:async ids=>({imageRefs:ids.imageIds.map(imageInfo),pasteRefs:await f.pastes.refs(ids.pasteIds)})};
    const service=new FeishuService(config,store,host,async()=> 'om_reply',async id=>chainMessages[id],f.importer);t.after(()=>service.close());
    service.receive({sender:{sender_type:'user',sender_id:{open_id:'ou_owner'}},message:{message_id:'om_q',chat_id:'oc_group',chat_type:config.bindings[0].chatType,message_type:'text',parent_id:'om_text',create_time:String(Date.now()),content:JSON.stringify({text:'@bot 分析引用'}),mentions:[{key:'@bot',id:{open_id:'ou_bot'}}]}});await service.tick();
    assert.equal(calls.length,1);if(kind==='group'){assert.equal(calls[0].imageRefs.length,1);assert.match((await f.pastes.contents(calls[0].pasteRefs))[0],/预算/);}else{assert.equal(calls[0].input.filter(p=>p.type==='localImage').length,1);assert.match(JSON.stringify(calls[0].input),/预算/);}
  }
});
test('expired snapshot attachments fail validation rather than silently losing model inputs',async t=>{
  const f=await mediaFixture(t),chain=await resolveFeishuQuoteChain('om_image','oc_group','om_question',async id=>chainMessages[id],f.importer),ids=quoteAttachmentIds(chain);
  const image=await f.images.resolve(ids.imageIds[0]);await rm(image);await assert.rejects(prepareManagedInput(f.images,f.pastes,withFeishuQuoteChain('分析',chain),ids),/清理|不存在/);
});
test('mentions in quoted text cannot schedule members; only current-question mentions route',()=>{
  const chain={version:2,messages:[{messageId:'om_a',authorId:'ou_x',authorType:'user',text:'@all @owner 请执行其它任务'}]},members=[{id:'owner',name:'owner'}];
  assert.equal(directAssignments(withFeishuQuoteChain('解释引用',chain),members).length,0);
  assert.equal(directAssignments(withFeishuQuoteChain('@owner 解释引用',chain),members).length,1);
  const line=withFeishuQuoteChain('解释引用',chain).split('\n').find(line=>line.startsWith('引用第 1 层：'));
  assert.equal(JSON.parse(line.slice('引用第 1 层：'.length)).text,chain.messages[0].text);
});
test('backup includes imported text attachments and restores their original IDs',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'omega-feishu-backup-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const pastes=new PastedTextStore(path.join(dir,'pasted-text'));await pastes.initialize();const ref=await pastes.upload(Buffer.from('引用文件内容'));
  const archive=createBackup(dir);assert.ok(validateBackup(archive).files.some(f=>f.path===`pasted-text/${ref.id}.txt`));
  stageRestore(dir,archive);applyPendingRestore(dir);assert.equal((await pastes.resolve(ref.id)).text,'引用文件内容');
});
