import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProjectApi } from '../src/server.mjs';
const token = 'djzet-test-token-that-is-long-enough';
const origin = 'http://localhost:5173';
test('DJ ZET projekty: auth, CRUD, revision lock, CORS, walidacja', async () => {
  const app = createProjectApi({ dbPath: ':memory:', token, allowedOrigin: origin });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const req = (path, { method = 'GET', body, authorized = true, rev, useOrigin = origin } = {}) => fetch(url + path, {
    method,
    headers: { ...(authorized ? { Authorization: 'Bearer ' + token } : {}), ...(useOrigin ? { Origin: useOrigin } : {}), ...(body ? { 'Content-Type':'application/json' } : {}), ...(rev === undefined ? {} : { 'If-Match': String(rev) }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await req('/healthz', {authorized:false})).status, 200);
    assert.equal((await req('/api/v1/projects', {authorized:false})).status, 401);
    assert.equal((await req('/api/v1/projects',{useOrigin:'http://evil.example'})).status, 403);
    assert.equal((await req('/api/v1/projects',{method:'POST',body:{name:'',state:{}}})).status, 422);
    const created = await req('/api/v1/projects', {method:'POST',body:{name:'  Set numer 1 ',state:{decks:[{id:1}],mixer:{master:0.8}}}});
    assert.equal(created.status, 201);
    const p = (await created.json()).project;
    assert.equal(p.name, 'Set numer 1');
    assert.equal(p.revision, 1);
    assert.equal((await req('/api/v1/projects')).status, 200);
    const read = await req('/api/v1/projects/'+p.id);
    assert.deepEqual((await read.json()).project.state, {decks:[{id:1}],mixer:{master:0.8}});
    assert.equal((await req('/api/v1/projects/'+p.id, {method:'PUT',body:{name:'Nowy',state:{}}})).status, 428);
    const upd = await req('/api/v1/projects/'+p.id, {method:'PUT',rev:1,body:{name:'Nowy',state:{}}});
    assert.equal(upd.status, 200);
    assert.equal((await upd.json()).project.revision, 2);
    assert.equal((await req('/api/v1/projects/'+p.id,{method:'DELETE',rev:1})).status,409);
    assert.equal((await req('/api/v1/projects/'+p.id,{method:'DELETE',rev:2})).status,200);
    assert.equal((await req('/api/v1/projects/'+p.id)).status,404);
  } finally { app.close(); }
});
