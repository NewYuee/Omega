import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function loadRuntime(){
  const result=await build({entryPoints:['client/src/SessionRuntime.ts'],bundle:true,write:false,platform:'node',format:'esm'});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
}

test('timeline state owns hydration, pagination, deltas and metrics',async()=>{
  const{createTimeline}=await loadRuntime(),timeline=createTimeline(),version=timeline.beginThread();
  const request=timeline.hydrationRequest();
  assert.equal(request.version,version);
  assert.equal(timeline.applyHydration({outline:[{id:'t1',label:'一'},{id:'t2',label:'二'}],nextCursor:'older',turn:{id:'t2',items:[{id:'a',type:'agentMessage',pageText:'hello'}],metrics:{elapsedMs:1000,running:false,usage:{inputTokens:4,outputTokens:2,totalTokens:6}}}},request.version,request.metricsRevision),true);
  timeline.finishHydration(request.version);
  assert.equal(timeline.view(false).items[0].pageText,'hello');
  assert.match(timeline.view(false).metrics,/输入 4.*输出 2 tokens/);

  timeline.receiveAgentDelta('a',' world');
  assert.equal(timeline.view(false).items[0].text,'hello world');
  timeline.receiveCommandDelta('missing','ignored');
  assert.equal(timeline.selectTurn(0),true);
  assert.equal(timeline.historyMode,true);

  const older=timeline.pageRequest('older');
  assert.equal(older.cursor,'older');
  assert.equal(timeline.applyPage('older',{outline:[{id:'old',label:'旧'}],nextCursor:null},older.cursor),true);
  assert.equal(timeline.selectedTurn,'old');
  assert.equal(timeline.historyCursor,'older');
});
