import { loadGift, parseSlug } from './gift.js';
import { CardRenderer, ensureFonts } from './card.js';
import { encodeMp4, encodeGif, renderPng, canEncodeMp4 } from './encode.js';

const $ = (id) => document.getElementById(id);
const form = $('form'), linkInput = $('link'), loadBtn = $('load'), statusEl = $('status');
const studio = $('studio'), preview = $('preview'), facts = $('facts');
const progress = $('progress'), bar = $('bar'), ptext = $('ptext'), cancelBtn = $('cancel');
const result = $('result'), media = $('media'), download = $('download');
const actionBtns = [...document.querySelectorAll('.act')];

const settingBtns = [...document.querySelectorAll('#rarity button, #size button')];

const state = { assets: null, rarity: 'model', size: 1920, previewR: null, raf: 0, job: null, resultUrl: null, loadSeq: 0 };

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function bindSeg(id, key, onChange) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    state[key] = key === 'size' ? Number(b.dataset.v) : b.dataset.v;
    onChange?.();
  });
}

function renderFacts(gift) {
  const item = (label, v) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = v.name || '—';
    if (v.rarity) { const s = document.createElement('span'); s.textContent = v.rarity; dd.append(s); }
    d.append(dt, dd);
    return d;
  };
  facts.replaceChildren(item('Модель', gift.model), item('Фон', gift.backdrop), item('Символ', gift.symbol));
}

function startPreview() {
  cancelAnimationFrame(state.raf);
  state.previewR?.destroy();
  const cssW = preview.clientWidth || 600;
  const width = Math.min(1260, Math.round(cssW * Math.min(2, devicePixelRatio || 1)));
  const r = new CardRenderer(state.assets, width, { rarity: state.rarity });
  state.previewR = r;
  preview.width = r.width;
  preview.height = r.height;
  const ctx = preview.getContext('2d');
  const loop = r.loopFrames();
  const t0 = performance.now();
  const tick = (t) => {
    if (state.previewR !== r) return;
    r.drawFrame(ctx, Math.floor(((t - t0) / 1000) * r.fps) % loop);
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function clearResult() {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultUrl = null;
  media.replaceChildren();
  download.removeAttribute('href');
  download.removeAttribute('download');
  download.textContent = 'Скачать';
  result.hidden = true;
}

async function load(input) {
  const slug = parseSlug(input);
  if (!slug) { setStatus('Не похоже на ссылку подарка. Пример: https://t.me/nft/MoneyPot-56380', true); return; }
  const seq = ++state.loadSeq;
  loadBtn.disabled = true;
  setStatus('Загружаю подарок…');
  try {
    const [assets] = await Promise.all([loadGift(slug), ensureFonts()]);
    if (seq !== state.loadSeq) return; // a newer load started meanwhile
    state.job?.abort();
    state.assets = assets;
    const { gift } = assets;
    clearResult();
    renderFacts(gift);
    studio.hidden = false;
    startPreview();
    setStatus(`${gift.title} #${gift.number}`);
    history.replaceState(null, '', `?gift=${encodeURIComponent(slug)}`);
    window.__gift = gift; // handy for debugging
  } catch (e) {
    if (seq !== state.loadSeq) return;
    console.error(e);
    setStatus(e.message || 'Что-то пошло не так.', true);
  } finally {
    if (seq === state.loadSeq) loadBtn.disabled = false;
  }
}

function showResult(blob, kind, slug) {
  clearResult();
  const url = URL.createObjectURL(blob);
  state.resultUrl = url;
  let el;
  if (kind === 'gif' || kind === 'png') {
    el = document.createElement('img');
    el.alt = 'Результат';
  } else {
    el = document.createElement('video');
    Object.assign(el, { autoplay: true, loop: true, muted: true, playsInline: true, controls: true });
  }
  el.src = url;
  media.append(el);
  const ext = kind === 'gif' ? 'gif' : kind === 'png' ? 'png' : 'mp4';
  const suffix = kind === 'mp4' ? '-loop' : kind === 'mp4long' ? '-loop-30s' : kind === 'gif' ? '-loop' : '';
  download.href = url;
  download.download = `${slug}${suffix}.${ext}`;
  download.textContent = `Скачать ${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)} МБ`;
  result.hidden = false;
  window.__lastResult = { kind, blob };
}

async function make(kind) {
  const assets = state.assets;
  if (!assets || state.job) return;
  if ((kind === 'mp4' || kind === 'mp4long') && !canEncodeMp4()) {
    setStatus('Этот браузер не умеет делать MP4. Открой в Chrome, Edge или Safari 17+, или скачай GIF.', true);
    return;
  }
  const ctrl = new AbortController();
  state.job = ctrl;
  [...actionBtns, ...settingBtns].forEach(b => (b.disabled = true));
  progress.hidden = kind === 'png';
  bar.style.width = '0%'; ptext.textContent = '0%';
  const onProgress = (p) => { const v = Math.round(p * 100); bar.style.width = `${v}%`; ptext.textContent = `${v}%`; };
  const common = { rarity: state.rarity, onProgress, signal: ctrl.signal };
  setStatus('Рендерю…');
  try {
    let blob;
    if (kind === 'mp4') blob = await encodeMp4(assets, { ...common, width: state.size, repeats: 1 });
    else if (kind === 'mp4long') blob = await encodeMp4(assets, { ...common, width: state.size, repeats: 10 });
    else if (kind === 'gif') blob = await encodeGif(assets, { ...common, width: 960 });
    else blob = await renderPng(assets, { width: state.size, rarity: state.rarity });
    if (state.assets !== assets) return; // another gift was loaded meanwhile
    showResult(blob, kind, assets.gift.slug);
    setStatus('Готово.');
  } catch (e) {
    if (state.assets !== assets) return;
    if (e.name === 'AbortError') setStatus('Отменено.');
    else { console.error(e); setStatus(e.message || 'Не получилось отрендерить.', true); }
  } finally {
    state.job = null;
    progress.hidden = true;
    [...actionBtns, ...settingBtns].forEach(b => (b.disabled = false));
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); load(linkInput.value); });
linkInput.addEventListener('paste', (e) => {
  const text = (e.clipboardData?.getData('text') || '').trim();
  if (!parseSlug(text)) return;
  e.preventDefault();
  linkInput.value = text;
  load(text);
});
cancelBtn.addEventListener('click', () => state.job?.abort());
actionBtns.forEach(b => b.addEventListener('click', () => make(b.dataset.kind)));
bindSeg('rarity', 'rarity', () => { if (state.assets) { clearResult(); startPreview(); } });
bindSeg('size', 'size');

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.assets) return;
    const w = Math.min(1260, Math.round((preview.clientWidth || 600) * Math.min(2, devicePixelRatio || 1)));
    if (Math.abs(w - preview.width) > 2) startPreview(); // ignore height-only changes (mobile toolbars)
  }, 200);
});

const initial = new URLSearchParams(location.search).get('gift');
if (initial) {
  const slug = parseSlug(initial);
  linkInput.value = slug ? `https://t.me/nft/${slug}` : initial;
  load(initial);
}
