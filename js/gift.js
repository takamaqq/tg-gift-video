// Fetching and parsing a collectible gift page (https://t.me/nft/<slug>).
import { PROXY_URL } from '../config.js';

const XLINK = 'http://www.w3.org/1999/xlink';

export class GiftError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Accepts https://t.me/nft/Slug-123, t.me/nft/Slug-123, tg://nft?slug=Slug-123 or just Slug-123.
export function parseSlug(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:\/nft\/|[?&]slug=)([A-Za-z0-9]+-\d+)/) || s.match(/^([A-Za-z0-9]+-\d+)$/);
  return m ? m[1] : null;
}

function proxyCandidates(slug) {
  const list = [];
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') list.push(`/proxy?slug=${slug}`);
  if (PROXY_URL) list.push(`${PROXY_URL.replace(/\/+$/, '')}/?slug=${slug}`);
  // Public fallbacks: flaky, used only if the own worker is missing or down.
  const target = encodeURIComponent(`https://t.me/nft/${slug}`);
  list.push(`https://api.allorigins.win/raw?url=${target}`);
  list.push(`https://api.codetabs.com/v1/proxy?quest=${target}`);
  return list;
}

async function fetchGiftHtml(slug) {
  let sawTelegramPage = false;
  for (const url of proxyCandidates(slug)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.includes('giftGradient')) return html;
      if (html.includes('tgme_page')) sawTelegramPage = true;
    } catch { /* try next */ }
  }
  if (sawTelegramPage) throw new GiftError('NOT_FOUND', 'Подарок не найден. Проверь ссылку — нужен улучшенный (NFT) подарок.');
  throw new GiftError('PROXY', 'Не получилось загрузить страницу подарка. Проверь PROXY_URL в config.js (см. README).');
}

function parseTranslate(t) {
  const m = String(t || '').match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
}

function parseScale(t) {
  const m = String(t || '').match(/scale\(\s*([-\d.]+)/);
  return m ? parseFloat(m[1]) : 1;
}

function parseAttrRow(td) {
  if (!td) return null;
  const mark = td.querySelector('mark');
  const rarity = mark ? mark.textContent.trim() : '';
  const clone = td.cloneNode(true);
  clone.querySelector('mark')?.remove();
  return { name: clone.textContent.replace(/\s+/g, ' ').trim(), rarity };
}

export function parseGiftHtml(html, slug) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const tm = ogTitle.match(/^(.*?)\s*#\s*([\d\s]+)\s*$/);
  const slugName = slug.replace(/-\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  const title = (tm ? tm[1] : ogTitle) || slugName;
  const number = tm ? tm[2].replace(/\s+/g, '') : slug.split('-').pop();

  const stops = [...doc.querySelectorAll('#giftGradient stop')].map(s => s.getAttribute('stop-color'));
  if (stops.length < 2) throw new GiftError('NOT_FOUND', 'На странице нет данных подарка.');
  const patternColor =
    doc.getElementById('giftGradienPatternColor')?.getAttribute('flood-color') ||
    doc.querySelector('[flood-color]')?.getAttribute('flood-color') || '#000000';

  const patternImg = doc.getElementById('giftPattern');
  const symbolUrl = patternImg?.getAttributeNS(XLINK, 'href') || patternImg?.getAttribute('xlink:href') || patternImg?.getAttribute('href') || '';
  const imgSize = parseFloat(patternImg?.getAttribute('width')) || 100;

  const pattern = [...doc.querySelectorAll('#fullPattern > g')].map(g => {
    const [x, y] = parseTranslate(g.getAttribute('transform'));
    const scale = parseScale(g.querySelector('use')?.getAttribute('transform'));
    return { x, y, size: imgSize * scale, opacity: parseFloat(g.getAttribute('opacity') || '1') };
  });

  const tgsUrl = doc.querySelector('source[type="application/x-tgsticker"]')?.getAttribute('srcset') || '';
  if (!tgsUrl) throw new GiftError('NOT_FOUND', 'У подарка нет анимации (tgs).');

  const attrs = {};
  for (const tr of doc.querySelectorAll('.tgme_gift_table tr')) {
    const key = tr.querySelector('th')?.textContent.trim().toLowerCase();
    const val = parseAttrRow(tr.querySelector('td'));
    if (key === 'model' || key === 'модель') attrs.model = val;
    else if (key === 'backdrop' || key === 'фон') attrs.backdrop = val;
    else if (key === 'symbol' || key === 'узор' || key === 'символ') attrs.symbol = val;
  }

  return {
    slug, title, number,
    colors: { center: stops[0], edge: stops[stops.length - 1], pattern: patternColor },
    symbolUrl, pattern, tgsUrl,
    model: attrs.model || { name: '', rarity: '' },
    backdrop: attrs.backdrop || { name: '', rarity: '' },
    symbol: attrs.symbol || { name: '', rarity: '' },
  };
}

async function loadImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

async function loadTgs(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

export async function loadGift(input) {
  const slug = parseSlug(input);
  if (!slug) throw new GiftError('BAD_LINK', 'Не похоже на ссылку подарка. Пример: https://t.me/nft/MoneyPot-56380');
  const gift = parseGiftHtml(await fetchGiftHtml(slug), slug);
  const [symbolImg, lottieData] = await Promise.all([
    gift.symbolUrl ? loadImage(gift.symbolUrl).catch(() => null) : null,
    loadTgs(gift.tgsUrl).catch(() => { throw new GiftError('TGS', 'Не удалось скачать анимацию подарка. Попробуй ещё раз.'); }),
  ]);
  return { gift, symbolImg, lottieData };
}
