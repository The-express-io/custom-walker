/* =====================================================================
   Find my team · a separate module for Walk Tracker
   ---------------------------------------------------------------------
   An event coordinator adds themselves, the staff and the client's on-site
   contact. Each person opens their own link on their phone. When they check
   in, their location is shared with the team (only until they check out).
   Anyone can then tap a teammate to get live walking directions to them,
   using Walk Tracker's own map and router, or jump to WhatsApp to message them.

   How it plugs in
   - Loaded after index.html's main script, so it uses Walk Tracker's map,
     tracking (start/last/lastAcc), router (followPerson) and relay helpers
     (relayPost/relayListen/seal/unseal) without changing them.
   - The switch at the top of the panel toggles Find Matt / Find my team.
     Find Matt keeps working exactly as before.

   Privacy and data
   - The event link carries the setup and a random event key. Locations are
     encrypted with that key (AES-GCM) before they go through the relay
     (ntfy.sh), so only people holding an event link can read them.
   - Location is only sent while checked in. Check out sends "off" and stops.
   - The relay keeps messages for about 12 hours; nothing else is stored
     anywhere except on each phone.
   ===================================================================== */
(() => {
const FT = {
  prefix: "cwteam-",                 // relay topic: cwteam-<event id>
  sendEveryMs: 10000,                // at most one location every 10 s…
  heartbeatMs: 60000,                // …and at least one a minute while checked in
  minMoveM: 8,                       // or sooner after moving this far
  staleMs: 3 * 60000,                // older than this shows "last seen"
  goneMs: 45 * 60000,                // older than this is dropped from the map
  history: "30m"                     // on opening, catch up on the last 30 minutes
};
const ROLES = ["Coordinator", "Lead Planner", "Server", "Bartender", "Sommelier", "Attendant", "Cook", "Driver", "Cleaner", "Client contact"];
const ROLE_COLOR = { "Coordinator": "#c1272d", "Lead Planner": "#14202b", "Server": "#2d5ba8", "Bartender": "#7a3fb0", "Sommelier": "#8e1c21",
  "Attendant": "#1a9e5c", "Cook": "#b26a00", "Driver": "#4a5560", "Cleaner": "#2f7f86", "Client contact": "#c97a00" };
const DEFAULT_ZONES = ["Entrance", "Main room", "Bar", "Kitchen", "Patio"];

/* ---------- styles (scoped to this module) ---------- */
document.head.append(el("style", {}, `
  :root{--team:#0f7a5c;--team-bg:#e9f6f1}
  @media (prefers-color-scheme:dark){:root{--team:#3ccf9a;--team-bg:#132a24}}
  .modes.two{grid-template-columns:1fr 1fr}
  .modes.two button[aria-pressed="true"][data-find="matt"]{background:var(--matt)}
  .modes.two button[aria-pressed="true"][data-find="team"]{background:var(--team)}
  body.ft-on #findBtn, body.ft-on #fmCard, body.ft-on #mattCard{display:none!important}
  body:not(.ft-on) #ftCard{display:none!important}
  #ftCard{border-color:var(--team);background:var(--team-bg)}
  #ftCard button:not(.ghost){background:var(--team)}
  #ftCard button.wa, #ftCard a.wa{background:#1da851;color:#fff}
  #ftCard a.btn{display:inline-flex;align-items:center;justify-content:center;font-weight:600;border-radius:8px;padding:10px 14px;text-decoration:none}
  #ftCard a.btn.ghost{border:1px solid var(--line);color:var(--fg)}
  #ftCard input,#ftCard select{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;min-width:0;width:100%}
  #ftCard label.f{display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--muted)}
  #ftCard .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  #ftCard .tm{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
  #ftCard .tm .acts{grid-column:1/-1;display:flex;gap:8px}
  #ftCard .tm .acts>*{flex:1}
  #ftCard .av{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px}
  #ftCard .av.off{opacity:.35}
  #ftCard .nm{font-weight:700}
  #ftCard .dd{font:600 15px var(--mono);text-align:right;white-space:nowrap}
  #ftCard .dd small{display:block;font:12px var(--mono);color:var(--muted)}
  #ftCard .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:5px;vertical-align:1px}
  #ftCard .dot.on{background:var(--good)}
  #ftCard .pill{font:700 11px var(--font);letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1.5px solid currentColor;justify-self:end}
  #ftCard .pill.on{color:var(--good)} #ftCard .pill.off{color:var(--muted)}
  #ftCard .chips{display:flex;flex-wrap:wrap;gap:6px}
  #ftCard .chips span{display:inline-flex;gap:4px;align-items:center;font-size:13px;padding:3px 4px 3px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel)}
  #ftCard .chips button{background:transparent!important;color:var(--muted);padding:0 6px;font-size:16px}
  #ftCard .link{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
  #ftCard .link button{white-space:nowrap}
  #ftCard .sec{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px}
  .ftpin{background:none;border:0;display:flex;flex-direction:column;align-items:center;cursor:pointer}
  .ftpin .ini{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 13px var(--font);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
  .ftpin .tag{font:600 12px var(--font);background:var(--team);color:#fff;border-radius:6px;padding:2px 7px;white-space:nowrap;margin-top:2px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
`));

/* ---------- small helpers ---------- */
const uid = (n = 9) => b64u.enc(crypto.getRandomValues(new Uint8Array(n)));
const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const digits = p => String(p || "").replace(/\D/g, "");
const jget = k => { try { return JSON.parse(load(k) || "null"); } catch (_) { return null; } };
const jset = (k, v) => store(k, v == null ? null : JSON.stringify(v));
const color = r => ROLE_COLOR[r] || "#14202b";
const msgLink = (p, ev) => digits(p?.phone) ? "https://wa.me/" + digits(p.phone) : (ev?.group || "");
const encCfg = cfg => b64u.enc(te.encode(JSON.stringify(cfg)));
const decCfg = s => JSON.parse(td.decode(b64u.dec(s)));
const linkFor = (cfg, pid) => location.origin + location.pathname + "#team=" + encCfg(cfg) + "." + pid;

/* ---------- state ---------- */
let mode = load("findMode") === "team" ? "team" : "matt";
let ev = jget("ftEvent");          // joined event: { id, k, name, venue, group, zones[], people[], rv }
let meId = load("ftMe");
let draft = jget("ftDraft");       // coordinator's editable copy (same shape as ev)
let view = "live";                 // "live" | "setup" | "links"
let key = null, es = null;
let pos = {};                      // person id -> { lat, lng, acc, zone, ts }
let on = load("ftOn") === "1", zone = load("ftZone") || "";
let sentAt = 0, sentPos = null;
let guide = null, track = {}, pins = {};

const person = id => ev?.people.find(p => p.id === id);
const me = () => person(meId);

/* ---------- switch: Find Matt / Find my team ---------- */
const sw = el("div", { class: "modes two", role: "group", "aria-label": "Find" },
  el("button", { type: "button", "data-find": "matt", onclick: () => setMode("matt") }, "📍 Find Matt"),
  el("button", { type: "button", "data-find": "team", onclick: () => setMode("team") }, "👥 Find my team"));
const card = el("div", { class: "card", id: "ftCard", "aria-live": "polite" });
$("findBtn").before(sw);
$("mattCard").after(card);

function setMode(m) {
  mode = m; store("findMode", m);
  document.body.classList.toggle("ft-on", m === "team");
  sw.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.find === m));
  if (m !== "team") { clearPins(); if (guide) stopFind(); }
  render();
}

