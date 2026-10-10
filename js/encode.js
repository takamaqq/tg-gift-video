// In-browser encoders: MP4 via WebCodecs + mp4-muxer, GIF via gifenc, PNG poster.
import { Muxer, ArrayBufferTarget } from 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';
import { GIFEncoder, quantize, applyPalette } from 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm';
import { CardRenderer } from './card.js';

const nextTick = () => new Promise(r => setTimeout(r, 0));

export function canEncodeMp4() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

async function pickAvcConfig(width, height, fps, bitrate) {
  // High → Main → Baseline, levels high enough for 1920×1280@60.
  for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.42e033', 'avc1.640028', 'avc1.42001f']) {
    const config = { codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch { /* next */ }
  }
  throw new Error('Браузер не умеет кодировать H.264. Открой сайт в Chrome, Edge или Safari 17+.');
}

export async function encodeMp4(assets, { width = 1920, repeats = 1, rarity, captions, onProgress, signal } = {}) {
  const r = new CardRenderer(assets, width, { rarity, captions });
  try {
    const { width: W, height: H, fps } = r;
    const loop = r.loopFrames();
    const total = loop * repeats;
    const config = await pickAvcConfig(W, H, fps, W >= 1600 ? 16_000_000 : 8_000_000);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, fastStart: 'in-memory', video: { codec: 'avc', width: W, height: H, frameRate: fps } });
    let failure = null;
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
    encoder.configure(config);

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const frameUs = 1e6 / fps;

    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (failure) throw failure;
      r.drawFrame(ctx, i % loop);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await new Promise(res => setTimeout(res, 1));
      if (i % 6 === 0) { onProgress?.(i / total); await nextTick(); }
    }
    await encoder.flush();
    if (failure) throw failure;
    encoder.close();
    muxer.finalize();
    onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    r.destroy();
  }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);

// Ordered dithering is stable frame to frame, so the gradient doesn't shimmer like error diffusion would.
function dither(data, w, h, amount) {
  for (let y = 0; y < h; y++) {
    const row = (y & 3) * 4;
    for (let x = 0; x < w; x++) {
      const d = BAYER4[row + (x & 3)] * amount;
      const i = (y * w + x) * 4;
      data[i] += d; data[i + 1] += d; data[i + 2] += d;
    }
  }
}

export async function encodeGif(assets, { width = 960, fps = 50, rarity, captions, onProgress, signal } = {}) {
  const r = new CardRenderer(assets, width, { rarity, captions });
  try {
    const { width: W, height: H } = r;
    const seconds = r.loopFrames() / r.fps;
    const count = Math.max(1, Math.round(seconds * fps));
    const delay = Math.round(1000 / fps);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // One global palette from a few sampled frames, so colors don't jump between frames.
    const sw = 240, sh = Math.round(240 * H / W);
    const sample = document.createElement('canvas');
    sample.width = sw; sample.height = sh;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    const samples = 8;
    const pool = new Uint8ClampedArray(sw * sh * 4 * samples);
    for (let k = 0; k < samples; k++) {
      r.drawFrame(ctx, Math.floor(k * r.loopFrames() / samples));
      sctx.drawImage(canvas, 0, 0, sw, sh);
      pool.set(sctx.getImageData(0, 0, sw, sh).data, k * sw * sh * 4);
    }
    const palette = quantize(pool, 256);

    const gif = GIFEncoder();
    for (let k = 0; k < count; k++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      r.drawFrame(ctx, k * r.fps / fps);
      const img = ctx.getImageData(0, 0, W, H);
      dither(img.data, W, H, 6);
      const index = applyPalette(img.data, palette);
      // Palette only on the first frame → becomes the global color table.
      gif.writeFrame(index, W, H, k === 0 ? { palette, delay, repeat: 0 } : { delay });
      if (k % 2 === 0) { onProgress?.(k / count); await nextTick(); }
    }
    gif.finish();
    onProgress?.(1);
    return new Blob([gif.bytes()], { type: 'image/gif' });
  } finally {
    r.destroy();
  }
}

export async function renderPng(assets, { width = 1920, frame = null, rarity, captions } = {}) {
  const r = new CardRenderer(assets, width, { rarity, captions });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = r.width; canvas.height = r.height;
    r.drawFrame(canvas.getContext('2d'), frame ?? Math.floor(r.loopFrames() / 2));
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  } finally {
    r.destroy();
  }
}
