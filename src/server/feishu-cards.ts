const plain=(content:string)=>({tag:'plain_text',content});
// Escape model/user content so it cannot create @all or external image tags in a card.
const safe=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('!','&#33;');
// Bound serialized card size, including escaping; split on lines where possible.
// Reopen fenced code on continuation pages without changing the source contents.
export function feishuAnswerPages(text:string){
  const pages:string[]=[];let page='',fence='',bytes=0;
  const size=(value:string)=>Buffer.byteLength(JSON.stringify(safe(value)))-2;
  const flush=()=>{pages.push(page+(fence?'\n'+fence:''));page=fence?fence+'\n':'';bytes=size(page);};
  for(const line of (text||'任务已结束，没有文本结果。').match(/[^\n]*\n|[^\n]+$/g)||[]){
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(page&&bytes+size(line)>18000)flush();
    for(const char of line){
      const n=size(char);if(bytes+n>18000)flush();
      page+=char;bytes+=n;
    }
    if(marker)fence=fence?(marker[1][0]===fence[0]&&marker[1].length>=fence.length?'':fence):marker[1];
  }
  if(page)pages.push(page+(fence?'\n'+fence:''));
  return pages;
}
export function feishuAnswerCard(title:string,text:string,question:string,omegaUrl?:string){
  const elements:any[]=[{tag:'markdown',content:safe(text)}];
  if(omegaUrl)elements.push({tag:'button',text:plain('打开 Omega'),type:'default',behaviors:[{type:'open_url',default_url:omegaUrl}]});
  return{schema:'2.0',config:{update_multi:true,enable_forward:false,width_mode:'default',summary:{content:title}},
    header:{title:plain(title),subtitle:plain(Array.from(question.replace(/\s+/g,' ')).slice(0,80).join('')),template:title.includes('完成')?'green':title.includes('失败')?'red':'blue',icon:{tag:'standard_icon',token:'todo_colorful'}},
    body:{direction:'vertical',vertical_spacing:'12px',elements}};
}
export function feishuCard(title:string,text:string,actionId:string,decision?:any,omegaUrl?:string){
  const elements:any[]=[{tag:'markdown',content:safe(text.slice(0,6000))}];
  if(decision){
    elements.push({tag:'form',name:'decision',elements:[
      {tag:'select_static',name:'choice',required:true,placeholder:plain('请选择方案'),options:[...decision.options.map((o:any)=>({text:plain(o.label.slice(0,100)),value:o.id})),...(decision.allowOther?[{text:plain('其他方案'),value:'other'}]:[])]},
      {tag:'input',name:'note',input_type:'multiline_text',max_length:1000,label:plain('补充说明（选其他时请填写具体方案）')},
      {tag:'button',name:actionId,text:plain('提交决定'),type:'primary_filled',width:'fill',form_action_type:'submit'}
    ]});
  }else elements.push({tag:'button',text:plain('停止任务'),type:'danger',behaviors:[{type:'callback',value:{actionId}}]});
  if(omegaUrl)elements.push({tag:'button',text:plain('打开 Omega'),type:'default',behaviors:[{type:'open_url',default_url:omegaUrl}]});
  return{schema:'2.0',config:{update_multi:true,enable_forward:false,width_mode:'default'},header:{title:plain(title),template:decision?'wathet':'blue',icon:{tag:'standard_icon',token:'todo_colorful'}},body:{direction:'vertical',vertical_spacing:'12px',elements}};
}
