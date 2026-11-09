import { openDB, type DBSchema } from "idb";
import { decodeSig, rank, rotate180, signature, type Pixels, type Ranked } from "./hash";

export type PriceSource = "tcgplayer" | "cardmarket";
export const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];

export interface OwnedCard {
  id: string;
  catalogId: string;
  name: string;
  setId: string;
  setName: string;
  number: string;
  rarity: string;
  category: string;
  types: string[];
  hp: number | null;
  artist: string;
  knownVariants: string[];
  variant: string;
  condition: string;
  language: string;
  gradedBy: string;
  grade: string;
  quantity: number;
  cost: number | null;
  folder: string;
  notes: string;
  pricing: any | null;
  pricingAt: number | null;
  addedAt: number;
}

export type Side = "front" | "back";
export type Size = "original" | "crop" | "thumb";

interface Schema extends DBSchema {
  cards: { key: string; value: OwnedCard };
  photos: { key: string; value: Blob };
  kv: { key: string; value: unknown };
}

const db = openDB<Schema>("binderlog", 1, {
  upgrade(d) {
    d.createObjectStore("cards", { keyPath: "id" });
    d.createObjectStore("photos");
    d.createObjectStore("kv");
  },
});

export const allCards = async () => (await db).getAll("cards");
export const getCard = async (id: string) => (await db).get("cards", id);
export const putCard = async (c: OwnedCard) => { await (await db).put("cards", c); };
export const getPhoto = async (id: string, side: Side, size: Size) => (await db).get("photos", `${id}:${side}:${size}`);
export const putPhoto = async (id: string, side: Side, size: Size, b: Blob) => { await (await db).put("photos", b, `${id}:${side}:${size}`); };
export const getSetting = async <T,>(k: string, d: T) => ((await (await db).get("kv", k)) as T | undefined) ?? d;
export const setSetting = async (k: string, v: unknown) => { await (await db).put("kv", v, k); };

export async function deleteCard(id: string) {
  const d = await db;
  await d.delete("cards", id);
  for (const side of ["front", "back"] as Side[])
    for (const size of ["original", "crop", "thumb"] as Size[]) await d.delete("photos", `${id}:${side}:${size}`);
}

// ---- image handling. Drawing to a canvas and re-encoding removes location and other metadata.
export async function fileToCanvas(f: Blob, max = 2000): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(f);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export const toJpeg = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", q));

