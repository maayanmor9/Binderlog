// Perceptual card signature. Pure TypeScript so the index builder (Node)
// and the scanner (browser) produce identical results.

export interface Pixels {
  data: Uint8Array | Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export const SIG_BYTES = 8 + 32 + 48;

function resample(p: Pixels, x0: number, y0: number, x1: number, y1: number, w: number, h: number) {
  const out = new Float64Array(w * h * 3);
  const sx = (x1 - x0) / w;
  const sy = (y1 - y0) / h;
  for (let j = 0; j < h; j++) {
    const ya = Math.floor(y0 + j * sy);
    const yb = Math.max(ya + 1, Math.floor(y0 + (j + 1) * sy));
    for (let i = 0; i < w; i++) {
      const xa = Math.floor(x0 + i * sx);
      const xb = Math.max(xa + 1, Math.floor(x0 + (i + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = ya; y < yb && y < p.height; y++) {
        for (let x = xa; x < xb && x < p.width; x++) {
          const k = (y * p.width + x) * 4;
          r += p.data[k]; g += p.data[k + 1]; b += p.data[k + 2]; n++;
        }
      }
      const o = (j * w + i) * 3;
      out[o] = r / (n || 1); out[o + 1] = g / (n || 1); out[o + 2] = b / (n || 1);
    }
  }
  return out;
}

function gray(rgb: Float64Array) {
  const out = new Float64Array(rgb.length / 3);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  return out;
}

function pHash(g: Float64Array, n = 32) {
  const low = 8;
  const coef = new Float64Array(low * low);
  const cos: number[][] = [];
  for (let u = 0; u < low; u++) {
    cos.push([]);
    for (let x = 0; x < n; x++) cos[u].push(Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)));
  }
  for (let v = 0; v < low; v++) {
    for (let u = 0; u < low; u++) {
      let s = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) s += g[y * n + x] * cos[u][x] * cos[v][y];
      coef[v * low + u] = s;
    }
  }
  const sorted = Array.from(coef.slice(1)).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const out = new Uint8Array(8);
  for (let i = 0; i < 64; i++) if (coef[i] > med) out[i >> 3] |= 1 << (i & 7);
  return out;
}

function dHash(g: Float64Array, w: number, h: number) {
  const out = new Uint8Array(32);
  let bit = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++, bit++) {
      if (g[y * w + x] > g[y * w + x + 1]) out[bit >> 3] |= 1 << (bit & 7);
    }
  }
  return out;
}

/** Signature for a flattened, upright card image. */
export function signature(p: Pixels): Uint8Array {
  // Trim the outer border, which varies with crop accuracy.
  const mx = p.width * 0.04, my = p.height * 0.03;
  const whole = gray(resample(p, mx, my, p.width - mx, p.height - my, 32, 32));
  // The artwork window carries most of what separates one card from another.
  const ax0 = p.width * 0.08, ax1 = p.width * 0.92, ay0 = p.height * 0.11, ay1 = p.height * 0.52;
  const art = gray(resample(p, ax0, ay0, ax1, ay1, 17, 16));
  const colorRaw = resample(p, ax0, ay0, ax1, ay1, 4, 4);
  let mean = 0;
  for (const v of colorRaw) mean += v;
  mean = mean / colorRaw.length || 1;
  const color = new Uint8Array(48);
  for (let i = 0; i < 48; i++) color[i] = Math.min(255, Math.round((colorRaw[i] / mean) * 128));

  const out = new Uint8Array(SIG_BYTES);
  out.set(pHash(whole), 0);
  out.set(dHash(art, 17, 16), 8);
  out.set(color, 40);
  return out;
}

export function rotate180(p: Pixels): Pixels {
  const d = new Uint8ClampedArray(p.data.length);
  const n = p.width * p.height;
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = (n - 1 - i) * 4;
    d[a] = p.data[b]; d[a + 1] = p.data[b + 1]; d[a + 2] = p.data[b + 2]; d[a + 3] = p.data[b + 3];
  }
  return { data: d, width: p.width, height: p.height };
}

const POP = new Uint8Array(256);
for (let i = 1; i < 256; i++) POP[i] = POP[i >> 1] + (i & 1);

/** 0 is identical; about 0.5 is unrelated. */
export function distance(a: Uint8Array, b: Uint8Array): number {
  let ph = 0, dh = 0, c = 0;
  for (let i = 0; i < 8; i++) ph += POP[a[i] ^ b[i]];
  for (let i = 8; i < 40; i++) dh += POP[a[i] ^ b[i]];
  for (let i = 40; i < 88; i++) c += Math.abs(a[i] - b[i]);
  return 0.4 * (ph / 64) + 0.45 * (dh / 240) + 0.15 * Math.min(1, c / (48 * 80));
}

export function encodeSig(s: Uint8Array): string {
  let b = "";
  for (const v of s) b += String.fromCharCode(v);
  return btoa(b);
}

export function decodeSig(t: string): Uint8Array {
  const b = atob(t);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export interface Ranked<T> { item: T; dist: number }

export function rank<T>(sigs: Uint8Array[], items: T[], query: Uint8Array[], k: number): Ranked<T>[] {
  const scored = items.map((item, i) => {
    let dist = 1;
    for (const q of query) dist = Math.min(dist, distance(q, sigs[i]));
    return { item, dist };
  });
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, k);
}

export type Confidence = "high" | "low";

export function confidence(list: Ranked<unknown>[]): Confidence {
  if (list.length < 2) return "low";
  return list[0].dist < 0.27 && list[1].dist - list[0].dist > 0.06 ? "high" : "low";
}
