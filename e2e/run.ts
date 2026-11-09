// End-to-end check using invented cards photographed at an angle on a background.
import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import sharp from "sharp";
await mkdir("e2e/out", { recursive: true });

// Places a card on a dark textured background with a perspective-like rotation.
async function photo(src: string, out: string, angle: number) {
  const card = await sharp(src).resize(700).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).modulate({ brightness: 0.92 }).png().toBuffer();
  await sharp({ create: { width: 1500, height: 1900, channels: 3, background: { r: 52, g: 44, b: 40 } } })
    .composite([{ input: card, gravity: "center" }]).jpeg({ quality: 88 }).withMetadata({ exif: { IFD3: { GPSLatitude: "32/1 0/1 0/1" } } }).toFile(out);
}
const srv = spawn("npx", ["vite", "preview", "--port", "4173"], { stdio: "ignore", detached: true });
await new Promise((r) => setTimeout(r, 2500));
const fail: string[] = [];
const check = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fail.push(m); };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, "page error: " + e.message));
  await page.route("https://api.tcgdex.net/**", (r) => {
    const n = r.request().url().split("-").pop();
    r.fulfill({ json: { name: `Sample Beast ${n}`, localId: n, rarity: n === "12" ? "Rare" : "Common", category: "Creature", types: ["Fire"], hp: 120, illustrator: "Test Artist", set: { id: "demo", name: "Sample Set" }, variants: { normal: true, reverse: true, holo: false, firstEdition: false },
      pricing: { cardmarket: { updated: "2026-11-01T00:00:00Z", unit: "EUR", trend: 4, avg30: 3.5, low: 2, "trend-holo": 9 }, tcgplayer: { updated: "2026-11-01T00:00:00Z", unit: "USD", normal: { lowPrice: 3, marketPrice: 5 } } } } });
  });
  await page.goto("http://localhost:4173/");
  const total = 12, hits: boolean[] = [];
  for (const [i, n] of [12, 3, 27].entries()) {
    const f = `e2e/out/p${n}.jpg`; await photo(`e2e/assets/card-${n}.png`, f, [7, -11, 3][i]);
    await page.getByRole("button", { name: /^Scan/ }).first().click();
    await page.getByTestId("front").setInputFiles(f);
    await page.getByRole("heading", { name: /your card|Which card/ }).waitFor({ timeout: 60000 });
    if (i === 0) await page.screenshot({ path: "e2e/out/match.png" });
    const first = await page.locator(".cand b").first().innerText();
    hits.push(first === `Sample Beast ${n}`);
    check(first === `Sample Beast ${n}`, `identified card ${n} (got ${first})`);
    await page.locator(".cand").first().click();
    await page.getByRole("button", { name: /Next: photograph/ }).click();
    await page.getByTestId("back").setInputFiles("e2e/assets/back.png");
    await page.getByRole("button", { name: "Save card" }).click();
    await page.getByRole("button", { name: "Back to collection" }).waitFor();
    if (i === 0) {
      await page.screenshot({ path: "e2e/out/detail.png", fullPage: true });
      check(await page.getByRole("cell", { name: "TCGplayer" }).count() > 0 && await page.getByRole("cell", { name: "Cardmarket" }).count() > 0, "both price sources shown");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      check(await page.locator(".photo img").getAttribute("alt") === `Sample Beast 12, back`, "back photo shown");
    }
    await page.getByRole("button", { name: "Back to collection" }).click();
  }
  await page.waitForSelector(".tile");
  check(await page.locator(".tile").count() === 3, "three cards in collection");
  check((await page.getByTestId("total").innerText()).includes("15"), "TCGplayer total is 15");
  await page.getByRole("button", { name: "Cardmarket" }).click();
  check((await page.getByTestId("total").innerText()).includes("12"), "Cardmarket total is 12");
  await page.getByRole("button", { name: /^Filter/ }).click();
  await page.getByLabel("Rarity").selectOption("Rare");
  check(await page.locator(".tile").count() === 1, "rarity filter narrows to one");
  await page.screenshot({ path: "e2e/out/list.png", fullPage: true });
  const exifFree = await page.evaluate(async () => {
    const d: any = await new Promise((res) => { const r = indexedDB.open("binderlog"); r.onsuccess = () => res(r.result); });
    const keys: string[] = await new Promise((res) => { const q = d.transaction("photos").objectStore("photos").getAllKeys(); q.onsuccess = () => res(q.result); });
    const k = keys.find((x) => x.endsWith("front:original"))!;
    const b: Blob = await new Promise((res) => { const q = d.transaction("photos").objectStore("photos").get(k); q.onsuccess = () => res(q.result); });
    return { count: keys.length, exif: new TextDecoder("latin1").decode(await b.arrayBuffer()).includes("Exif"), size: b.size };
  });
  check(exifFree.count === 18, `18 stored photo files (${exifFree.count})`);
  check(!exifFree.exif, "metadata removed from stored photo");
  await writeFile("e2e/out/result.json", JSON.stringify({ hits, exifFree, total }));
} catch (e) { fail.push(String(e)); console.error(e); }
await browser.close();
try { process.kill(-srv.pid!); } catch {}
if (fail.length) { console.log("FAILED", fail); process.exit(1); }
console.log("ALL PASSED");
process.exit(0);
