// @ts-nocheck
// Handy Little Lists – the Claude / ChatGPT connector for DobyToday, PackbyBag and ListbyAisle.
//
// In plain English:
//   * This runs on Supabase as an Edge Function called "lists". Its address is
//     https://nlbeqaoffratriysazrx.supabase.co/functions/v1/lists – that is what people paste into Claude or ChatGPT.
//   * People sign in with the same email code as on the sites, and press Allow. After that, Claude or ChatGPT
//     can see their lists and add, tick, move or remove things – only their own lists, nobody else's.
//   * It works on the copy of the lists saved in their account (the one the sites keep when you're signed in).
//     The sites pick up the changes the next time they're opened or come back on screen.
//   * No extra packages: it speaks the MCP protocol (what Claude and ChatGPT use for connectors) directly.

const PROJECT = "https://nlbeqaoffratriysazrx.supabase.co";
const PUBLIC_KEY = "sb_publishable_HjyFCCwqTjqeAIV1bh28ww_li-Rw7CZ";   // the same public key the websites use
const FN = "lists";

const SITES = {
  dobytoday: { name: "DobyToday", what: "to-do list", url: "https://dobytoday.com" },
  packbybag: { name: "PackbyBag", what: "packing list (sorted by bag)", url: "https://packbybag.com" },
  listbyaisle: { name: "ListbyAisle", what: "shopping list (sorted by aisle)", url: "https://listbyaisle.com" },
};
// DobyToday's built-in sections (people can rename, hide or add their own)
const DBT_SECTIONS = [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["any", "Anytime today"], ["iftime", "If there's time"]];
const PBB_BAGS = [["carry", "Hand luggage"], ["hold", "Suitcase"], ["wear", "Wear on the day"], ["schoolbag", "School bag"], ["pebag", "PE & swim bag"], ["lunchbox", "Lunch & snacks"], ["kids", "Kids' bags"], ["before", "To do before you go"], ["there", "Get when you're there"]];

function base() { return (globalThis.Deno?.env?.get?.("SUPABASE_URL") || PROJECT).replace(/\/$/, ""); }
function resourceUrl() { return base() + "/functions/v1/" + FN; }
function metaUrl() { return resourceUrl() + "/.well-known/oauth-protected-resource"; }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } }); }
function unauthorized() {
  return json({ error: "unauthorized", error_description: "Sign in to use your lists" }, 401,
    { "WWW-Authenticate": `Bearer resource_metadata="${metaUrl()}"` });
}

