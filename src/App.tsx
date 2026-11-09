import { useEffect, useMemo, useState } from "react";
import {
  allCards, applyDetails, cardValue, CONDITIONS, deleteCard, fetchDetails, fileToCanvas, getCard, getPhoto, getSetting,
  loadIndex, matchCrop, money, priceRows, putCard, refreshStale, searchIndex, setSetting, storeSide,
  type IndexCard, type OwnedCard, type PriceSource, type Side,
} from "./lib/data";
import { detectCard, looksLikeBack } from "./lib/detect";
import { confidence, type Ranked } from "./lib/hash";

type View = { name: "list" } | { name: "scan" } | { name: "card"; id: string } | { name: "settings" };

function Photo({ id, side, size, alt }: { id: string; side: Side; size: "crop" | "thumb" | "original"; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined, live = true;
    getPhoto(id, side, size).then((b) => { if (b && live) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, side, size]);
  return url ? <img src={url} alt={alt} /> : <div className="ph" aria-label={alt} />;
}

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });
  const [cards, setCards] = useState<OwnedCard[]>([]);
  const [src, setSrc] = useState<PriceSource>("tcgplayer");
  const reload = () => allCards().then(setCards);
  useEffect(() => {
    getSetting<PriceSource>("source", "tcgplayer").then(setSrc);
    allCards().then(async (c) => { setCards(c); if (navigator.onLine && (await refreshStale(c))) reload(); });
  }, []);
  const changeSrc = (s: PriceSource) => { setSrc(s); setSetting("source", s); };

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => setView({ name: "list" })}>Binderlog</button>
        <button className="icon" aria-label="Settings" onClick={() => setView({ name: "settings" })}>Settings</button>
      </header>
      <main>
        {view.name === "list" && <List cards={cards} src={src} onSrc={changeSrc} open={(id) => setView({ name: "card", id })} scan={() => setView({ name: "scan" })} />}
        {view.name === "scan" && <Scan done={(id) => { reload(); setView(id ? { name: "card", id } : { name: "list" }); }} again={reload} />}
        {view.name === "card" && <Detail id={view.id} back={() => { reload(); setView({ name: "list" }); }} />}
        {view.name === "settings" && <Settings cards={cards} src={src} onSrc={changeSrc} reload={reload} />}
      </main>
    </div>
  );
}

// ---------- collection
const SORTS: Record<string, (a: OwnedCard, b: OwnedCard, s: PriceSource) => number> = {
  "Newest": (a, b) => b.addedAt - a.addedAt,
  "Value, high to low": (a, b, s) => (cardValue(b, s) ?? -1) - (cardValue(a, s) ?? -1),
  "Name": (a, b) => a.name.localeCompare(b.name),
  "Set and number": (a, b) => a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true }),
  "HP": (a, b) => (b.hp ?? -1) - (a.hp ?? -1),
};
const uniq = (v: string[]) => [...new Set(v.filter(Boolean))].sort();

