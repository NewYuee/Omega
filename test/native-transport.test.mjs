import test from 'node:test';
import assert from 'node:assert/strict';
import {requestNative} from '../native/transport.js';
test('native requests explicitly suppress WebView Origin without dropping authorization or abort',async()=>{
  const controller=new AbortController();
  for(const headers of [{authorization:'Bearer test-only'},new Headers({authorization:'Bearer test-only',origin:'tauri://localhost'})]) {
    const options={headers,signal:controller.signal,method:'POST',body:'{}',maxRedirections:5};
    await requestNative(async(url,sent)=>{
      assert.equal(url,'http://127.0.0.1:4310/api/rpc');
      assert.equal(sent.headers.origin,'');
      assert.equal(sent.headers.authorization,'Bearer test-only');
      assert.equal(sent.signal,controller.signal);
      assert.equal(sent.body,'{}');
      assert.equal(sent.maxRedirections,0);
    },'http://127.0.0.1:4310/api/rpc',options);
    assert.equal(options.maxRedirections,5);
  }
});