export function shrink(c: HTMLCanvasElement, w: number) {
  const o = document.createElement("canvas");
  o.width = w; o.height = Math.round((c.height * w) / c.width);
  const x = o.getContext("2d")!;
  x.imageSmoothingQuality = "high";
  x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

export async function storeSide(id: string, side: Side, original: HTMLCanvasElement, crop: HTMLCanvasElement) {
  await putPhoto(id, side, "original", await toJpeg(original, 0.85));
  await putPhoto(id, side, "crop", await toJpeg(crop, 0.85));
  await putPhoto(id, side, "thumb", await toJpeg(shrink(crop, 240), 0.75));
}

// ---- card index
export interface IndexCard { id: string; name: string; number: string; setId: string; setName: string; image: string }
interface LoadedIndex { demo: boolean; generatedAt: string; cards: IndexCard[]; sigs: Uint8Array[] }

let index: Promise<LoadedIndex> | null = null;
export function loadIndex() {
  index ??= fetch(`${import.meta.env.BASE_URL}index/cards.json`).then(async (r) => {
    if (!r.ok) throw new Error("Card index is missing");
    const j = await r.json();
    return {
      demo: !!j.demo, generatedAt: j.generatedAt,
      cards: j.cards.map(({ h: _h, ...c }: any) => c),
      sigs: j.cards.map((c: any) => decodeSig(c.h)),
    };
  });
  return index;
}

export async function matchCrop(crop: HTMLCanvasElement): Promise<Ranked<IndexCard>[]> {
  const i = await loadIndex();
  const norm = shrink(crop, 256);
  const d = norm.getContext("2d")!.getImageData(0, 0, norm.width, norm.height);
  const p: Pixels = { data: d.data, width: d.width, height: d.height };
  return rank(i.sigs, i.cards, [signature(p), signature(rotate180(p))], 10);
}

export async function searchIndex(q: string) {
  const i = await loadIndex();
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return i.cards.filter((c) => `${c.name} ${c.setName} ${c.number}`.toLowerCase().includes(t)).slice(0, 30);
}

// ---- TCGdex
export async function fetchDetails(catalogId: string): Promise<any | null> {
  try {
    const r = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(catalogId)}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export function applyDetails(c: OwnedCard, d: any | null): OwnedCard {
  if (!d) return c;
  return {
    ...c,
    name: d.name ?? c.name,
    setName: d.set?.name ?? c.setName,
    number: d.localId ?? c.number,
    rarity: d.rarity ?? c.rarity,
    category: d.category ?? c.category,
    types: d.types ?? c.types,
    hp: d.hp ?? c.hp,
    artist: d.illustrator ?? c.artist,
    knownVariants: d.variants ? Object.keys(d.variants).filter((k) => d.variants[k]) : c.knownVariants,
    pricing: d.pricing ?? null,
    pricingAt: Date.now(),
  };
}

/** Refreshes prices older than a day, and fills in details missed while offline. */
export async function refreshStale(cards: OwnedCard[], force = false): Promise<number> {
  const day = 864e5;
  const seen = new Map<string, any>();
  let changed = 0;
  for (const c of cards) {
    if (!force && c.pricingAt && Date.now() - c.pricingAt < day) continue;
    if (!seen.has(c.catalogId)) seen.set(c.catalogId, await fetchDetails(c.catalogId));
    const d = seen.get(c.catalogId);
    if (d) { await putCard(applyDetails(c, d)); changed++; }
  }
  return changed;
}

// ---- prices. Sources are never blended, and a missing price stays missing.
export interface PriceRow { source: string; currency: string; label: string; value: number; updated: string | null }

const TCP_KEYS: Record<string, string[]> = {
  normal: ["normal"],
  reverse: ["reverse", "reverse-holofoil", "reverseHolofoil"],
  holo: ["holo", "holofoil"],
  firstEdition: ["1st-edition", "1stEdition", "firstEdition", "1st-edition-holofoil", "1stEditionHolofoil"],
};

function tcp(c: OwnedCard) {
  const t = c.pricing?.tcgplayer;
  for (const k of TCP_KEYS[c.variant] ?? [c.variant]) if (t?.[k]) return t[k];
  return null;
}

const CM_SUFFIX = (v: string) => (v === "holo" || v === "reverse" ? "-holo" : v === "normal" ? "" : null);

export function priceRows(c: OwnedCard): PriceRow[] {
  const rows: PriceRow[] = [];
  const t = tcp(c);
  if (t) {
    const updated = c.pricing.tcgplayer.updated ?? null;
    if (t.marketPrice != null) rows.push({ source: "TCGplayer", currency: "USD", label: "Market", value: t.marketPrice, updated });
    if (t.lowPrice != null) rows.push({ source: "TCGplayer", currency: "USD", label: "Low", value: t.lowPrice, updated });
  }
  const m = c.pricing?.cardmarket;
  const s = CM_SUFFIX(c.variant);
  if (m && s !== null) {
    const updated = m.updated ?? null;
    const add = (key: string, label: string) => {
      if (m[key + s] != null) rows.push({ source: "Cardmarket", currency: "EUR", label, value: m[key + s], updated });
    };
    add("trend", "Trend"); add("avg30", "30-day average"); add("low", "Low");
  }
  return rows;
}

export function cardValue(c: OwnedCard, src: PriceSource): number | null {
  const label = src === "tcgplayer" ? "Market" : "Trend";
  const name = src === "tcgplayer" ? "TCGplayer" : "Cardmarket";
  const r = priceRows(c).find((x) => x.source === name && x.label === label);
  return r ? r.value * c.quantity : null;
}

export const money = (v: number, src: PriceSource | string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: src === "tcgplayer" || src === "USD" ? "USD" : "EUR" }).format(v);
