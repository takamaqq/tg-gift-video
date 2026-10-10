// lottie-web's canvas renderer ignores gradient transparency unless the opacity stops sit at the
// same positions as the color stops (see checkCollapsable in lottie-web). Some gift models
// (e.g. Plush Pepe "Pumpkin") break that rule and render hard, opaque blobs.
// This rewrites such gradients so color and opacity share one set of stop positions.

function lerpStops(stops, t) {
  if (t <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, ...a] = stops[i - 1];
      const [p1, ...b] = stops[i];
      const k = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
      return a.map((v, j) => v + (b[j] - v) * k);
    }
  }
  return stops[stops.length - 1].slice(1);
}

// Lottie packs a gradient as [pos,r,g,b]×colorCount followed by [pos,alpha]×n.
function splitStops(arr, colorCount) {
  const color = [], alpha = [];
  for (let i = 0; i < colorCount; i++) color.push(arr.slice(i * 4, i * 4 + 4));
  for (let i = colorCount * 4; i + 1 < arr.length; i += 2) alpha.push([arr[i], arr[i + 1]]);
  return { color, alpha };
}

function isCollapsable({ color, alpha }) {
  return alpha.length === color.length && color.every((s, i) => Math.abs(s[0] - alpha[i][0]) <= 0.01);
}

function fixGradient(g) {
  const n = g.p, k = g.k;
  const frames = k.a ? k.k.filter(f => f.s).map(f => f.s) : [k.k];
  if (!frames.length) return;
  const parts = frames.map(a => splitStops(a, n));
  if (!parts[0].alpha.length || parts.every(isCollapsable)) return;

  const positions = [...new Set(
    parts.flatMap(({ color, alpha }) => [...color.map(s => s[0]), ...alpha.map(s => s[0])]).map(v => +v.toFixed(4)),
  )].sort((a, b) => a - b);
  const rebuild = ({ color, alpha }) => [
    ...positions.flatMap(t => [t, ...lerpStops(color, t)]),
    ...positions.flatMap(t => [t, lerpStops(alpha, t)[0]]),
  ];

  if (k.a) {
    let j = 0;
    for (const f of k.k) {
      if (f.s) f.s = rebuild(parts[j++]);
      if (f.e) f.e = rebuild(splitStops(f.e, n));
    }
  } else {
    k.k = rebuild(parts[0]);
  }
  g.p = positions.length;
}

function walkShapes(items) {
  for (const x of items || []) {
    if ((x.ty === 'gf' || x.ty === 'gs') && x.g) fixGradient(x.g);
    if (x.it) walkShapes(x.it);
  }
}

// Mutates and returns `data`.
export function normalizeGradients(data) {
  for (const layer of data.layers || []) walkShapes(layer.shapes);
  for (const asset of data.assets || []) for (const layer of asset.layers || []) walkShapes(layer.shapes);
  return data;
}
