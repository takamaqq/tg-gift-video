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

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/proxy') {
    const slug = url.searchParams.get('slug') || '';
    if (!SLUG_RE.test(slug)) { res.writeHead(400); return res.end('bad slug'); }
    const r = await fetch(`https://t.me/nft/${slug}`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(await r.text());
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
