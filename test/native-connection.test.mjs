import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeServer,apiUrl,parseProfile} from '../native/connection.js';

test('native server addresses require explicit plaintext consent and reject embedded credentials',()=>{
  assert.equal(normalizeServer(' https://omega.example.com/ '),'https://omega.example.com');
  assert.equal(normalizeServer('http://127.0.0.1:4310',true),'http://127.0.0.1:4310');
  for(const value of ['http://omega.example.com','file:///tmp','javascript:alert(1)','https://key@omega.example.com','https://omega.example.com/path','https://omega.example.com/?key=secret','https://omega.example.com/#secret']) {
    assert.throws(()=>normalizeServer(value));
  }
});
test('native fetch routes cannot change origin or escape API paths',()=>{
  const server='https://omega.example.com';
  assert.equal(apiUrl(server,'/api/events?threadId=abc'),server+'/api/events?threadId=abc');
  assert.equal(apiUrl(server,'/api/images/abc-123?size=thumb'),server+'/api/images/abc-123?size=thumb');
  for(const route of ['https://evil.example/api/status','//evil.example/api/status','/api/../private','/api/%2e%2e/private','/api/images/../../x','/api/status#x','/api/status\\foo'])assert.throws(()=>apiUrl(server,route));
});
test('stored native profiles are validated before loading or sending credentials',()=>{
  assert.equal(parseProfile(null),null);
  assert.deepEqual(parseProfile('{"serverUrl":"https://omega.example.com","key":"test-only"}'),{serverUrl:'https://omega.example.com',key:'test-only',allowHttp:false});
  for(const profile of ['{}','null','{"serverUrl":"http://omega.example.com","key":"test"}','{"serverUrl":"https://omega.example.com","key":""}'])assert.throws(()=>parseProfile(profile));
});
