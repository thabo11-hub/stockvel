// Local development server: serves public/ and sends /api/* to the same handler Vercel runs.
//   npm run dev                       uses DATABASE_URL (Neon) from your environment
//   LOCAL_PG_SOCKET=/var/run/postgresql LOCAL_PG_DB=stokvel npm run dev
//                                     uses a local Postgres over its Unix socket instead
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/index.js';
import { setQuery } from '../lib/db.js';

if (process.env.LOCAL_PG_SOCKET) {
  const { localPg } = await import('./pg-local.mjs');
  setQuery(localPg({
    socketDir: process.env.LOCAL_PG_SOCKET,
    port: Number(process.env.LOCAL_PG_PORT || 5432),
    database: process.env.LOCAL_PG_DB || 'postgres',
    user: process.env.LOCAL_PG_USER || 'postgres',
  }));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', 'public');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

// Send the same security headers as production (vercel.json), so problems show up locally first.
const config = JSON.parse(await readFile(path.join(here, '..', 'vercel.json'), 'utf8'));
const headers = (config.headers || []).filter(h => h.source === '/(.*)').flatMap(h => h.headers);

const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  for (const h of headers) res.setHeader(h.key, h.value);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handler(req, res);
  let file;
  try { file = path.join(root, decodeURIComponent(url.pathname)); }
  catch (e) { res.statusCode = 400; return res.end(); }
  if (file !== root && !file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch (e) {
    res.setHeader('Content-Type', types['.html']);
    res.end(await readFile(path.join(root, 'index.html')));
  }
}).listen(port, () => console.log(`Stokvel is running on http://localhost:${port}`));
