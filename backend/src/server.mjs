import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMIT = 64 * 1024;
const reply = (res, code, data, extra = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
};
const hash = value => createHash('sha256').update(value).digest();
const authorized = (header, secret) => {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(hash(header.slice(7)), hash(secret));
};
const validState = state => state && typeof state === 'object' && !Array.isArray(state)
  && (state.decks === undefined || (Array.isArray(state.decks) && state.decks.length <= 4))
  && (state.mixer === undefined || (state.mixer && typeof state.mixer === 'object' && !Array.isArray(state.mixer)));
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 100;
function parseProject(body) {
  if (!body || !validName(body.name) || !validState(body.state)) return null;
  const name = body.name.trim();
  const state = body.state;
  if (Buffer.byteLength(JSON.stringify(state)) > 48 * 1024) return null;
  return { name, state };
}

export function createProjectApi({ dbPath, token, allowedOrigin = 'http://localhost:5173' }) {
  if (!dbPath) throw new Error('DJZET_DB_PATH wymagany');
  if (!token || token.length < 24) throw new Error('DJZET_API_TOKEN musi mieć min. 24 znaki');
  const dbFile = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);');
  const all = db.prepare('SELECT id,name,revision,created_at AS createdAt,updated_at AS updatedAt FROM projects ORDER BY updated_at DESC LIMIT 100');
  const get = db.prepare('SELECT id,name,state_json,revision,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE id=?');
  const insert = db.prepare('INSERT INTO projects (id,name,state_json,revision,created_at,updated_at) VALUES (?,?,?,1,?,?)');
  const update = db.prepare('UPDATE projects SET name=?,state_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?');
  const remove = db.prepare('DELETE FROM projects WHERE id=? AND revision=?');
  const readBody = async req => {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > LIMIT) { const error = new Error('Payload za duży'); error.status = 413; throw error; }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { const error = new Error('Nieprawidłowy JSON'); error.status = 400; throw error; }
  };
  const view = row => row ? { id: row.id, name: row.name, state: JSON.parse(row.state_json), revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return reply(res, origin === allowedOrigin ? 204 : 403, {});
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/healthz' && req.method === 'GET') return reply(res, 200, { ok: true, service: 'djzet-project-api', version: 1 });
    if (!path.startsWith('/api/v1/projects')) return reply(res, 404, { error: 'NOT_FOUND' });
    if (origin && origin !== allowedOrigin) return reply(res, 403, { error: 'ORIGIN_BLOCKED' });
    if (!authorized(req.headers.authorization, token)) return reply(res, 401, { error: 'UNAUTHORIZED' });
    const projectMatch = path.match(/^\/api\/v1\/projects\/([0-9a-f-]{36})$/i);
    try {
      if (path === '/api/v1/projects' && req.method === 'GET') return reply(res, 200, { projects: all.all() });
      if (path === '/api/v1/projects' && req.method === 'POST') {
        const payload = parseProject(await readBody(req));
        if (!payload) return reply(res, 422, { error: 'INVALID_PROJECT' });
        const id = randomUUID(), now = new Date().toISOString();
        insert.run(id, payload.name, JSON.stringify(payload.state), now, now);
        return reply(res, 201, { project: view(get.get(id)) });
      }
      if (projectMatch) {
        const id = projectMatch[1]; const current = get.get(id);
        if (!current) return reply(res, 404, { error: 'NOT_FOUND' });
        if (req.method === 'GET') return reply(res, 200, { project: view(current) });
        if (req.method === 'PUT' || req.method === 'DELETE') {
          const rev = Number(req.headers['if-match']);
          if (!Number.isSafeInteger(rev) || rev < 1) return reply(res, 428, { error: 'REVISION_REQUIRED' });
          if (rev !== current.revision) return reply(res, 409, { error: 'REVISION_CONFLICT', revision: current.revision });
          if (req.method === 'DELETE') { remove.run(id, rev); return reply(res, 200, { deleted: true, id }); }
          const payload = parseProject(await readBody(req));
          if (!payload) return reply(res, 422, { error: 'INVALID_PROJECT' });
          update.run(payload.name, JSON.stringify(payload.state), new Date().toISOString(), id, rev);
          return reply(res, 200, { project: view(get.get(id)) });
        }
      }
      return reply(res, 405, { error: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET, POST, PUT, DELETE' });
    } catch (error) {
      return reply(res, error.status ?? 500, { error: error.status ? error.message : 'INTERNAL_ERROR' });
    }
  });
  return { server, close: () => { server.close(); db.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createProjectApi({ dbPath: process.env.DJZET_DB_PATH ?? './data/djzet.sqlite', token: process.env.DJZET_API_TOKEN, allowedOrigin: process.env.DJZET_ALLOWED_ORIGIN ?? 'http://localhost:5173' });
  const host = process.env.DJZET_HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8787);
  app.server.listen(port, host, () => console.log('DJ ZET API gotowe: http://' + host + ':' + port));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { app.close(); process.exit(0); });
}
