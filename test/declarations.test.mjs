import test from 'node:test';
import assert from 'node:assert/strict';
import {declaredVariables} from './helpers/declarations.mjs';

test('state boundary checks bindings, not same-line property reads or comments',async()=>{
  const bindings=await declaredVariables("async function copy(){let text='',offset=0;const part=result.turn?.items?.find(x=>x.id);text+=part.text;} // let items = []\nconst label='let selectedTurn';");
  assert.deepEqual(bindings.map(b=>b.name),['text','offset','part','label']);
});
test('state boundary detects multiline declarations, multiple bindings and destructuring',async()=>{
  const bindings=await declaredVariables('let text="",\n items: string[]=[]; const {source: selectedTurn,...rest}=value; var [historyMode]=values;');
  for(const name of ['items','selectedTurn','historyMode'])assert.ok(bindings.some(b=>b.name===name));
});
