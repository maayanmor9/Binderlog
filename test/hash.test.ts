import { describe, expect, it } from "vitest";
import { decodeSig, distance, encodeSig, rank, rotate180, signature, type Pixels } from "../src/lib/hash";
function img(seed: number, noise = 0): Pixels {
  const width = 256, height = 358, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = (y * width + x) * 4, n = noise ? (Math.random() - .5) * noise : 0;
    data[k] = 128 + 100 * Math.sin((x + seed * 13) / (9 + seed % 7)) + n;
    data[k + 1] = 128 + 100 * Math.cos((y * (1 + seed % 3)) / 17) + n;
    data[k + 2] = 128 + 100 * Math.sin((x + y) / (11 + seed % 5)) + n;
    data[k + 3] = 255;
  }
  return { data, width, height };
}
describe("signature", () => {
  it("round-trips", () => { const s = signature(img(1)); expect(decodeSig(encodeSig(s))).toEqual(s); });
  it("is near for noisy copy, far for other card", () => {
    const a = signature(img(1));
    expect(distance(a, signature(img(1, 30)))).toBeLessThan(.12);
    expect(distance(a, signature(img(5)))).toBeGreaterThan(.25);
  });
  it("finds an upside-down card", () => {
    const sigs = [1, 2, 3, 4, 5].map((s) => signature(img(s)));
    const p = rotate180(img(3));
    expect(rank(sigs, [1, 2, 3, 4, 5], [signature(p), signature(rotate180(p))], 1)[0].item).toBe(3);
  });
});
