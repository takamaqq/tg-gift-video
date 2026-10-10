// Cloudflare Worker: tiny read-only proxy for https://t.me/nft/<slug>.
// Browsers can't read t.me pages directly (no CORS headers), so the site asks this worker.
// Only gift slugs are accepted, so it can't be used as an open proxy.
//
// Responses:
//   200 — the gift page (cached for 30 min)
//   404 — t.me redirected away: no such gift
//   503 — t.me served its generic page: unknown gift or rate limit (never cached)
//   502 — t.me unreachable

const SLUG_RE = /^[A-Za-z0-9]{1,64}-\d{1,9}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const reply = (body, status, extra = {}) =>
  new Response(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...extra } });

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return reply('method not allowed', 405);

    const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
    if (!SLUG_RE.test(slug)) return reply('bad slug', 400);

    const cache = caches.default;
    const cacheKey = new Request(`https://gift-cache.local/nft/${slug}`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let upstream, body;
    try {
      upstream = await fetch(`https://t.me/nft/${slug}`, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      body = await upstream.text();
    } catch {
      return reply('upstream error', 502);
    }

    if (upstream.status >= 300 && upstream.status < 400) return reply('not found', 404);
    if (!upstream.ok || !body.includes('giftGradient')) return reply('telegram did not return gift data', 503);

    const response = new Response(body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/html; charset=utf-8',
        // The sticker link inside the page carries a token, so don't keep it too long.
        'Cache-Control': 'public, max-age=1800',
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
