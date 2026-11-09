// Finds a card in a photo and flattens it. OpenCV is loaded only when scanning.
export const CARD_W = 630;
export const CARD_H = 880;

let cvPromise: Promise<any> | null = null;

function loadCv(): Promise<any> {
  cvPromise ??= import("@techstark/opencv-js").then(async (m: any) => {
    let cv = m.default ?? m;
    if (cv instanceof Promise) cv = await cv;
    if (typeof cv.then === "function") {
      const thenable = cv;
      cv = await new Promise((res) => {
        thenable.then((v: any) => { delete v.then; res(v); });
      });
    }
    if (!cv.Mat) await new Promise<void>((res) => { cv.onRuntimeInitialized = () => res(); });
    return cv;
  });
  return cvPromise;
}

type Pt = { x: number; y: number };

function orderCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  sorted.forEach((p, i) => { if (p.x + p.y < sorted[first].x + sorted[first].y) first = i; });
  const o = [0, 1, 2, 3].map((i) => sorted[(first + i) % 4]); // TL, TR, BR, BL
  const top = Math.hypot(o[1].x - o[0].x, o[1].y - o[0].y);
  const side = Math.hypot(o[3].x - o[0].x, o[3].y - o[0].y);
  // A landscape card: rotate the order so the long edge runs top to bottom.
  return top > side ? [o[1], o[2], o[3], o[0]] : o;
}

function validQuad(pts: Pt[]): boolean {
  const o = orderCorners(pts);
  const w = (Math.hypot(o[1].x - o[0].x, o[1].y - o[0].y) + Math.hypot(o[2].x - o[3].x, o[2].y - o[3].y)) / 2;
  const h = (Math.hypot(o[3].x - o[0].x, o[3].y - o[0].y) + Math.hypot(o[2].x - o[1].x, o[2].y - o[1].y)) / 2;
  const ratio = w / h;
  return ratio > 0.58 && ratio < 0.86; // a card is 63 / 88 = 0.716, allowing for perspective
}

export interface Detection {
  found: boolean;
  crop: HTMLCanvasElement;
}

function fallbackCrop(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CARD_W; c.height = CARD_H;
  const scale = Math.max(CARD_W / src.width, CARD_H / src.height);
  const w = CARD_W / scale, h = CARD_H / scale;
  c.getContext("2d")!.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, CARD_W, CARD_H);
  return c;
}

export async function detectCard(src: HTMLCanvasElement): Promise<Detection> {
  const cv = await loadCv();
  const scale = Math.min(1, 900 / Math.max(src.width, src.height));
  const small = document.createElement("canvas");
  small.width = Math.round(src.width * scale);
  small.height = Math.round(src.height * scale);
  small.getContext("2d")!.drawImage(src, 0, 0, small.width, small.height);
  const minArea = small.width * small.height * 0.08;

  const img = cv.imread(small);
  const gray = new cv.Mat(), edges = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  let quad: Pt[] | null = null;
  try {
    cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    for (const [lo, hi] of [[30, 90], [60, 160], [15, 50]]) {
      cv.Canny(gray, edges, lo, hi);
      cv.dilate(edges, edges, kernel);
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      let best = 0;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area > minArea && area > best) {
          const approx = new cv.Mat();
          for (const f of [0.02, 0.04, 0.06]) {
            cv.approxPolyDP(cnt, approx, f * cv.arcLength(cnt, true), true);
            if (approx.rows === 4 && cv.isContourConvex(approx)) {
              const pts: Pt[] = [];
              for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
              if (validQuad(pts)) { quad = pts; best = area; }
              break;
            }
          }
          approx.delete();
        }
        cnt.delete();
      }
      if (quad) break;
    }
  } finally {
    img.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
  }
  if (!quad) return { found: false, crop: fallbackCrop(src) };

  const o = orderCorners(quad).map((p) => ({ x: p.x / scale, y: p.y / scale }));
  const full = cv.imread(src);
  const dst = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, o.flatMap((p) => [p.x, p.y]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CARD_W, 0, CARD_W, CARD_H, 0, CARD_H]);
  const m = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(full, dst, m, new cv.Size(CARD_W, CARD_H), cv.INTER_AREA);
    const crop = document.createElement("canvas");
    crop.width = CARD_W; crop.height = CARD_H;
    cv.imshow(crop, dst);
    return { found: true, crop };
  } finally {
    full.delete(); dst.delete(); from.delete(); to.delete(); m.delete();
  }
}

/** Warn-only check: most English card backs are predominantly blue. */
export function looksLikeBack(c: HTMLCanvasElement): boolean {
  const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  let r = 0, b = 0;
  for (let i = 0; i < data.length; i += 40) { r += data[i]; b += data[i + 2]; }
  return b > r * 1.1;
}
