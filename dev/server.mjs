// Local dev server: serves the site and mimics the Cloudflare Worker at /proxy?slug=...
// Usage: node dev/server.mjs  →  http://localhost:8787
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;
const SLUG_RE = /^[A-Za-z0-9]{1,64}-\d{1,9}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const cache = new Map(); // slug → { html, until }

async function proxy(slug, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };
  if (!SLUG_RE.test(slug)) return send(400, 'bad slug');
  const hit = cache.get(slug);
  if (hit && hit.until > Date.now()) return send(200, hit.html);

  let r, html;
  try {
    r = await fetch(`https://t.me/nft/${slug}`, { redirect: 'manual', headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    html = await r.text();
  } catch {
    return send(502, 'upstream error');
  }
  if (r.status >= 300 && r.status < 400) return send(404, 'not found');
  if (!r.ok || !html.includes('giftGradient')) return send(503, 'telegram did not return gift data');
  cache.set(slug, { html, until: Date.now() + 30 * 60 * 1000 });
  return send(200, html);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/proxy') return await proxy(url.searchParams.get('slug') || '', res);
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    const data = await fs.readFile(file).catch(() => null);
    if (!data) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e instanceof URIError ? 400 : 500);
    res.end(String(e.message || e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}`));