function List({ cards, src, onSrc, open, scan }: { cards: OwnedCard[]; src: PriceSource; onSrc: (s: PriceSource) => void; open: (id: string) => void; scan: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("Newest");
  const [f, setF] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const facets: [string, string, (c: OwnedCard) => string[]][] = [
    ["setName", "Set", (c) => [c.setName]], ["rarity", "Rarity", (c) => [c.rarity]], ["type", "Type", (c) => c.types],
    ["artist", "Artist", (c) => [c.artist]], ["condition", "Condition", (c) => [c.condition]],
    ["language", "Language", (c) => [c.language]], ["folder", "Folder", (c) => [c.folder]],
    ["graded", "Graded", (c) => [c.gradedBy ? "Graded" : "Raw"]],
  ];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return cards
      .filter((c) => !t || `${c.name} ${c.setName} ${c.number} ${c.artist}`.toLowerCase().includes(t))
      .filter((c) => facets.every(([k, , get]) => !f[k] || get(c).includes(f[k])))
      .sort((a, b) => SORTS[sort](a, b, src));
  }, [cards, q, f, sort, src]);
  const total = shown.reduce((s, c) => s + (cardValue(c, src) ?? 0), 0);
  const priced = shown.filter((c) => cardValue(c, src) != null).length;
  const active = Object.values(f).filter(Boolean).length;

  if (!cards.length)
    return (
      <section className="empty">
        <h1>Your binder is empty</h1>
        <p>Photograph a card and it will be identified on your phone, with no limit on scans.</p>
        <button className="primary" onClick={scan}>Scan your first card</button>
      </section>
    );
  return (
    <>
      <section className="total">
        <span className="label">{active || q ? "Shown value" : "Collection value"}</span>
        <strong data-testid="total">{money(total, src)}</strong>
        <span className="sub">{priced} of {shown.length} entries priced</span>
        <div className="seg" role="group" aria-label="Price source">
          <button aria-pressed={src === "tcgplayer"} onClick={() => onSrc("tcgplayer")}>TCGplayer</button>
          <button aria-pressed={src === "cardmarket"} onClick={() => onSrc("cardmarket")}>Cardmarket</button>
        </div>
      </section>
      <div className="tools">
        <input type="search" placeholder="Search your cards" aria-label="Search your cards" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setShow(!show)} aria-expanded={show}>Filter{active ? ` (${active})` : ""}</button>
      </div>
      {show && (
        <div className="filters">
          <label>Sort by<select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>{Object.keys(SORTS).map((s) => <option key={s}>{s}</option>)}</select></label>
          {facets.map(([k, label, get]) => (
            <label key={k}>{label}
              <select aria-label={label} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                <option value="">All</option>{uniq(cards.flatMap(get)).map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          ))}
          {active > 0 && <button onClick={() => setF({})}>Clear filters</button>}
        </div>
      )}
      <div className="grid">
        {shown.map((c) => {
          const v = cardValue(c, src);
          return (
            <button key={c.id} className="tile" onClick={() => open(c.id)}>
              <Photo id={c.id} side="front" size="thumb" alt={c.name} />
              <b>{c.name}</b>
              <small>{c.setName} · {c.number}{c.quantity > 1 ? ` · ×${c.quantity}` : ""}</small>
              <span className="price">{v == null ? "No price" : money(v, src)}</span>
            </button>
          );
        })}
      </div>
      {!shown.length && <p className="note">No cards match these filters.</p>}
      <button className="fab primary" onClick={scan}>Scan</button>
    </>
  );
}

// ---------- scan flow
type Shot = { original: HTMLCanvasElement; crop: HTMLCanvasElement; found: boolean };

