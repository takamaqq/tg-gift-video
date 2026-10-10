// Cloudflare Worker: tiny read-only proxy for https://t.me/nft/<slug>.
// Browsers can't read t.me pages directly (no CORS headers), so the site asks this worker.
// Only gift slugs are accepted, so it can't be used as an open proxy.

const SLUG_RE = /^[A-Za-z0-9]{1,64}-\d{1,9}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

    const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
    if (!SLUG_RE.test(slug)) return new Response('bad slug', { status: 400, headers: CORS });

    const cache = caches.default;
    const cacheKey = new Request(`https://gift-cache.local/nft/${slug}`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const upstream = await fetch(`https://t.me/nft/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const body = await upstream.text();
    const response = new Response(body, {
      status: upstream.ok ? 200 : upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'text/html; charset=utf-8',
        // The sticker link inside the page carries a token, so keep the cache short.
        'Cache-Control': 'public, max-age=300',
      },
    });
    if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