// ---------- talking to Supabase as the signed-in person ----------
async function whoAmI(token) {
  const r = await fetch(base() + "/auth/v1/user", { headers: { apikey: PUBLIC_KEY, Authorization: "Bearer " + token } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
async function rpc(token, fn, args) {
  const r = await fetch(base() + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("The list service said no (" + r.status + "): " + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
function freshList(site) {
  if (site === "dobytoday") return { picked: {}, got: {}, own: [], bag: {}, removed: [], note: {}, day: "", later: [], past: [], seen: [], title: "", notes: "", after: "", keep: false, kind: "", urg: {}, secs: null };
  if (site === "packbybag") return { picked: {}, got: {}, own: [], bag: {}, removed: [], qty: {}, note: {}, cbags: [] };
  return { picked: {}, got: {}, own: [], org: {}, removed: [], qty: {}, note: {}, mv: {} };
}
async function loadSite(token, site) {
  const d = (await rpc(token, "hlt_get", { p_site: site })) || {};
  d.s = Object.assign(freshList(site), d.s || {});
  if (site === "dobytoday" && d.c) {   // a shared to-do list: the shared copy is the one everyone sees
    const live = await rpc(token, "get_list", { code: d.c }).catch(() => null);
    if (live) d.s = Object.assign(freshList(site), live);
  }
  return d;
}
// The fields a DobyToday list (or page) shares through its link – the same as the site's own snapshot
const SHARED = ["picked", "got", "own", "bag", "removed", "note", "day", "later", "past", "title", "notes", "after", "keep", "kind", "urg", "secs", "low", "at"];
function sharedCopy(S) { const o = {}; SHARED.forEach((k) => { if (S[k] !== undefined) o[k] = S[k]; }); o.t = Date.now(); return o; }
async function saveSite(token, site, d) {
  d.t = Date.now();   // newer than the phone's copy, so the site takes these changes when it next opens
  if (site === "dobytoday" && d.c) await rpc(token, "save_list", { code: d.c, payload: sharedCopy(d.s) });
  await rpc(token, "hlt_save", { p_site: site, p_data: d });
}

// ---------- DobyToday pages: projects, plans and lists of steps kept under My saved lists ----------
// Every page has its own share code; the shared copy is the live one (Magda and anyone else with the link sees it).
async function loadPage(token, l) {
  let S = l.s || {};
  if (l.c) { const live = await rpc(token, "get_list", { code: l.c }).catch(() => null); if (live) S = live; }
  return Object.assign(freshList("dobytoday"), { keep: true }, S);
}
async function savePage(token, d, l, S) {
  const copy = sharedCopy(S);
  if (l.c) await rpc(token, "save_list", { code: l.c, payload: copy });
  delete copy.t; l.s = copy;
  await saveSite(token, "dobytoday", d);
}
const pageName = (l, S) => (S && S.title) || l.name || "Untitled";
function findPage(d, name) {
  const L = (d.L || []).filter((l) => l && l.id), q = low(name);
  if (!q) return { error: "Say which page." };
  let m = L.filter((l) => low(l.name) === q || low((l.s || {}).title) === q);
  if (!m.length) m = L.filter((l) => low(l.name).includes(q) || low((l.s || {}).title).includes(q) || q.includes(low(l.name)));
  if (m.length === 1) return { l: m[0] };
  return { error: m.length ? "More than one page matches “" + name + "”: " + m.map((l) => l.name).join(", ") + "." : "There's no page called “" + name + "”. Your pages: " + L.map((l) => l.name).join(", ") + "." };
}
function stepsOf(S) { return (S.own || []).map((o, i) => ({ o, i })); }
function findSteps(S, refs) {
  const st = stepsOf(S), hit = [], miss = [];
  (refs || []).forEach((r) => {
    const q = low(r); if (!q) return;
    const num = q.match(/^(?:step\s*)?(\d{1,3})$/);
    let m = num ? st.filter((x) => x.i === +num[1] - 1) : st.filter((x) => low(x.o.n) === q);
    if (!m.length && !num) m = st.filter((x) => low(x.o.n).includes(q));
    if (m.length === 1) hit.push(m[0]); else miss.push(String(r) + (m.length > 1 ? " (matches several – use the step number)" : ""));
  });
  return { hit, miss };
}
function describePage(l, S, full) {
  const st = stepsOf(S), done = st.filter((x) => x.o.got).length, out = [];
  const links = S.kind === "links";
  out.push(pageName(l, S) + (l.group ? " [" + l.group + "]" : "") + (links ? " – " + st.length + " links" : " – " + done + " of " + st.length + " done") + (l.c ? " (shared page)" : ""));
  if (!full) return out[0];
  if (S.notes) out.push("Notes: " + S.notes);
  st.forEach(({ o, i }) => {
    if (links) { out.push("  " + (i + 1) + ". " + o.n + (o.url ? " – " + o.url : "")); return; }
    out.push("  " + (o.got ? "☑ " : "☐ ") + (i + 1) + ". " + o.n);
    (o.d || []).forEach((x) => out.push("       – " + x));
    if (o.ans) out.push("       Answer: " + o.ans);
    (o.up || []).forEach((u) => out.push("       Update – " + (u.w || "Someone") + ", " + (u.d || "") + ": " + u.t));
  });
  if (S.after) out.push("After the steps: " + S.after);
  return out.join("\n");
}
function newCode() { const a = "abcdefghjkmnpqrstuvwxyz23456789"; let o = "t"; for (let i = 0; i < 11; i++) o += a[Math.floor(Math.random() * a.length)]; return o; }

// ---------- reading a list ----------
const low = (x) => String(x || "").trim().toLowerCase();
function sections(S) {   // DobyToday: [key, label] in order, as the person has set them up
  const c = S.secs || {}, lab = c.lab || {}, off = c.off || {}, out = [];
  DBT_SECTIONS.forEach(([k, l]) => { if (!off[k]) out.push([k, lab[k] || l]); });
  (c.add || []).forEach((a) => out.push([a[0], a[1]]));
  return out.length ? out : [["any", "Anytime today"]];
}
function bags(S) { return PBB_BAGS.concat((S.cbags || []).filter((c) => c && c.k).map((c) => [c.k, c.n || c.label || c.k])); }
function entries(S) {   // every item on the list: {n, got, own index or null, key}
  const out = [];
  Object.keys(S.picked || {}).forEach((n) => out.push({ n, got: !!(S.got || {})[n], own: null, key: (S.bag || {})[n] || "" }));
  (S.own || []).forEach((o, i) => out.push({ n: o.n, got: !!o.got, own: i, key: o.b || "", who: o.w || "", link: o.link || "" }));
  return out;
}
function describe(site, d) {
  const S = d.s, all = entries(S), lines = [];
  const tick = (e) => (e.got ? "☑ " : "☐ ") + (site === "dobytoday" && (S.urg || {})[e.n] ? "❗ " : "") + (site === "dobytoday" && (S.low || {})[e.n] ? "↓ " : "") + (e.who ? e.who + ": " : "") + e.n
    + ((S.note || {})[e.n] ? "  [note: " + S.note[e.n] + "]" : "") + (e.link ? "  [link: " + e.link + "]" : "");
  if (site === "dobytoday") {
    // One list, as the site shows it: ❗ urgent first, ↓ not urgent last, newest first in between
    const pr = (n) => ((S.urg || {})[n] ? 0 : (S.low || {})[n] ? 2 : 1), at = S.at || {};
    const rows = all.map((e, i) => [e, i]).sort((a, b) => pr(a[0].n) - pr(b[0].n) || (at[b[0].n] || 0) - (at[a[0].n] || 0) || a[1] - b[1]).map((x) => x[0]);
    lines.push("DobyToday – My to-do list (one list: ❗ urgent at the top, ↓ not urgent at the bottom, newest first in between)");
    rows.forEach((e) => lines.push("  " + tick(e)));
    if (!all.length) lines.push("  (nothing on today's list)");
    const later = (S.later || []).slice().sort((a, b) => (a.d < b.d ? -1 : 1));
    if (later.length) { lines.push("  Coming up on later days:"); later.forEach((j) => lines.push("    " + j.d + " – " + j.n)); }
  } else if (site === "packbybag") {
    const bl = bags(S), name = (k) => (bl.find((b) => b[0] === k) || [k, ""])[1];
    lines.push("PackbyBag – current packing list (bags: " + bl.map((b) => b[1]).join(", ") + ")");
    const by = {};
    all.forEach((e) => { const k = e.key ? name(e.key) : "(bag chosen by the site)"; (by[k] = by[k] || []).push(e); });
    Object.keys(by).forEach((k) => { lines.push("  " + k + ":"); by[k].forEach((e) => lines.push("    " + tick(e))); });
    if (!all.length) lines.push("  (nothing packed yet)");
  } else {
    lines.push("ListbyAisle – current shopping list");
    all.forEach((e) => lines.push("  " + tick(e) + ((S.qty || {})[e.n] ? " ×" + S.qty[e.n] : "")));
    if (!all.length) lines.push("  (the shopping list is empty)");
  }
  if (site === "dobytoday" && d.pagesText) lines.push("  My saved lists – pages and projects (use get_page to open one):\n" + d.pagesText);
  const m = Array.isArray(d.m) ? d.m : [];
  if (m.length) lines.push("  Saved lists: " + m.map((x) => x.name + " (" + (Object.keys((x.s || {}).picked || {}).length + ((x.s || {}).own || []).length) + ")").join(", "));
  return lines.join("\n");
}

// ---------- changing a list ----------
function findItems(S, names) {
  const all = entries(S), hit = [], miss = [];
  names.forEach((raw) => {
    const q = low(raw); if (!q) return;
    let e = all.filter((x) => low(x.n) === q);
    if (!e.length) e = all.filter((x) => low(x.n).includes(q) || q.includes(low(x.n)));
    if (e.length === 1 || (e.length > 1 && e.every((x) => low(x.n) === low(e[0].n)))) hit.push(Object.assign({}, e[0], { q: raw })); else miss.push(raw + (e.length > 1 ? " (matches " + e.map((x) => x.n).join(", ") + " – be more exact)" : ""));
  });
  return { hit, miss };
}
function resolvePlace(site, S, place) {
  if (!place) return { key: "" };
  const opts = site === "dobytoday" ? sections(S) : site === "packbybag" ? bags(S) : [];
  if (!opts.length) return { key: "" };
  const q = low(place), m = opts.find((o) => low(o[1]) === q || o[0] === q) || opts.find((o) => low(o[1]).includes(q) || q.includes(low(o[1])));
  if (!m) return { error: "There's no " + (site === "dobytoday" ? "section" : "bag") + " called “" + place + "”. The choices are: " + opts.map((o) => o[1]).join(", ") + "." };
  return { key: m[0], label: m[1] };
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
const lid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function removeEntry(S, e) {
  if (e.own === null) { delete S.picked[e.n]; delete (S.got || {})[e.n]; delete (S.bag || {})[e.n]; }
  else S.own[e.own] = null;
  ["note", "qty"].forEach((f) => { if (S[f]) delete S[f][e.n]; });
  if (S.urg) delete S.urg[e.n];
}
function tidy(S) { S.own = (S.own || []).filter(Boolean); }

function addItems(site, S, a) {
  const names = (a.items || []).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 200);
  if (!names.length) return "Nothing to add.";
  const p = resolvePlace(site, S, a.section || a.bag); if (p.error) return p.error;
  const later = site === "dobytoday" && a.day && /^\d{4}-\d{2}-\d{2}$/.test(a.day) && a.day > todayISO() ? a.day : "";
  const have = new Set(entries(S).map((e) => low(e.n)));
  const added = [], skipped = [];
  names.forEach((n) => {
    if (later) { S.later = (S.later || []).concat([{ id: lid(), n, d: later, a: "", b: p.key || "any" }]); added.push(n); return; }
    if (have.has(low(n))) { skipped.push(n); if (site === "dobytoday" && a.urgent) { const e = entries(S).find((x) => low(x.n) === low(n)); S.urg = S.urg || {}; S.urg[e.n] = 1; } return; }
    have.add(low(n));
    if (site === "listbyaisle") S.own.push({ n, a: "", got: false, org: false });
    else if (site === "packbybag") { const o = { n, a: "", b: p.key || "", got: false }; if (a.person) o.w = String(a.person).slice(0, 20); S.own.push(o); }
    else S.own.push({ n, a: "other", b: p.key || "any", got: false });
    if (site === "dobytoday") { S.at = S.at || {}; S.at[n] = Date.now(); if (a.urgent) { S.urg = S.urg || {}; S.urg[n] = 1; } else if (a.not_urgent) { S.low = S.low || {}; S.low[n] = 1; } }
    added.push(n);
  });
  const where = later ? " for " + later : p.label ? " to " + p.label : "";
  return ((added.length ? "Added " + added.length + where + ": " + added.join(", ") + "." : "") + (skipped.length ? " Already on the list" + (site === "dobytoday" && a.urgent ? " (now marked ❗ urgent)" : "") + ": " + skipped.join(", ") + "." : "")).trim();
}
function updateItems(site, S, a) {
  const act = a.action, map = act === "set_note" ? a.notes : act === "set_link" ? a.links : null;
  if (map && typeof map === "object" && !(a.items || []).length) a.items = Object.keys(map);   // many notes or links in one go
  const { hit, miss } = findItems(S, (a.items || []).map(String));
  if (!hit.length) return "None of those are on the list" + (miss.length ? ": " + miss.join(", ") : "") + ".";
  let p = { key: "" };
  if (act === "move" && !(site === "dobytoday" && a.day)) { p = resolvePlace(site, S, a.section || a.bag); if (p.error) return p.error; if (!p.key) return "Say which " + (site === "dobytoday" ? "section" : "bag") + " to move them to."; }
  if ((/urgent/.test(act || "") || act === "set_link") && site !== "dobytoday") return "Urgent marks and links are only on DobyToday.";
  if (act === "set_link" && hit.some((e) => e.own === null)) return "Links can only go on jobs you added yourself (not ready-made ones).";
  hit.forEach((e) => {
    const o = e.own === null ? null : S.own[e.own];
    if (act === "tick") { if (o) o.got = true; else S.got[e.n] = 1; }
    else if (act === "untick") { if (o) o.got = false; else delete S.got[e.n]; }
    else if (act === "remove") removeEntry(S, e);
    else if (act === "mark_urgent") { S.urg = S.urg || {}; S.urg[e.n] = 1; if (S.low) delete S.low[e.n]; }
    else if (act === "unmark_urgent") { if (S.urg) delete S.urg[e.n]; }
    else if (act === "mark_not_urgent") { S.low = S.low || {}; S.low[e.n] = 1; if (S.urg) delete S.urg[e.n]; }
    else if (act === "unmark_not_urgent") { if (S.low) delete S.low[e.n]; }
    else if (act === "set_note") { S.note = S.note || {}; const t = String((map && map[e.q] !== undefined ? map[e.q] : a.text) || "").trim(); if (t) S.note[e.n] = t.slice(0, 300); else delete S.note[e.n]; }
    else if (act === "set_link") { if (o) { const u = String((map && map[e.q] !== undefined ? map[e.q] : a.link) || "").trim(); if (/^https:\/\//.test(u)) o.link = u; else delete o.link; } }
    else if (act === "move") {
      if (site === "dobytoday" && a.day && a.day > todayISO()) { const b = o ? o.b : (S.bag || {})[e.n] || "any"; removeEntry(S, e); S.later = (S.later || []).concat([{ id: lid(), n: e.n, d: a.day, a: o ? o.a : "", b }]); }
      else if (o) o.b = p.key; else { S.bag = S.bag || {}; S.bag[e.n] = p.key; }
    }
  });
  tidy(S);
  const verb = { tick: "Ticked off", untick: "Unticked", remove: "Removed", mark_urgent: "Marked urgent", unmark_urgent: "No longer urgent", mark_not_urgent: "Marked not urgent", unmark_not_urgent: "Back to normal", move: "Moved", set_note: "Updated the note on", set_link: "Updated the link on" }[act] || act;
  return verb + (act === "move" ? (a.day ? " to " + a.day : " to " + p.label) : "") + ": " + hit.map((e) => e.n).join(", ") + "." + (miss.length ? " Not found: " + miss.join(", ") + "." : "");
}
function saveCopy(site, d, a) {
  const name = String(a.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return "Give the saved list a name.";
  const items = (a.items || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 200);
  const s = freshList(site);
  if (items.length) items.forEach((n) => s.own.push(site === "listbyaisle" ? { n, a: "", got: false, org: false } : site === "packbybag" ? { n, a: "", b: "", got: false } : { n, a: "other", b: "any", got: false }));
  else { const cur = JSON.parse(JSON.stringify(d.s)); s.picked = cur.picked || {}; s.own = (cur.own || []).map((o) => Object.assign(o, { got: false })); if (cur.bag) s.bag = cur.bag; if (cur.qty) s.qty = cur.qty; }
  if (!Object.keys(s.picked).length && !s.own.length) return "That list would be empty – give it some items.";
  d.m = Array.isArray(d.m) ? d.m : [];
  const same = d.m.find((x) => low(x.name) === low(name));
  if (same) { same.s = s; same.t = Date.now(); } else d.m.unshift({ id: lid(), name, s, t: Date.now() });
  return (same ? "Updated" : "Saved") + " “" + name + "” in My saved lists on " + SITES[site].name + " (" + (Object.keys(s.picked).length + s.own.length) + " items).";
}

// ---------- the tools Claude / ChatGPT see ----------
const SITE_PROP = { type: "string", enum: ["dobytoday", "packbybag", "listbyaisle"], description: "dobytoday = to-do list, packbybag = packing list, listbyaisle = shopping list" };
const PAGE_PROP = { type: "string", description: "The page's name (or part of it), as listed by get_my_lists" };
const TOOLS = [
  {
    name: "get_my_lists", title: "See my lists",
    description: "Show what is on the signed-in person's lists: their DobyToday to-do list (❗ urgent and ↓ not-urgent jobs, notes, links and jobs for later days), their PackbyBag packing list and their ListbyAisle shopping list, plus the names of their saved lists. Call this first to see exact item and section names.",
    inputSchema: { type: "object", properties: { site: { type: "string", enum: ["all", "dobytoday", "packbybag", "listbyaisle"], description: "Which list to show (default all)" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_items", title: "Add to a list",
    description: "Add items to one of the person's lists. DobyToday: new jobs go to the top of the to-do list; give a future day (YYYY-MM-DD) to put them on that day instead; urgent=true marks them ❗ (top), not_urgent=true marks them ↓ (bottom). PackbyBag: optionally a bag (e.g. 'Hand luggage') and a person (a child's first name). ListbyAisle: just the items – they sort themselves into aisles.",
    inputSchema: {
      type: "object", required: ["site", "items"],
      properties: {
        site: SITE_PROP,
        items: { type: "array", items: { type: "string" }, description: "Short names, one item or job each, e.g. 'Pay the football club', 'Sun cream', 'Milk'" },
        section: { type: "string", description: "DobyToday section or PackbyBag bag to put them in (optional)" },
        day: { type: "string", description: "DobyToday only: a later day, YYYY-MM-DD (optional)" },
        urgent: { type: "boolean", description: "DobyToday only: mark them ❗ urgent (they go to the top)" },
        not_urgent: { type: "boolean", description: "DobyToday only: mark them ↓ not urgent (they go to the bottom)" },
        person: { type: "string", description: "PackbyBag only: whose bag (first name, optional)" },
      },
    },
  },
  {
    name: "update_items", title: "Tick, move or remove",
    description: "Change items already on a list: tick them off, untick them, remove them, mark them ❗ urgent or ↓ not urgent, or undo either (DobyToday), move them to another section/bag (or, on DobyToday, to a later day), or give them a short note or (DobyToday) a link. Use the item names as they appear in get_my_lists. For steps on a DobyToday page or project, use update_page instead.",
    inputSchema: {
      type: "object", required: ["site", "items", "action"],
      properties: {
        site: SITE_PROP,
        items: { type: "array", items: { type: "string" } },
        action: { type: "string", enum: ["tick", "untick", "remove", "mark_urgent", "unmark_urgent", "mark_not_urgent", "unmark_not_urgent", "move", "set_note", "set_link"] },
        text: { type: "string", description: "For set_note: a short note shown under the item (empty removes it)" },
        link: { type: "string", description: "For set_link (DobyToday): an https link opened by the job's 'Open ↗' button" },
        notes: { type: "object", additionalProperties: { type: "string" }, description: "For set_note: a different note for each item, as {item name: note} (items can then be left empty)" },
        links: { type: "object", additionalProperties: { type: "string" }, description: "For set_link: a different link for each item, as {item name: link}" },
        section: { type: "string", description: "For move: the DobyToday section or PackbyBag bag" },
        day: { type: "string", description: "For move on DobyToday: a later day, YYYY-MM-DD" },
      },
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "get_page", title: "Open a page or project",
    description: "Open one of the person's DobyToday pages (projects, plans and step lists kept under My saved lists – some are shared with family): its notes, every numbered step with ticks, details, answers and dated updates.",
    inputSchema: { type: "object", required: ["name"], properties: { name: PAGE_PROP } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "update_page", title: "Change a page or project",
    description: "Change a DobyToday page or project: tick or untick steps, add new steps, remove steps, add a dated update to a step (e.g. 'Rang PWC, waiting on the account number'), add details under a step, answer a step that asks a question, or rename a step. Refer to steps by number or name. Shared pages update for everyone who has the link.",
    inputSchema: {
      type: "object", required: ["name", "action"],
      properties: {
        name: PAGE_PROP,
        action: { type: "string", enum: ["tick", "untick", "add_steps", "remove", "add_update", "add_details", "answer", "rename"] },
        steps: { type: "array", items: { type: "string" }, description: "Step numbers or names; for add_steps, the new steps" },
        text: { type: "string", description: "For add_update, add_details (one per line), answer or rename" },
        who: { type: "string", description: "For add_update: whose update (first name)" },
      },
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "create_page", title: "Make a new page or project",
    description: "Make a new DobyToday page under My saved lists: a project, plan or checklist with numbered steps (each step can have details underneath). Good for anything with several steps, e.g. 'Sort the occupancy tax', 'Plan Sedona's party'.",
    inputSchema: {
      type: "object", required: ["name", "steps"],
      properties: {
        name: { type: "string" },
        steps: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string" }, details: { type: "array", items: { type: "string" } } } } },
        notes: { type: "string", description: "A short description shown at the top (optional)" },
        group: { type: "string", description: "A group to file it under in My saved lists (optional)" },
      },
    },
  },
  {
    name: "save_list", title: "Save a list to use again",
    description: "Save a list under a name in the person's 'My saved lists' (or 'My saved bags' on PackbyBag), to use again any time – e.g. 'Rhodes week', 'Weekly shop', 'Sunday reset'. Give items to save a new list, or leave items out to save a copy of what's on their current list. Saving with an existing name replaces that saved list.",
    inputSchema: {
      type: "object", required: ["site", "name"],
      properties: { site: SITE_PROP, name: { type: "string" }, items: { type: "array", items: { type: "string" } } },
    },
  },
];

function pageTool(S, a) {
  const act = a.action, who = String(a.who || "").trim().slice(0, 30);
  if (act === "add_steps") {
    const add = (a.steps || []).map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!add.length) return "Give the steps to add.";
    const have = new Set((S.own || []).map((o) => low(o.n)));
    const fresh = add.filter((n) => !have.has(low(n)));
    fresh.forEach((n) => S.own.push({ n, a: "other", b: "any", got: false }));
    return fresh.length ? "Added " + fresh.length + (fresh.length === 1 ? " step: " : " steps: ") + fresh.join(", ") + "." : "Already on the page: " + add.join(", ") + ".";
  }
  const { hit, miss } = findSteps(S, a.steps);
  if (!hit.length) return "None of those steps are on the page" + (miss.length ? ": " + miss.join(", ") : "") + ". Use the step number or its name from get_page.";
  const text = String(a.text || "").trim();
  if ((act === "add_update" || act === "add_details" || act === "answer" || act === "rename") && !text) return "Give the text.";
  if ((act === "add_update" || act === "add_details" || act === "answer" || act === "rename") && hit.length > 1) return "Do that one step at a time.";
  hit.forEach(({ o }) => {
    if (act === "tick") o.got = true;
    else if (act === "untick") o.got = false;
    else if (act === "remove") o._gone = true;
    else if (act === "add_update") o.up = (o.up || []).concat([{ w: who || "Assistant", d: todayISO(), t: text.slice(0, 500) }]);
    else if (act === "add_details") o.d = (o.d || []).concat(text.split(/\n+/).map((x) => x.replace(/^[-•*\s]+/, "").trim()).filter(Boolean));
    else if (act === "answer") { o.ans = text.slice(0, 1000); o.got = true; }
    else if (act === "rename") o.n = text.slice(0, 200);
  });
  S.own = S.own.filter((o) => !o._gone);
  const verb = { tick: "Ticked off", untick: "Unticked", remove: "Removed", add_update: "Added an update to", add_details: "Added details to", answer: "Answered", rename: "Renamed" }[act];
  if (!verb) return "Unknown action.";
  return verb + ": " + hit.map(({ o, i }) => (i + 1) + ". " + o.n).join(", ") + "." + (miss.length ? " Not found: " + miss.join(", ") + "." : "");
}

async function callTool(token, name, a) {
  a = a || {};
  if (name === "get_page" || name === "update_page" || name === "create_page") {
    const d = await loadSite(token, "dobytoday");
    d.L = Array.isArray(d.L) ? d.L : [];
    if (name === "create_page") {
      const title = String(a.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!title) return "Give the page a name.";
      if (d.L.some((l) => low(l.name) === low(title))) return "You already have a page called “" + title + "”. Use update_page to change it.";
      const own = (a.steps || []).map((x) => (typeof x === "string" ? { name: x } : x || {})).map((x) => ({ n: String(x.name || "").trim(), d: (x.details || []).map(String).filter(Boolean), a: "other", b: "any", got: false })).filter((o) => o.n);
      own.forEach((o) => { if (!o.d.length) delete o.d; });
      if (!own.length) return "Give the page some steps.";
      const S = Object.assign(freshList("dobytoday"), { keep: true, title, notes: String(a.notes || "").trim(), own, day: todayISO() });
      const l = { id: "p" + lid(), name: title, group: String(a.group || "").trim().slice(0, 30), pin: false, c: newCode(), s: {} };
      d.L.push(l);
      await savePage(token, d, l, S);
      return "Made the page “" + title + "” with " + own.length + " steps. It's in My saved lists on DobyToday (dobytoday.com).";
    }
    const f = findPage(d, a.name); if (f.error) return f.error;
    const S = await loadPage(token, f.l);
    if (name === "get_page") return describePage(f.l, S, true);
    const msg = pageTool(S, a);
    if (!/^(Added|Ticked|Unticked|Removed|Answered|Renamed)/.test(msg)) return msg;
    await savePage(token, d, f.l, S);
    return msg + " (" + pageName(f.l, S) + " on dobytoday.com)";
  }
  if (name === "get_my_lists") {
    const which = !a.site || a.site === "all" ? Object.keys(SITES) : [a.site];
    const out = [];
    for (const s of which) {
      if (!SITES[s]) continue;
      const d = await loadSite(token, s);
      if (s === "dobytoday" && Array.isArray(d.L) && d.L.length) {
        const ls = d.L.filter((l) => l && l.id);
        const pages = await Promise.all(ls.map((l) => loadPage(token, l).then((S) => "    – " + describePage(l, S, false)).catch(() => "    – " + (l.name || "Page"))));
        d.pagesText = pages.join("\n");
      }
      out.push(describe(s, d));
    }
    return out.join("\n\n") + "\n\nChanges show on the websites the next time they're opened or come back on screen.";
  }
  const site = a.site;
  if (!SITES[site]) return "Say which list: dobytoday (to-do), packbybag (packing) or listbyaisle (shopping).";
  const d = await loadSite(token, site);
  let msg;
  if (name === "add_items") msg = addItems(site, d.s, a);
  else if (name === "update_items") msg = updateItems(site, d.s, a);
  else if (name === "save_list") msg = saveCopy(site, d, a);
  else return null;
  if (!/^(Added|Already|Ticked|Unticked|Removed|Marked|No longer|Back to normal|Moved|Saved|Updated)/.test(msg)) return msg;   // nothing changed
  await saveSite(token, site, d);
  return msg + " (" + SITES[site].url.replace("https://", "") + ")";
}

// ---------- MCP over HTTP ----------
const INSTRUCTIONS = "These tools reach the person's own lists on three sites: DobyToday (to-do list, sorted by when), PackbyBag (packing list, sorted by bag) and ListbyAisle (shopping list, sorted by aisle). Call get_my_lists before changing things so you use their exact item and section names. DobyToday also has pages (projects and step lists under My saved lists): open them with get_page and change them with update_page. Keep item names short. Children are referred to by first name only. Make changes one call at a time – wait for each to finish before the next, never in parallel, or they can overwrite each other; to change many items, put them all in one call (items, notes or links).";

async function rpcMessage(token, m) {
  const id = m.id, reply = (result) => ({ jsonrpc: "2.0", id, result }), fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (m.method) {
    case "initialize":
      return reply({
        protocolVersion: (m.params && m.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "handy-little-lists", title: "Handy Little Lists", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      const p = m.params || {};
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, "Unknown tool: " + p.name);
      try { const text = await callTool(token, p.name, p.arguments); return reply({ content: [{ type: "text", text: text || "Done." }] }); }
      catch (e) { return reply({ content: [{ type: "text", text: "Sorry – that didn't work: " + (e && e.message || e) }], isError: true }); }
    }
    case "resources/list": return reply({ resources: [] });
    case "prompts/list": return reply({ prompts: [] });
    default: return id === undefined ? null : fail(-32601, "Method not found: " + m.method);
  }
}

export async function handle(req) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname.endsWith("/oauth-protected-resource")) {
    return json({ resource: resourceUrl(), authorization_servers: [base() + "/auth/v1"], bearer_methods_supported: ["header"], resource_name: "Handy Little Lists", scopes_supported: [] });
  }
  if (req.method === "GET") {
    if (/text\/event-stream/.test(req.headers.get("accept") || "")) return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
    return new Response("Handy Little Lists – the Claude / ChatGPT connector for DobyToday, PackbyBag and ListbyAisle. Add this address as a custom connector: " + resourceUrl(), { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", ...CORS } });
  const token = ((req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i) || [])[1];
  if (!token || !(await whoAmI(token))) return unauthorized();
  let body;
  try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => rpcMessage(token, m)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const r = await rpcMessage(token, body);
  return r ? json(r) : new Response(null, { status: 202, headers: CORS });
}

if (globalThis.Deno?.serve) Deno.serve(handle);