function Scan({ done, again }: { done: (id?: string) => void; again: () => void }) {
  const [step, setStep] = useState<"front" | "match" | "details" | "back" | "saving">("front");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [front, setFront] = useState<Shot>();
  const [back, setBack] = useState<Shot>();
  const [matches, setMatches] = useState<Ranked<IndexCard>[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<IndexCard[]>([]);
  const [pick, setPick] = useState<IndexCard>();
  const [details, setDetails] = useState<any>(null);
  const [form, setForm] = useState({ variant: "normal", condition: "Near Mint", language: "English", gradedBy: "", grade: "", quantity: "1", cost: "", folder: "" });
  const [demo, setDemo] = useState(false);
  const [warnBack, setWarnBack] = useState(false);
  useEffect(() => { loadIndex().then((i) => setDemo(i.demo)).catch(() => setErr("The card index could not be loaded.")); }, []);

  async function shoot(file: File): Promise<Shot> {
    const original = await fileToCanvas(file);
    const d = await detectCard(original);
    return { original, crop: d.crop, found: d.found };
  }
  async function onFront(f?: File) {
    if (!f) return;
    setErr(""); setBusy("Identifying your card…");
    try {
      const s = await shoot(f);
      setFront(s);
      setMatches(await matchCrop(s.crop));
      setStep("match");
    } catch (e) { setErr("That photo could not be read. Try another."); console.error(e); }
    setBusy("");
  }
  async function choose(c: IndexCard) {
    setPick(c); setBusy("Getting card details…");
    const d = await fetchDetails(c.id);
    setDetails(d);
    const known = d?.variants ? Object.keys(d.variants).filter((k) => d.variants[k]) : [];
    setForm((x) => ({ ...x, variant: known[0] ?? "normal" }));
    setBusy(""); setStep("details");
  }
  async function onBack(f?: File) {
    if (!f) return;
    setBusy("Checking the back…");
    try {
      const s = await shoot(f);
      setBack(s);
      setWarnBack(!s.found || !looksLikeBack(s.crop));
    } catch { setErr("That photo could not be read. Try another."); }
    setBusy("");
  }
  async function save(next: boolean) {
    if (!front || !back || !pick) return;
    setStep("saving");
    const id = crypto.randomUUID();
    const base: OwnedCard = {
      id, catalogId: pick.id, name: pick.name, setId: pick.setId, setName: pick.setName, number: pick.number,
      rarity: "", category: "", types: [], hp: null, artist: "", knownVariants: [], variant: form.variant,
      condition: form.condition, language: form.language, gradedBy: form.gradedBy, grade: form.grade,
      quantity: Math.max(1, parseInt(form.quantity) || 1), cost: form.cost ? parseFloat(form.cost) : null,
      folder: form.folder.trim(), notes: "", pricing: null, pricingAt: null, addedAt: Date.now(),
    };
    await storeSide(id, "front", front.original, front.crop);
    await storeSide(id, "back", back.original, back.crop);
    await putCard(applyDetails(base, details));
    if (!next) return done(id);
    again();
    setFront(undefined); setBack(undefined); setPick(undefined); setDetails(null); setMatches([]); setQ(""); setResults([]); setWarnBack(false);
    setStep("front");
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const conf = confidence(matches);
  const variants: string[] = details?.variants ? Object.keys(details.variants).filter((k) => details.variants[k]) : ["normal", "reverse", "holo", "firstEdition"];

  if (busy) return <section className="empty"><div className="spin" /><p role="status">{busy}</p></section>;
  return (
    <section className="flow">
      {demo && <p className="banner">Demo index: only sample cards can be matched until the real index is built.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {step === "front" && (
        <>
          <h1>Photograph the front</h1>
          <p>Lay the card flat on a plain, darker surface. Tilt it slightly if you see glare.</p>
          <label className="primary file">Take or choose a photo
            <input data-testid="front" type="file" accept="image/*" capture="environment" onChange={(e) => onFront(e.target.files?.[0])} />
          </label>
          <button className="link" onClick={() => done()}>Cancel</button>
        </>
      )}
      {step === "match" && front && (
        <>
          <h1>{conf === "high" ? "Is this your card?" : "Which card is this?"}</h1>
          {!front.found && <p className="banner">The card's edges weren't found, so the match may be off. A plain background helps.</p>}
          <div className="crop"><canvas ref={(n) => { if (n) { n.width = 200; n.height = 279; n.getContext("2d")!.drawImage(front.crop, 0, 0, 200, 279); } }} /></div>
          <div className="matches">
            {(conf === "high" ? matches.slice(0, 3) : matches.slice(0, 8)).map((m, i) => <Candidate key={m.item.id} c={m.item} best={i === 0 && conf === "high"} onPick={choose} />)}
          </div>
          <input type="search" aria-label="Search all cards" placeholder="Not here? Search by name, set or number" value={q}
            onChange={(e) => { setQ(e.target.value); searchIndex(e.target.value).then(setResults); }} />
          <div className="matches">{results.map((c) => <Candidate key={c.id} c={c} onPick={choose} />)}</div>
          <button className="link" onClick={() => setStep("front")}>Retake photo</button>
        </>
      )}
      {step === "details" && pick && (
        <>
          <h1>{pick.name}</h1>
          <p>{pick.setName} · {pick.number}{details ? "" : " · details will load when you're online"}</p>
          <div className="form">
            <label>Printing<select value={form.variant} onChange={set("variant")}>{variants.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>Condition<select value={form.condition} onChange={set("condition")}>{CONDITIONS.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>Language<input value={form.language} onChange={set("language")} /></label>
            <label>Quantity<input type="number" min="1" value={form.quantity} onChange={set("quantity")} /></label>
            <label>Grading company<input placeholder="Leave blank if raw" value={form.gradedBy} onChange={set("gradedBy")} /></label>
            <label>Grade<input value={form.grade} onChange={set("grade")} /></label>
            <label>What you paid<input type="number" min="0" step="0.01" value={form.cost} onChange={set("cost")} /></label>
            <label>Folder<input value={form.folder} onChange={set("folder")} /></label>
          </div>
          <button className="primary" onClick={() => setStep("back")}>Next: photograph the back</button>
        </>
      )}
      {step === "back" && (
        <>
          <h1>Now flip it over</h1>
          <p>The back photo is kept with this card as a record of its condition.</p>
          {warnBack && <p className="banner">This doesn't look like a card back. Keep it only if it's correct.</p>}
          {back && <div className="crop"><canvas ref={(n) => { if (n) { n.width = 200; n.height = 279; n.getContext("2d")!.drawImage(back.crop, 0, 0, 200, 279); } }} /></div>}
          <label className={back ? "file secondary" : "primary file"}>{back ? "Retake back photo" : "Take or choose a photo"}
            <input data-testid="back" type="file" accept="image/*" capture="environment" onChange={(e) => onBack(e.target.files?.[0])} />
          </label>
          {back && <button className="primary" onClick={() => save(false)}>Save card</button>}
          {back && <button className="secondary" onClick={() => save(true)}>Save and scan another</button>}
        </>
      )}
      {step === "saving" && <div className="empty"><div className="spin" /><p role="status">Saving…</p></div>}
    </section>
  );
}

function Candidate({ c, best, onPick }: { c: IndexCard; best?: boolean; onPick: (c: IndexCard) => void }) {
  return (
    <button className={best ? "cand best" : "cand"} onClick={() => onPick(c)}>
      <img src={c.image} alt="" loading="lazy" />
      <span><b>{c.name}</b><small>{c.setName} · {c.number}</small></span>
      {best && <em>Best match</em>}
    </button>
  );
}

// ---------- card page
function Detail({ id, back }: { id: string; back: () => void }) {
  const [c, setC] = useState<OwnedCard>();
  const [side, setSide] = useState<Side>("front");
  const [orig, setOrig] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { getCard(id).then(setC); }, [id]);
  if (!c) return null;
  const rows = priceRows(c);
  const update = async (p: Partial<OwnedCard>) => { const n = { ...c, ...p }; setC(n); await putCard(n); };
  const refresh = async () => { setRefreshing(true); const d = await fetchDetails(c.catalogId); if (d) { const n = applyDetails(c, d); setC(n); await putCard(n); } setRefreshing(false); };
  const facts: [string, string][] = [
    ["Set", c.setName], ["Number", c.number], ["Rarity", c.rarity], ["Category", c.category], ["Type", c.types.join(", ")],
    ["HP", c.hp?.toString() ?? ""], ["Artist", c.artist], ["Printing", c.variant], ["Language", c.language],
    ["Graded", c.gradedBy ? `${c.gradedBy} ${c.grade}` : ""], ["Folder", c.folder],
  ];
  return (
    <section className="detail">
      <button className="link" onClick={back}>Back to collection</button>
      <div className="photo"><Photo key={`${side}${orig}`} id={id} side={side} size={orig ? "original" : "crop"} alt={`${c.name}, ${side}`} /></div>
      <div className="seg">
        <button aria-pressed={side === "front"} onClick={() => setSide("front")}>Front</button>
        <button aria-pressed={side === "back"} onClick={() => setSide("back")}>Back</button>
        <button aria-pressed={orig} onClick={() => setOrig(!orig)}>Original photo</button>
      </div>
      <h1>{c.name}</h1>
      <dl>{facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <h2>Market prices</h2>
      {rows.length ? (
        <table>
          <thead><tr><th>Source</th><th>Price type</th><th>Price</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.source + r.label}><td>{r.source}</td><td>{r.label}</td><td>{money(r.value, r.currency)}</td></tr>)}</tbody>
        </table>
      ) : <p className="note">No price available for this printing.</p>}
      <p className="note">Prices are per card for the {c.variant} printing, and do not reflect this copy's condition or grade.{rows[0]?.updated ? ` Updated ${new Date(rows[0].updated).toLocaleDateString()}.` : ""}</p>
      <button className="secondary" disabled={refreshing} onClick={refresh}>{refreshing ? "Refreshing…" : "Refresh prices"}</button>
      <h2>Your copy</h2>
      <div className="form">
        <label>Condition<select value={c.condition} onChange={(e) => update({ condition: e.target.value })}>{CONDITIONS.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Quantity<input type="number" min="1" value={c.quantity} onChange={(e) => update({ quantity: Math.max(1, parseInt(e.target.value) || 1) })} /></label>
        <label>What you paid<input type="number" min="0" step="0.01" value={c.cost ?? ""} onChange={(e) => update({ cost: e.target.value ? parseFloat(e.target.value) : null })} /></label>
        <label>Folder<input value={c.folder} onChange={(e) => update({ folder: e.target.value })} /></label>
        <label className="wide">Notes<textarea value={c.notes} onChange={(e) => update({ notes: e.target.value })} /></label>
      </div>
      <button className="danger" onClick={async () => { if (confirmDelete()) { await deleteCard(id); back(); } }}>Delete card and photos</button>
    </section>
  );
}
const confirmDelete = () => window.confirm("Delete this card and its photos?");

// ---------- settings
function Settings({ cards, src, onSrc, reload }: { cards: OwnedCard[]; src: PriceSource; onSrc: (s: PriceSource) => void; reload: () => void }) {
  const [info, setInfo] = useState("Loading…");
  const [msg, setMsg] = useState("");
  useEffect(() => { loadIndex().then((i) => setInfo(`${i.cards.length.toLocaleString()} cards${i.demo ? " (demo sample)" : ""}, built ${new Date(i.generatedAt).toLocaleDateString()}`)).catch(() => setInfo("Not installed")); }, []);
  const exportData = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cards, null, 2)], { type: "application/json" }));
    a.download = "binderlog-collection.json"; a.click();
  };
  return (
    <section className="flow left">
      <h1>Settings</h1>
      <h2>Portfolio price source</h2>
      <div className="seg">
        <button aria-pressed={src === "tcgplayer"} onClick={() => onSrc("tcgplayer")}>TCGplayer (USD)</button>
        <button aria-pressed={src === "cardmarket"} onClick={() => onSrc("cardmarket")}>Cardmarket (EUR)</button>
      </div>
      <h2>Card index</h2><p>{info}</p>
      <h2>Your data</h2>
      <p>Your cards and photos are stored only in this browser on this device. Clearing browser data removes them.</p>
      <button className="secondary" onClick={exportData}>Export card list</button>
      <button className="secondary" onClick={async () => { const n = await refreshStale(cards, true); reload(); setMsg(`Updated ${n} entries.`); }}>Refresh all prices</button>
      {msg && <p role="status">{msg}</p>}
      <p className="note">Binderlog is an independent app, and is not affiliated with or endorsed by Nintendo, The Pokémon Company, TCGplayer or Cardmarket. Card data and prices come from TCGdex.</p>
    </section>
  );
}