/* ---------- relay: encrypted messages on the event topic ---------- */
async function connect() {
  es?.close(); es = null; key = null; pos = {};
  if (!ev) return;
  try { key = await crypto.subtle.importKey("raw", b64u.dec(ev.k), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
  catch (_) { key = null; return; }
  es = relayListen(FT.prefix + ev.id, m => { if (m.event === "message") onMessage(m.message); }, FT.history);
  es.onerror = () => { if (es?.readyState === 2) setTimeout(connect, 5000); };
  if (on) send(true);
}
async function post(obj) {
  if (!key || !ev) return false;
  try { await relayPost(FT.prefix + ev.id, await seal(key, obj)); return true; } catch (_) { return false; }
}
async function onMessage(raw) {
  let m; try { m = JSON.parse(raw); } catch (_) { return; }
  if (m.t !== "enc" || !key) return;
  let p; try { p = await unseal(key, m); } catch (_) { return; }     // not from this event: ignore
  if (p.t === "loc" && p.id && p.id !== meId) {
    if (!pos[p.id] || p.ts >= pos[p.id].ts) pos[p.id] = { lat: p.lat, lng: p.lng, acc: p.acc, zone: p.zone || "", ts: p.ts };
    if (guide === p.id) follow();
  } else if (p.t === "off" && p.id && p.id !== meId) {
    if (!pos[p.id] || (p.ts || 0) >= pos[p.id].ts) delete pos[p.id];
  } else if (p.t === "roster" && p.cfg && (p.cfg.rv || 0) > (ev.rv || 0)) {
    // the coordinator changed the team: take the new list, keep this event's id and key
    ev = { ...p.cfg, id: ev.id, k: ev.k }; jset("ftEvent", ev);
    if (!me()) { leave(true); return; }
  }
  liveRefresh();
}

/* ---------- sharing my location (only while checked in) ---------- */
async function send(force) {
  if (!on || !last || !key) return;
  const now = Date.now();
  if (!force && (now - sentAt < FT.sendEveryMs || (sentPos && distance(sentPos, last) < FT.minMoveM && now - sentAt < FT.heartbeatMs))) return;
  sentAt = now; sentPos = { ...last };
  if (!await post({ t: "loc", id: meId, lat: last.lat, lng: last.lng, acc: Math.round(lastAcc || 0), zone, ts: now })) sentAt = 0;
}
function checkIn() {
  on = true; store("ftOn", "1");
  if (watchId == null) start();
  sentAt = 0; send(true);
  setStatus(me()?.role === "Client contact" ? "Sharing your location with the team." : "Checked in · sharing your location with the team.", "ok");
  render();
}
function checkOut() {
  on = false; store("ftOn", null);
  post({ t: "off", id: meId, ts: Date.now() });
  if (watchId != null && !guide) stop();
  setStatus(me()?.role === "Client contact" ? "Stopped sharing your location." : "Checked out · your location is no longer shared.", "ok");
  render();
}
setInterval(() => { if (ev && on) send(false); if (mode === "team" && ev && view === "live") liveRefresh(); }, 4000);

/* ---------- finding a teammate: Walk Tracker's own directions ---------- */
function find(id) {
  const p = person(id), at = pos[id];
  if (!p || !at) return;
  guide = id; track = {};
  followPerson(p.name, at, track, true);
  setStatus(`Directions to ${p.name} (${p.role}). They update as ${p.name.split(" ")[0]} moves.`, "ok");
  liveRefresh();
}
function follow() {
  const p = person(guide), at = pos[guide];
  if (p && at) followPerson(p.name, at, track, true);
}
function stopFind() {
  const p = person(guide);
  guide = null; destMarker.setOpacity(1);
  if (dest.person && p) dest.name = p.name + "'s last location";
  liveRefresh();
}

/* ---------- map pins ---------- */
function clearPins() { for (const id in pins) map.removeLayer(pins[id]); pins = {}; }
function drawPins() {
  if (mode !== "team" || !ev) return clearPins();
  const now = Date.now();
  for (const p of ev.people) {
    const at = pos[p.id];
    if (p.id === meId || !at || now - at.ts > FT.goneMs) { if (pins[p.id]) { map.removeLayer(pins[p.id]); delete pins[p.id]; } continue; }
    if (pins[p.id]) { pins[p.id].setLatLng([at.lat, at.lng]); continue; }
    const html = el("div", { class: "ftpin", title: `Directions to ${p.name}` },
      el("span", { class: "ini", style: `background:${color(p.role)}` }, initials(p.name)), el("span", { class: "tag" }, p.name.split(" ")[0]));
    pins[p.id] = L.marker([at.lat, at.lng], { icon: L.divIcon({ className: "", html, iconSize: [60, 60], iconAnchor: [30, 20] }),
      keyboard: true, title: `${p.name}, ${p.role}`, zIndexOffset: 900 }).addTo(map).on("click", () => find(p.id));
  }
}

/* ---------- joining from a link ---------- */
function join(cfg, pid) {
  if (ev?.id !== cfg.id) { if (on) checkOut(); pos = {}; }
  if (ev?.id === cfg.id && (ev.rv || 0) > (cfg.rv || 0)) cfg = { ...ev };   // keep a newer roster we already have
  ev = cfg; meId = pid; jset("ftEvent", ev); store("ftMe", pid);
  view = "live"; connect(); setMode("team");
}
function leave(removed) {
  if (on) checkOut();
  if (guide) stopFind();
  es?.close(); es = null; ev = null; meId = null; pos = {};
  jset("ftEvent", null); store("ftMe", null); clearPins();
  if (removed) setStatus("You've been removed from this event's team.", "err");
  render();
}
function handleTeamLink() {
  const m = location.hash.match(/^#team=([\w-]+)\.([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  let cfg; try { cfg = decCfg(m[1]); } catch (_) { cfg = null; }
  if (!cfg?.id || !cfg.k || !cfg.people?.some(p => p.id === m[2])) return notice("Couldn't open this team link", "Ask your coordinator to send your personal link again, and open it exactly as sent.");
  join(cfg, m[2]);
}
addEventListener("hashchange", handleTeamLink);

/* ---------- coordinator setup ---------- */
function newDraft() { return { id: uid(), k: b64u.enc(crypto.getRandomValues(new Uint8Array(32))), name: "", venue: "", group: "", zones: [...DEFAULT_ZONES], people: [], rv: 0 }; }
function saveDraft() { jset("ftDraft", draft); }
async function publishDraft() {
  draft.rv = Date.now(); saveDraft();
  if (ev?.id === draft.id) {                     // live event on this phone: push the new roster to everyone
    ev = { ...draft }; jset("ftEvent", ev);
    const { k, ...cfg } = draft;                  // the key never travels through the relay
    await post({ t: "roster", cfg });
    if (!me()) leave(true);
  }
}

/* ---------- rendering ---------- */
function render() {
  if (mode !== "team") return;
  if (view === "setup") return renderSetup();
  if (view === "links") return renderLinks();
  if (!ev || !me()) return renderIntro();
  renderLive();
}
function renderIntro() {
  card.replaceChildren(
    el("b", {}, "Find my team"),
    el("span", { class: "muted" }, "For events. The coordinator adds the team, sends each person their own link, and everyone who checks in can find each other on the map, with walking directions and a WhatsApp button."),
    el("button", { type: "button", onclick: () => { draft ??= newDraft(); view = "setup"; render(); } }, draft?.people.length ? "Continue setting up the team" : "Set up a team"),
    el("span", { class: "muted" }, "Got a link from your coordinator? Open it on this phone and you're in."));
}
function renderSetup() {
  const d = draft;
  const f = (label, input) => el("label", { class: "f" }, label, input);
  const inp = (k, ph, type = "text") => { const i = el("input", { type, placeholder: ph }); i.value = d[k] || ""; i.oninput = () => { d[k] = i.value.trim(); saveDraft(); }; return i; };
  const zoneIn = el("input", { type: "text", placeholder: "Add a zone, e.g. Coat check", "aria-label": "New zone" });
  const addZone = () => { const v = zoneIn.value.trim(); if (!v) return; d.zones.push(v); saveDraft(); renderSetup(); card.querySelector("[aria-label='New zone']")?.focus(); };
  zoneIn.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addZone(); } };
  const nameIn = el("input", { type: "text", placeholder: "Name", "aria-label": "Name", autocomplete: "off" });
  const roleIn = el("select", { "aria-label": "Role" }, ...ROLES.map(r => el("option", {}, r)));
  roleIn.value = d.people.length ? "Server" : "Coordinator";
  const phoneIn = el("input", { type: "tel", inputmode: "tel", placeholder: "WhatsApp number, e.g. +1 202 555 0134 (optional)", "aria-label": "WhatsApp number" });
  const hint = el("span", { class: "hint", hidden: "" });
  const addPerson = e => {
    e.preventDefault();
    const n = nameIn.value.trim();
    if (!n) { hint.textContent = "Enter a name."; hint.hidden = false; return nameIn.focus(); }
    d.people.push({ id: uid(6), name: n.slice(0, 40), role: roleIn.value, phone: phoneIn.value.trim().slice(0, 20) });
    saveDraft(); renderSetup(); card.querySelector("[aria-label='Name']")?.focus();
  };
  card.replaceChildren(
    el("b", {}, "Set up the team"),
    f("Event name", inp("name", "Hart wedding · Saturday")),
    f("Venue", inp("venue", "The Foundry, 1055 Thomas Jefferson St NW")),
    f("WhatsApp group link", inp("group", "https://chat.whatsapp.com/…", "url")),
    el("span", { class: "muted" }, "In WhatsApp: group info → Invite via link → Copy link."),
    el("div", { class: "sec" }, "Venue zones"),
    el("div", { class: "chips" }, ...d.zones.map((z, i) => el("span", {}, z,
      el("button", { type: "button", "aria-label": "Remove " + z, onclick: () => { d.zones.splice(i, 1); saveDraft(); renderSetup(); } }, "×")))),
    el("div", { class: "row" }, zoneIn, el("button", { type: "button", class: "ghost", onclick: addZone, style: "flex:0 0 auto" }, "Add zone")),
    el("span", { class: "muted" }, "Zones help indoors, where phone GPS can be 10–30 m off."),
    el("div", { class: "sec" }, `Team (${d.people.length})`),
    ...d.people.map((p, i) => el("div", { class: "tm" },
      el("span", { class: "av", style: `background:${color(p.role)}` }, initials(p.name)),
      el("div", {}, el("div", { class: "nm" }, p.name), el("span", { class: "muted" }, p.role + (p.phone ? " · " + p.phone : ""))),
      el("button", { type: "button", class: "ghost", "aria-label": "Remove " + p.name, onclick: () => { d.people.splice(i, 1); saveDraft(); renderSetup(); } }, "Remove"))),
    el("form", { class: "fmform", onsubmit: addPerson },
      el("div", { class: "grid2" }, nameIn, roleIn), phoneIn, hint,
      el("button", { type: "submit", class: "ghost" }, d.people.length ? "Add another person" : "Add yourself first")),
    el("div", { class: "row" },
      el("button", { type: "button", onclick: async () => {
        if (!d.people.length) { hint.textContent = "Add at least one person."; hint.hidden = false; return; }
        await publishDraft(); view = "links"; render(); } }, "Save and get links"),
      el("button", { type: "button", class: "ghost", onclick: () => { view = "live"; render(); } }, "Back")));
}
function renderLinks() {
  const d = draft;
  const copy = async (url, btn) => {
    try { await navigator.clipboard.writeText(url); btn.textContent = "Copied"; setTimeout(() => btn.textContent = "Copy", 1500); }
    catch (_) { prompt("Copy this link", url); }
  };
  const share = async (p, url) => {
    const text = `${p.name}, here's your link for ${d.name || "the event"}${d.venue ? " at " + d.venue : ""}. Open it on your phone and tap Check in when you arrive.`;
    try { await navigator.share({ title: "Find my team", text, url }); } catch (_) { copy(url, null); }
  };
  card.replaceChildren(
    el("b", {}, "Send each person their link"),
    el("span", { class: "muted" }, "Each link opens Walk Tracker as that person. If you change the team later, phones already on the event update automatically."),
    ...d.people.map(p => {
      const url = linkFor(d, p.id);
      const cp = el("button", { type: "button", class: "ghost", onclick: e => copy(url, e.currentTarget) }, "Copy");
      return el("div", { class: "link" },
        el("div", {}, el("div", { class: "nm" }, p.name), el("span", { class: "muted" }, p.role)),
        el("div", { class: "row", style: "flex-wrap:nowrap" },
          navigator.share ? el("button", { type: "button", class: "ghost", onclick: () => share(p, url) }, "Send") : cp,
          navigator.share ? cp : null,
          el("button", { type: "button", onclick: () => join({ ...d }, p.id) }, "This is me")));
    }),
    el("div", { class: "row" },
      el("button", { type: "button", class: "ghost", onclick: () => { view = "setup"; render(); } }, "Edit team"),
      el("button", { type: "button", class: "ghost", onclick: () => { view = "live"; render(); } }, "Done")));
}
function renderLive() {
  const m = me(), isClient = m.role === "Client contact";
  const zoneSel = el("select", { "aria-label": "Where I am" }, el("option", { value: "" }, "I'm at… (optional)"), ...ev.zones.map(z => el("option", {}, z)));
  zoneSel.value = zone;
  zoneSel.onchange = () => { zone = zoneSel.value; store("ftZone", zone); send(true); };
  const canEdit = draft?.id === ev.id;
  card.replaceChildren(
    el("div", { class: "row", style: "align-items:center;justify-content:space-between" },
      el("div", {}, el("b", {}, ev.name || "Event"), el("div", { class: "muted" }, ev.venue || "")),
      el("span", { class: "pill " + (on ? "on" : "off") }, on ? "Sharing" : "Not sharing")),
    el("div", { class: "tm", style: "border-top:0;padding-top:0" },
      el("span", { class: "av", style: `background:${color(m.role)}` }, initials(m.name)),
      el("div", {}, el("div", { class: "nm" }, m.name + " (you)"), el("span", { class: "muted" }, m.role)),
      el("span", {}),
      el("div", { class: "acts" },
        on ? el("button", { type: "button", class: "ghost", onclick: checkOut }, isClient ? "Stop sharing" : "Check out")
           : el("button", { type: "button", onclick: checkIn }, isClient ? "Share my location" : "Check in"),
        ev.group ? el("a", { class: "btn wa", href: ev.group, target: "_blank", rel: "noopener" }, "Team chat") : null)),
    zoneSel,
    el("span", { class: "muted" }, on ? "Your location is shared with this team until you " + (isClient ? "stop sharing." : "check out.") + " Keep this page open; locking the phone pauses it."
                                      : "Your location is shared only while you're " + (isClient ? "sharing." : "checked in.")),
    el("div", { class: "sec" }, "Team"),
    el("div", { id: "ftList" }),
    el("div", { class: "row" },
      canEdit ? el("button", { type: "button", class: "ghost", onclick: () => { view = "setup"; render(); } }, "Edit team") : null,
      canEdit ? el("button", { type: "button", class: "ghost", onclick: () => { view = "links"; render(); } }, "Links") : null,
      el("button", { type: "button", class: "ghost", onclick: () => { if (confirm("Leave this event on this phone?")) leave(); } }, "Leave event")));
  liveRefresh();
}
function liveRefresh() {
  drawPins();
  const list = $("ftList");
  if (!list || !ev || mode !== "team" || view !== "live") return;
  const now = Date.now();
  const others = ev.people.filter(p => p.id !== meId).sort((a, b) => {
    const ca = a.role === "Coordinator" ? 0 : 1, cb = b.role === "Coordinator" ? 0 : 1; if (ca !== cb) return ca - cb;
    const oa = pos[a.id] ? 0 : 1, ob = pos[b.id] ? 0 : 1; if (oa !== ob) return oa - ob;
    if (last && pos[a.id] && pos[b.id]) return distance(last, pos[a.id]) - distance(last, pos[b.id]);
    return a.name.localeCompare(b.name);
  });
  const rows = others.map(p => {
    const at = pos[p.id], live = at && now - at.ts < FT.goneMs, stale = live && now - at.ts > FT.staleMs;
    const d = live && last ? distance(last, at) : null;
    const b = live && last ? bearing(last, at) : null;
    const status = !live ? [el("span", { class: "dot" }), "Not checked in"]
      : [el("span", { class: "dot on" }), at.zone || "On site", stale ? " · seen " + ago(at.ts) : ""];
    const msg = msgLink(p, ev);
    return el("div", { class: "tm" },
      el("span", { class: "av" + (live ? "" : " off"), style: `background:${color(p.role)}` }, initials(p.name)),
      el("div", {}, el("div", { class: "nm" }, p.name), el("span", { class: "muted" }, p.role + " · ", ...status)),
      el("div", { class: "dd" }, d != null ? el("span", { style: `display:inline-block;transform:rotate(${heading != null ? b - heading : b}deg)`, "aria-hidden": "true" }, "↑") : "",
        d != null ? " " + fmtDist(d) : "", d != null ? el("small", {}, "±" + Math.round(at.acc || 0) + " m") : ""),
      el("div", { class: "acts" },
        guide === p.id ? el("button", { type: "button", class: "ghost", onclick: stopFind }, "Stop directions")
          : el("button", { type: "button", ...(live ? {} : { disabled: "" }), onclick: () => find(p.id) }, live ? "Find " + p.name.split(" ")[0] : "Find"),
        msg ? el("a", { class: "btn wa", href: msg, target: "_blank", rel: "noopener" }, digits(p.phone) ? "Message" : "Team chat")
            : el("button", { type: "button", class: "ghost", disabled: "" }, "No WhatsApp")));
  });
  const tip = !last && others.some(p => pos[p.id]) ? el("span", { class: "muted" }, "Check in or tap Start tracking to see how far away each person is.") : null;
  list.replaceChildren(...(tip ? [tip] : []), ...(rows.length ? rows : [el("span", { class: "muted" }, "No one else on this team yet.")]));
}

/* ---------- start ---------- */
if (ev && !me()) { ev = null; meId = null; jset("ftEvent", null); }
setMode(mode);
connect();
if (ev && on && watchId == null) start();      // still checked in after a reload: pick tracking back up
handleTeamLink();
// A teammate stays the destination only while you're following them
setInterval(() => { if (guide && !(dest.person && dest.name === person(guide)?.name)) { guide = null; liveRefresh(); } }, 3000);
})();
