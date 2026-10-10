// Draws the gift card: backdrop + symbol pattern (same geometry as t.me/nft), animated gift, captions.
// Everything is laid out in the page's own 420×280 space and scaled.

export const BASE_W = 420;
export const BASE_H = 280;
const GIFT = { x: 129, y: 30, size: 162 };      // .tgme_gift_model_wrap on t.me
const GRADIENT_R = 195;                          // the page's elliptical radialGradient resolves to a 195px circle
const FONT = '"SF Pro Display", "SF Pro Text", -apple-system, system-ui, Inter, "Segoe UI", Roboto, sans-serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tint(img, color) {
  const c = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function drawBackground(g, s, gift, symbolImg) {
  const cx = BASE_W / 2 * s, cy = BASE_H / 2 * s;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, GRADIENT_R * s);
  grad.addColorStop(0, gift.colors.center);
  grad.addColorStop(1, gift.colors.edge);
  g.fillStyle = grad;
  g.fillRect(0, 0, BASE_W * s, BASE_H * s);
  if (!symbolImg) return;
  const sym = tint(symbolImg, gift.colors.pattern);
  for (const p of gift.pattern) {
    g.globalAlpha = p.opacity;
    g.drawImage(sym, p.x * s, p.y * s, p.size * s, p.size * s);
  }
  g.globalAlpha = 1;
}

// ctx.roundRect is missing in Safari < 16 and Firefox < 112.
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function rarityFor(gift, which) {
  if (which === 'none') return '';
  return (gift[which] && gift[which].rarity) || '';
}

function drawCaptions(g, s, gift, opts) {
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';

  // Title: "Money Pot" + dimmed " #56380", shrunk if a long name would overflow.
  let size = 20;
  const name = gift.title;
  const num = `#${gift.number}`;
  let wName, wGap, wNum;
  for (;;) {
    g.font = `700 ${size * s}px ${FONT}`;
    wName = g.measureText(name).width;
    wGap = g.measureText(' ').width;
    g.font = `600 ${size * s}px ${FONT}`;
    wNum = g.measureText(num).width;
    if (wName + wGap + wNum <= 390 * s || size <= 12) break;
    size -= 0.5;
  }
  const titleBase = 221 * s;
  let x = (BASE_W * s - (wName + wGap + wNum)) / 2;
  g.font = `700 ${size * s}px ${FONT}`;
  g.fillText(name, x, titleBase);
  g.globalAlpha = 0.6;
  g.font = `600 ${size * s}px ${FONT}`;
  g.fillText(num, x + wName + wGap, titleBase);
  g.globalAlpha = 1;

  // Subtitle: "Name · [rarity]" — the name of whichever attribute the chip shows (model by default).
  const attr = (opts.rarity !== 'none' && gift[opts.rarity]?.name) ? gift[opts.rarity] : gift.model;
  const model = attr.name;
  const rarity = rarityFor(gift, opts.rarity);
  const midY = 244.5 * s;
  const gap = 7 * s;
  g.textBaseline = 'middle';
  g.font = `600 ${12.5 * s}px ${FONT}`;
  const wModel = g.measureText(model).width;
  g.font = `700 ${12.5 * s}px ${FONT}`;
  const wDot = rarity && model ? g.measureText('·').width : 0;
  g.font = `600 ${11.5 * s}px ${FONT}`;
  const wRar = rarity ? g.measureText(rarity).width : 0;
  const chipW = rarity ? wRar + 14 * s : 0;
  const chipH = 18.5 * s;
  const parts = [model ? wModel : 0, wDot, chipW].filter(Boolean);
  const total = parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1);
  x = (BASE_W * s - total) / 2;

  if (model) {
    g.globalAlpha = 0.92;
    g.font = `600 ${12.5 * s}px ${FONT}`;
    g.fillText(model, x, midY);
    x += wModel + gap;
  }
  if (wDot) {
    g.globalAlpha = 0.6;
    g.font = `700 ${12.5 * s}px ${FONT}`;
    g.fillText('·', x, midY);
    x += wDot + gap;
  }
  if (rarity) {
    g.globalAlpha = 0.45;
    g.strokeStyle = '#fff';
    g.lineWidth = 1 * s;
    roundRectPath(g, x + 0.5 * s, midY - chipH / 2 + 0.5 * s, chipW - s, chipH - s, (chipH - s) / 2);
    g.stroke();
    g.globalAlpha = 0.95;
    g.font = `600 ${11.5 * s}px ${FONT}`;
    g.fillText(rarity, x + 7 * s, midY + 0.5 * s);
  }
  g.globalAlpha = 1;
}

export async function ensureFonts() {
  if (!document.fonts) return;
  await Promise.all(['600 20px Inter', '700 20px Inter'].map(f => document.fonts.load(f).catch(() => {})));
}

// One renderer per output size. drawFrame() paints a full card for the given lottie frame.
export class CardRenderer {
  constructor({ gift, symbolImg, lottieData }, width, opts = {}) {
    this.s = width / BASE_W;
    this.width = Math.round(BASE_W * this.s);
    this.height = Math.round(BASE_H * this.s);
    this.gift = gift;
    this.opts = { ...opts, rarity: opts.rarity || 'model' };

    this.bg = makeCanvas(this.width, this.height);
    drawBackground(this.bg.getContext('2d'), this.s, gift, symbolImg);
    this.captions = makeCanvas(this.width, this.height);
    if (this.opts.captions !== false) drawCaptions(this.captions.getContext('2d'), this.s, gift, this.opts);

    const giftPx = Math.round(GIFT.size * this.s);
    this.giftCanvas = makeCanvas(giftPx, giftPx);
    this.anim = window.lottie.loadAnimation({
      renderer: 'canvas',
      loop: false,
      autoplay: false,
      // Deep copy: lottie mutates animationData, and several renderers can share one gift.
      animationData: JSON.parse(JSON.stringify(lottieData)),
      rendererSettings: { context: this.giftCanvas.getContext('2d'), clearCanvas: true, dpr: 1, preserveAspectRatio: 'xMidYMid meet' },
    });
    this.fps = lottieData.fr || 60;
    this.totalFrames = Math.max(1, Math.round((lottieData.op || 60) - (lottieData.ip || 0)));
  }

  drawGift(frame) {
    this.anim.goToAndStop(frame, true);
  }

  drawFrame(ctx, frame) {
    this.drawGift(frame);
    ctx.drawImage(this.bg, 0, 0);
    const s = this.s;
    ctx.drawImage(this.giftCanvas, GIFT.x * s, GIFT.y * s, GIFT.size * s, GIFT.size * s);
    ctx.drawImage(this.captions, 0, 0);
  }

  // Most gift animations end exactly where they start; then the last frame duplicates frame 0
  // and is dropped for a seamless loop. Compare against the normal last motion step so a real
  // (moving) final frame is kept.
  loopFrames() {
    if (this._loopFrames) return this._loopFrames;
    const n = this.totalFrames;
    if (n < 3) return (this._loopFrames = n);
    const probe = (f) => {
      this.drawGift(f);
      const c = makeCanvas(64, 64);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(this.giftCanvas, 0, 0, 64, 64);
      return g.getImageData(0, 0, 64, 64).data;
    };
    const diff = (x, y) => { let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / x.length; };
    const first = probe(0), last = probe(n - 1), prev = probe(n - 2);
    this._loopFrames = diff(first, last) < 0.02 + 0.25 * diff(prev, last) ? n - 1 : n;
    return this._loopFrames;
  }

  destroy() {
    this.anim.destroy();
  }
}
