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
  return d;
}
async function saveSite(token, site, d) {
  d.t = Date.now();   // newer than the phone's copy, so the site takes these changes when it next opens
  await rpc(token, "hlt_save", { p_site: site, p_data: d });
}

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
  (S.own || []).forEach((o, i) => out.push({ n: o.n, got: !!o.got, own: i, key: o.b || "", who: o.w || "" }));
  return out;
}
function describe(site, d) {
  const S = d.s, all = entries(S), lines = [];
  const tick = (e) => (e.got ? "☑ " : "☐ ") + (site === "dobytoday" && (S.urg || {})[e.n] ? "❗ " : "") + (e.who ? e.who + ": " : "") + e.n;
  if (site === "dobytoday") {
    const secs = sections(S), live = (k) => (secs.some((s) => s[0] === k) ? k : (secs.find((s) => s[0] === "any") || secs[0])[0]);
    lines.push("DobyToday – My to-do list (sections: " + secs.map((s) => s[1]).join(", ") + ")");
    secs.forEach(([k, l]) => {
      const rows = all.filter((e) => (e.own !== null || e.key) && live(e.key || "any") === k);
      if (rows.length) { lines.push("  " + l + ":"); rows.forEach((e) => lines.push("    " + tick(e))); }
    });
    const ready = all.filter((e) => e.own === null && !e.key);   // ready-made jobs sit in the section the site gives them
    if (ready.length) { lines.push("  Also on today's list:"); ready.forEach((e) => lines.push("    " + tick(e))); }
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
    if (e.length === 1 || (e.length > 1 && e.every((x) => low(x.n) === low(e[0].n)))) hit.push(e[0]); else miss.push(raw + (e.length > 1 ? " (matches " + e.map((x) => x.n).join(", ") + " – be more exact)" : ""));
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
    if (site === "dobytoday" && a.urgent) { S.urg = S.urg || {}; S.urg[n] = 1; }
    added.push(n);
  });
  const where = later ? " for " + later : p.label ? " to " + p.label : "";
  return ((added.length ? "Added " + added.length + where + ": " + added.join(", ") + "." : "") + (skipped.length ? " Already on the list" + (site === "dobytoday" && a.urgent ? " (now marked ❗ urgent)" : "") + ": " + skipped.join(", ") + "." : "")).trim();
}
function updateItems(site, S, a) {
  const act = a.action, { hit, miss } = findItems(S, (a.items || []).map(String));
  if (!hit.length) return "None of those are on the list" + (miss.length ? ": " + miss.join(", ") : "") + ".";
  let p = { key: "" };
  if (act === "move" && !(site === "dobytoday" && a.day)) { p = resolvePlace(site, S, a.section || a.bag); if (p.error) return p.error; if (!p.key) return "Say which " + (site === "dobytoday" ? "section" : "bag") + " to move them to."; }
  if ((act === "mark_urgent" || act === "unmark_urgent") && site !== "dobytoday") return "Urgent marks are only on DobyToday.";
  hit.forEach((e) => {
    const o = e.own === null ? null : S.own[e.own];
    if (act === "tick") { if (o) o.got = true; else S.got[e.n] = 1; }
    else if (act === "untick") { if (o) o.got = false; else delete S.got[e.n]; }
    else if (act === "remove") removeEntry(S, e);
    else if (act === "mark_urgent") { S.urg = S.urg || {}; S.urg[e.n] = 1; }
    else if (act === "unmark_urgent") { if (S.urg) delete S.urg[e.n]; }
    else if (act === "move") {
      if (site === "dobytoday" && a.day && a.day > todayISO()) { const b = o ? o.b : (S.bag || {})[e.n] || "any"; removeEntry(S, e); S.later = (S.later || []).concat([{ id: lid(), n: e.n, d: a.day, a: o ? o.a : "", b }]); }
      else if (o) o.b = p.key; else { S.bag = S.bag || {}; S.bag[e.n] = p.key; }
    }
  });
  tidy(S);
  const verb = { tick: "Ticked off", untick: "Unticked", remove: "Removed", mark_urgent: "Marked urgent", unmark_urgent: "No longer urgent", move: "Moved" }[act] || act;
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
const TOOLS = [
  {
    name: "get_my_lists", title: "See my lists",
    description: "Show what is on the signed-in person's lists: their DobyToday to-do list (with its sections, ❗ urgent jobs and jobs for later days), their PackbyBag packing list and their ListbyAisle shopping list, plus the names of their saved lists. Call this first to see exact item and section names.",
    inputSchema: { type: "object", properties: { site: { type: "string", enum: ["all", "dobytoday", "packbybag", "listbyaisle"], description: "Which list to show (default all)" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_items", title: "Add to a list",
    description: "Add items to one of the person's lists. DobyToday: jobs go into a section (use the person's own section names from get_my_lists, e.g. 'Today'); give a future day (YYYY-MM-DD) to put them on that day instead; urgent=true marks them ❗. PackbyBag: optionally a bag (e.g. 'Hand luggage') and a person (a child's first name). ListbyAisle: just the items – they sort themselves into aisles.",
    inputSchema: {
      type: "object", required: ["site", "items"],
      properties: {
        site: SITE_PROP,
        items: { type: "array", items: { type: "string" }, description: "Short names, one item or job each, e.g. 'Pay the football club', 'Sun cream', 'Milk'" },
        section: { type: "string", description: "DobyToday section or PackbyBag bag to put them in (optional)" },
        day: { type: "string", description: "DobyToday only: a later day, YYYY-MM-DD (optional)" },
        urgent: { type: "boolean", description: "DobyToday only: mark them ❗ urgent" },
        person: { type: "string", description: "PackbyBag only: whose bag (first name, optional)" },
      },
    },
  },
  {
    name: "update_items", title: "Tick, move or remove",
    description: "Change items already on a list: tick them off, untick them, remove them, mark or unmark them ❗ urgent (DobyToday), or move them to another section/bag (or, on DobyToday, to a later day). Use the item names as they appear in get_my_lists.",
    inputSchema: {
      type: "object", required: ["site", "items", "action"],
      properties: {
        site: SITE_PROP,
        items: { type: "array", items: { type: "string" } },
        action: { type: "string", enum: ["tick", "untick", "remove", "mark_urgent", "unmark_urgent", "move"] },
        section: { type: "string", description: "For move: the DobyToday section or PackbyBag bag" },
        day: { type: "string", description: "For move on DobyToday: a later day, YYYY-MM-DD" },
      },
    },
    annotations: { destructiveHint: true },
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

async function callTool(token, name, a) {
  a = a || {};
  if (name === "get_my_lists") {
    const which = !a.site || a.site === "all" ? Object.keys(SITES) : [a.site];
    const out = [];
    for (const s of which) { if (!SITES[s]) continue; out.push(describe(s, await loadSite(token, s))); }
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
  if (!/^(Added|Already|Ticked|Unticked|Removed|Marked|No longer|Moved|Saved|Updated)/.test(msg)) return msg;   // nothing changed
  await saveSite(token, site, d);
  return msg + " (" + SITES[site].url.replace("https://", "") + ")";
}

// ---------- MCP over HTTP ----------
const INSTRUCTIONS = "These tools reach the person's own lists on three sites: DobyToday (to-do list, sorted by when), PackbyBag (packing list, sorted by bag) and ListbyAisle (shopping list, sorted by aisle). Call get_my_lists before changing things so you use their exact item and section names. Keep item names short. Children are referred to by first name only.";

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
