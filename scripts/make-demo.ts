// Generates invented sample cards, so the app and tests work without the real index.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { encodeSig, signature } from "../src/lib/hash";

let seed = 7;
const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
const color = () => `hsl(${rnd(360)},${40 + rnd(50)}%,${30 + rnd(40)}%)`;
const W = 630, H = 880;

export function cardSvg(i: number) {
  let art = "";
  for (let k = 0; k < 14; k++) art += `<circle cx="${60 + rnd(510)}" cy="${110 + rnd(340)}" r="${15 + rnd(90)}" fill="${color()}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="26" fill="#efd25a"/><rect x="24" y="24" width="582" height="832" rx="14" fill="${color()}"/><text x="48" y="78" font-size="38" font-family="sans-serif" font-weight="700">Sample Beast ${i}</text><svg x="50" y="100" width="530" height="360" viewBox="50 100 530 360"><rect x="50" y="100" width="530" height="360" fill="${color()}"/>${art}</svg><rect x="50" y="490" width="530" height="300" fill="#fff" opacity=".75"/><text x="70" y="550" font-size="28" font-family="sans-serif">Attack ${rnd(200)}</text><text x="60" y="835" font-size="22" font-family="sans-serif">${i}/40</text></svg>`;
}

const backSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="26" fill="#1f4fa3"/><circle cx="315" cy="440" r="170" fill="#c9412f"/><circle cx="315" cy="440" r="60" fill="#f5f0dc"/></svg>`;

await mkdir("e2e/assets", { recursive: true });
await mkdir("public/index/demo", { recursive: true });
const cards = [];
for (let i = 1; i <= 40; i++) {
  const png = await sharp(Buffer.from(cardSvg(i))).png().toBuffer();
  await writeFile(`e2e/assets/card-${i}.png`, png);
  const web = await sharp(png).resize(245).webp({ quality: 70 }).toBuffer();
  await writeFile(`public/index/demo/${i}.webp`, web);
  const { data, info } = await sharp(png).ensureAlpha().resize(256, 358, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  cards.push({ id: `demo-${i}`, name: `Sample Beast ${i}`, number: String(i), setId: "demo", setName: "Sample Set", image: `index/demo/${i}.webp`, h: encodeSig(signature({ data, width: info.width, height: info.height })) });
}
await writeFile("e2e/assets/back.png", await sharp(Buffer.from(backSvg)).png().toBuffer());
await writeFile("public/index/cards.json", JSON.stringify({ demo: true, generatedAt: new Date().toISOString(), cards }));

const icon = (s: number) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100"><rect width="100" height="100" fill="#17594a"/><rect x="31" y="20" width="44" height="62" rx="5" fill="#f4c542" transform="rotate(10 53 51)"/><rect x="25" y="20" width="44" height="62" rx="5" fill="#fffdf8"/></svg>`)).png().toBuffer();
await writeFile("public/icon-192.png", await icon(192));
await writeFile("public/icon-512.png", await icon(512));
console.log("demo ready");
