import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAppearance} from '../client/src/theme.ts';
test('appearance preferences allow only supported modes and accents',()=>{
  assert.deepEqual(parseAppearance(null),{mode:'system',accent:'green'});
  assert.deepEqual(parseAppearance({mode:'dark',accent:'purple'}),{mode:'dark',accent:'purple'});
  assert.deepEqual(parseAppearance({mode:'invalid',accent:'url(evil)'}),{mode:'system',accent:'green'});
  assert.deepEqual(parseAppearance({mode:['dark'],accent:['purple']}),{mode:'system',accent:'green'});
});
