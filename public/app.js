const $ = id => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "style") el.setAttribute("style", v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
function storageGet(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } }
function storageSet(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch {} }

let COLORS = {}, CHARS = [], CHAR_BY_ID = {};

const state = {
  token: null, owner: null, adminPass: null, isOwner: false, ready: false,
  picks: [], mode: "personaje", media: {}, selChar: null, selColor: null, busy: false, uploadFor: null
};

// Token secreto por navegador: identifica tu reserva sin cuentas
state.token = storageGet("torneo-token");
if (!state.token) {
  state.token = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, "0")).join("");
  storageSet("torneo-token", state.token);
}

async function sha256Short(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function api(method, url, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (state.adminPass) opts.headers["x-admin-password"] = state.adminPass;
  if (body instanceof Blob) { opts.body = body; opts.headers["Content-Type"] = body.type; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo completar. Inténtalo de nuevo.");
  return data;
}

const nameInput = $("name");
nameInput.value = storageGet("torneo-name") || "";
nameInput.addEventListener("input", () => { storageSet("torneo-name", nameInput.value); renderAction(); });

// Cada personaje es de una sola persona; el color solo se bloquea si el organizador lo pide
function charOwner(charId) { return state.picks.find(p => p.character === charId && p.owner !== state.owner); }
function colorOwner(colorId) {
  return state.mode === "global" ? state.picks.find(p => p.color === colorId && p.owner !== state.owner) : null;
}
function myPick() { return state.picks.find(p => p.owner === state.owner); }
function setMsg(text, kind = "") { const m = $("msg"); m.textContent = text; m.className = "msg " + kind; }

// Foto o mini video del personaje; si no hay, emblema con sus iniciales
const mediaCache = new Map();
function mediaEl(c, where = "card") {
  const m = state.media[c.id];
  const key = `${where}:${c.id}:${m?.url || ""}`;
  if (m?.url && mediaCache.has(key)) return mediaCache.get(key);
  const box = h("span", { class: "media" });
  if (m?.url) {
    mediaCache.set(key, box);
    const src = m.url;
    if ((m.type || "").startsWith("video/")) {
      const v = h("video", { src, autoplay: true, loop: true, playsinline: true, "aria-label": c.name });
      v.muted = true;
      box.append(v);
    } else {
      box.append(h("img", { src, alt: c.name, loading: "lazy" }));
    }
  } else {
    box.classList.add("emblem");
    box.setAttribute("style", `background:${c.sig[0]};color:${c.sig[1]}`);
    box.setAttribute("aria-hidden", "true");
    box.textContent = c.short;
  }
  return box;
}

function renderChars() {
  const box = $("chars"); box.replaceChildren();
  for (const c of CHARS) {
    const owner = charOwner(c.id);
    const mine = myPick()?.character === c.id;
    const card = h("div", { class: "card" },
      h("button", {
        class: "char" + (owner ? " taken" : "") + (mine ? " mine" : ""),
        "aria-pressed": String(state.selChar === c.id),
        disabled: !!owner,
        onclick: () => { state.selChar = c.id; state.selColor = null; setMsg(""); render(); }
      },
        mediaEl(c),
        h("span", { class: "nm" }, c.name),
        h("span", { class: "free" + (owner ? " full" : "") }, owner ? `Lo tiene ${owner.name}` : (mine ? "Es tuyo" : "Disponible"))
      ));
    if (state.isOwner) {
      const has = !!state.media[c.id]?.uploaded;
      card.append(h("div", { class: "owner-tools" },
        h("button", { onclick: () => pickMedia(c.id) }, has ? "Cambiar foto/video" : "Subir foto/video"),
        has ? h("button", { onclick: () => removeMedia(c.id) }, "Quitar") : null
      ));
    }
    box.append(card);
  }
}

function renderSwatches() {
  const box = $("swatches"); box.replaceChildren();
  const c = CHAR_BY_ID[state.selChar];
  $("color-title").textContent = c ? `Color de ${c.name}` : "Color";
  if (!c) { box.append(h("div", { class: "colors-empty" }, "Primero elige un personaje.")); return; }
  const owner = charOwner(c.id);
  box.append(h("div", { class: "preview" }, mediaEl(c, "preview"),
    h("p", {}, h("b", {}, c.name), owner ? `Ya lo tiene ${owner.name}. Elige otro personaje.` : "Elige de qué color vas a ir.")));
  const grid = h("div", { class: "swatches" });
  const mp = myPick();
  for (const colId of c.colors) {
    const col = COLORS[colId];
    const mine = mp && mp.character === c.id && mp.color === colId;
    const other = colorOwner(colId);
    const t = owner || other;
    let sub = "Libre";
    if (mine) sub = "Tu color";
    else if (owner) sub = "No disponible";
    else if (other) sub = `Ya va de ${col.n.toLowerCase()}: ${other.name}`;
    grid.append(h("button", {
      class: "sw" + (t && !mine ? " taken" : "") + (mine ? " mine" : ""),
      "aria-pressed": String(state.selColor === colId),
      disabled: !!(t && !mine),
      "aria-label": `${col.n}: ${sub}`,
      onclick: () => { state.selColor = colId; setMsg(""); render(); }
    },
      h("span", { class: "dot", style: `background:${col.hex}` }),
      h("span", { class: "lbl" }, col.n, h("span", { class: "sub" }, sub))
    ));
  }
  box.append(grid);
}

function renderAction() {
  const btn = $("reserve");
  const c = CHAR_BY_ID[state.selChar], col = COLORS[state.selColor];
  const mp = myPick();
  const already = mp && c && mp.character === c.id && mp.color === state.selColor;
  if (c && col) btn.textContent = already ? `Ya es tuyo: ${c.name} ${col.n.toLowerCase()}`
    : (mp ? `Cambiar a ${c.name} ${col.n.toLowerCase()}` : `Reservar ${c.name} ${col.n.toLowerCase()}`);
  else btn.textContent = "Reservar";
  btn.disabled = !state.ready || state.busy || !c || !col || already || !nameInput.value.trim();
}

function renderList() {
  const list = $("list"); list.replaceChildren();
  const picks = [...state.picks].sort((a, b) => (a.at || 0) - (b.at || 0));
  $("count").textContent = picks.length;
  $("mode-label").textContent = state.mode === "global" ? "Personaje y color únicos" : "Un personaje por persona";
  $("mode-hint").textContent = state.mode === "global"
    ? "Nadie más puede ir del mismo color"
    : "El color es el que usarás ese día";
  if (!picks.length) {
    list.append(h("li", { class: "empty-list", style: "display:block" },
      state.ready ? "Nadie ha elegido todavía. Sé el primero en la parrilla." : "Cargando la parrilla…"));
    return;
  }
  picks.forEach((p, i) => {
    const c = CHAR_BY_ID[p.character], col = COLORS[p.color];
    const mine = p.owner === state.owner;
    list.append(h("li", { class: mine ? "me" : "" },
      h("span", { class: "pos" }, `P${i + 1}`),
      h("span", { class: "pdot", style: `background:${col?.hex || "#999"}`, title: col?.n || "" }),
      h("span", { class: "who" }, h("b", {}, p.name + (mine ? " (tú)" : "")), h("span", {}, `${c?.name || p.character} · ${col?.n || p.color}`)),
      (mine || state.isOwner) ? h("button", { class: "rel", onclick: () => release(p) }, "Liberar") : h("span")
    ));
  });
}

function renderAdmin() {
  $("admin").hidden = !state.isOwner;
  $("show-login").hidden = state.isOwner;
  for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
}

function render() {
  renderChars(); renderSwatches(); renderAction(); renderList(); renderAdmin();
  for (const v of document.querySelectorAll("video")) if (v.paused) v.play().catch(() => {});
}

async function reserve() {
  const c = CHAR_BY_ID[state.selChar], colId = state.selColor, name = nameInput.value.trim();
  if (!c || !colId || !name) return;
  state.busy = true; renderAction(); setMsg("Reservando…");
  try {
    await api("POST", "/api/pick", { character: c.id, color: colId, name, token: state.token });
    setMsg(`Listo: eres ${c.name} ${COLORS[colId].n.toLowerCase()}. Ve preparando la ropa.`, "ok");
  } catch (e) { setMsg(e.message, "err"); }
  finally { state.busy = false; render(); }
}

async function release(p) {
  try {
    await api("DELETE", `/api/pick/${encodeURIComponent(p.id)}`, undefined, { "x-player-token": state.token });
    setMsg(`Se liberó ${CHAR_BY_ID[p.character]?.name} ${COLORS[p.color]?.n.toLowerCase()}.`, "ok");
  } catch (e) { setMsg(e.message, "err"); }
}

async function setMode(mode) {
  if (mode === state.mode) return;
  try { await api("POST", "/api/admin/mode", { mode }); } catch (e) { setMsg(e.message, "err"); }
}

function pickMedia(charId) {
  state.uploadFor = charId;
  const inp = $("media-file"); inp.value = ""; inp.click();
}
$("media-file").addEventListener("change", async e => {
  const file = e.target.files[0], charId = state.uploadFor;
  if (!file || !charId) return;
  const c = CHAR_BY_ID[charId], kind = file.type.startsWith("video/") ? "video" : "foto";
  if (file.size > 20 * 1024 * 1024) return setMsg("El archivo pesa más de 20 MB. Usa uno más liviano.", "err");
  setMsg(`Subiendo ${kind} de ${c.name}…`);
  try { await api("PUT", `/api/admin/media/${charId}`, file); setMsg(`Listo: ${c.name} ya tiene su ${kind}.`, "ok"); }
  catch (err) { setMsg(err.message, "err"); }
});
async function removeMedia(charId) {
  try { await api("DELETE", `/api/admin/media/${charId}`); setMsg(`Se quitó la imagen de ${CHAR_BY_ID[charId].name}.`, "ok"); }
  catch (e) { setMsg(e.message, "err"); }
}

// Modo organizador: contraseña guardada solo durante la sesión del navegador
$("show-login").addEventListener("click", () => { $("login").hidden = false; $("admin-pass").focus(); });
$("login").addEventListener("submit", async e => {
  e.preventDefault();
  state.adminPass = $("admin-pass").value;
  try {
    await api("POST", "/api/admin/login");
    state.isOwner = true; storageSet("torneo-admin", state.adminPass, sessionStorage);
    $("login").hidden = true; $("admin-pass").value = ""; render();
  } catch (err) {
    state.adminPass = null;
    $("login-msg").textContent = err.message; $("login-msg").className = "msg err";
  }
});
$("logout").addEventListener("click", () => {
  state.isOwner = false; state.adminPass = null; storageSet("torneo-admin", null, sessionStorage); render();
});

$("reserve").addEventListener("click", reserve);
for (const b of document.querySelectorAll(".seg button")) b.addEventListener("click", () => setMode(b.dataset.mode));

function applyState(s) {
  state.picks = s.picks || []; state.mode = s.mode === "global" ? "global" : "personaje"; state.media = s.media || {};
  state.ready = true; render();
}

function connect() {
  const es = new EventSource("/api/events");
  es.onmessage = ev => { try { applyState(JSON.parse(ev.data)); $("banner").hidden = true; } catch {} };
  es.onerror = () => {
    const b = $("banner"); b.textContent = "Reconectando con la parrilla…"; b.hidden = false;
  };
}

(async () => {
  const data = await fetch("/characters.json").then(r => r.json());
  COLORS = data.colors; CHARS = data.characters;
  CHAR_BY_ID = Object.fromEntries(CHARS.map(c => [c.id, c]));
  state.owner = await sha256Short(state.token);
  const saved = storageGet("torneo-admin", sessionStorage);
  if (saved) {
    state.adminPass = saved;
    try { await api("POST", "/api/admin/login"); state.isOwner = true; }
    catch { state.adminPass = null; storageSet("torneo-admin", null, sessionStorage); }
  }
  render();
  connect();
})();
