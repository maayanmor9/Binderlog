// Builds public/index/cards.json from TCGdex. Stores fingerprints and links, not card images.
// Run with: npm run build:index
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { encodeSig, signature } from "../src/lib/hash";

const API = "https://api.tcgdex.net/v2/en";
const CACHE = ".cache/images";

async function json(url: string) {
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (i === 3) throw new Error(`${r.status} ${url}`);
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
  }
}

async function image(id: string, base: string): Promise<Buffer | null> {
  const file = path.join(CACHE, `${id.replace(/[^\w.-]/g, "_")}.webp`);
  try { return await readFile(file); } catch { /* not cached */ }
  const r = await fetch(`${base}/low.webp`);
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  await writeFile(file, b);
  return b;
}

await mkdir(CACHE, { recursive: true });
await mkdir("public/index", { recursive: true });

const sets: any[] = await json(`${API}/sets`);
const setName = new Map(sets.map((s) => [s.id, s.name]));
const briefs: any[] = await json(`${API}/cards`);
const withImage = briefs.filter((c) => c.image);
console.log(`${briefs.length} cards listed, ${withImage.length} with images`);

const out: any[] = [];
let next = 0, failed = 0;
await Promise.all(Array.from({ length: 16 }, async () => {
  while (next < withImage.length) {
    const c = withImage[next++];
    try {
      const b = await image(c.id, c.image);
      if (!b) { failed++; continue; }
      const { data, info } = await sharp(b).ensureAlpha().resize(256, 358, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
      const setId = c.id.slice(0, c.id.lastIndexOf("-"));
      out.push({ id: c.id, name: c.name, number: c.localId, setId, setName: setName.get(setId) ?? setId, image: `${c.image}/low.webp`, h: encodeSig(signature({ data, width: info.width, height: info.height })) });
    } catch (e) { failed++; console.warn(c.id, String(e)); }
    if (next % 1000 === 0) console.log(next);
  }
}));

if (out.length < 1000) throw new Error(`Only ${out.length} cards indexed, keeping the previous index`);
out.sort((a, b) => a.id.localeCompare(b.id));
await writeFile("public/index/cards.json", JSON.stringify({ demo: false, generatedAt: new Date().toISOString(), cards: out }));
console.log(`Indexed ${out.length}, failed ${failed}`);
