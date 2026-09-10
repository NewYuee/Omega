import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {ImageStore,IMAGE_TTL,MAX_IMAGE_BYTES,imageInfo} from '../images.mjs';
import {historyPage} from '../history.mjs';

async function fixture() {
  let now = 1_800_000_000_000;
  const root = await mkdtemp(path.join(tmpdir(),'omega-image-test-'));
  const store = new ImageStore(path.join(root,'images'),()=>now);
  await store.initialize();
  const png = await sharp({create:{width:80,height:40,channels:3,background:'#235e4d'}}).png().toBuffer();
  return {root,store,png,advance:ms=>{now+=ms;}};
}
test('images normalize, make small thumbnails and resolve only owned local inputs',async () => {
  const {store,png} = await fixture();
  const image=await store.upload(png,'image/png');
  const original=await store.resolve(image.id), thumb=await store.resolve(image.id,true);
  assert.equal((await sharp(original).metadata()).format,'jpeg');
  assert.ok((await sharp(thumb).metadata()).width<=320);
  assert.equal((await lstat(original)).mode & 0o777,0o600);
  assert.equal(image.expiresAt-image.createdAt,IMAGE_TTL);
  const input=await store.turnInput([{type:'text',text:'What is this?'}],[image.id]);
  assert.deepEqual(input[1],{type:'localImage',path:original});
  assert.deepEqual(store.fromContent(input),[imageInfo(image.id)]);
  assert.deepEqual(store.fromContent([{type:'localImage',path:'/etc/passwd'}]),[]);
  await assert.rejects(store.turnInput([],['../../etc/passwd']));
  await assert.rejects(store.turnInput([{type:'localImage',path:'/etc/passwd'}],[]));
  await assert.rejects(store.turnInput([],[image.id,image.id]));
  assert.equal((await store.turnInput([],[image.id])).length,1);
  const history=historyPage({id:'t',turns:[{id:'turn',items:[{id:'u',type:'userMessage',content:input}]}]}, {},item=>store.fromContent(item.content));
  assert.equal(history.turn.items[0].images[0].id,image.id);
  assert.ok(!JSON.stringify(history).includes(original));
  const restarted = new ImageStore(store.directory,()=>image.createdAt); await restarted.initialize();
  assert.equal(await restarted.resolve(image.id),original);
});
test('invalid, unsupported, oversized and excessive-pixel uploads leave no files',async () => {
  const {store,png}=await fixture();
  await assert.rejects(store.upload(Buffer.from('<svg/>'),'image/svg+xml'));
  await assert.rejects(store.upload(Buffer.from('not a png'),'image/png'));
  await assert.rejects(store.upload(Buffer.alloc(MAX_IMAGE_BYTES+1),'image/png'));
  const large=await sharp({create:{width:5001,height:5000,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(store.upload(large,'image/png'));
  assert.deepEqual(await readdir(store.directory),[]);
  assert.ok(png.length);
});
test('cleanup deletes only owned expired original and thumbnail, survives restart, ignores symlinks',async () => {
  const {root,store,png,advance}=await fixture();
  const old=await store.upload(png,'image/png');
  advance(IMAGE_TTL-1);
  assert.ok(await store.resolve(old.id));
  const young=await store.upload(png,'image/png');
  const outside=path.join(root,'keep.jpg'); await writeFile(outside,'keep');
  const linkId=old.createdAt+'-00000000-0000-4000-8000-000000000000';
  await symlink(outside,store.file(linkId));
  await writeFile(path.join(store.directory,'notes.txt'),'keep');
  advance(1);
  await assert.rejects(store.resolve(old.id),e=>e.status===410);
  await assert.rejects(store.turnInput([],[old.id]),e=>e.status===410);
  assert.equal(await store.cleanup(),2);
  assert.ok(await store.resolve(young.id));
  assert.equal(await readFile(outside,'utf8'),'keep');
  assert.ok((await lstat(store.file(linkId))).isSymbolicLink());
  assert.ok((await readdir(store.directory)).includes('notes.txt'));
  assert.equal(await store.cleanup(),0);
});
