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
  picks: [], media: {}, selChar: null, busy: false, uploadFor: null
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
nameInput.addEventListener("input", () => { storageSet("torneo-name", nameInput.value); renderDetail(); });

// Cada personaje es de una sola persona y trae sus 2 colores
function charOwner(charId) { return state.picks.find(p => p.character === charId && p.owner !== state.owner); }
function myPick() { return state.picks.find(p => p.owner === state.owner); }
const colorNames = c => c.colors.map(id => COLORS[id]?.n.toLowerCase()).join(" y ");

state.msg = { text: "", kind: "" };
function setMsg(text, kind = "") {
  state.msg = { text, kind };
  const m = $("msg");
  if (m) { m.textContent = text; m.className = "msg " + kind; }
}

// Foto o mini video del personaje; si no hay, emblema con sus iniciales
const mediaCache = new Map();
function mediaEl(c, where = "card") {
  const m = state.media[c.id];
  const key = `${where}:${c.id}:${m?.url || ""}`;
  if (m?.url && mediaCache.has(key)) return mediaCache.get(key);
  const box = h("span", { class: "media" });
  if (m?.url) {
    mediaCache.set(key, box);
    if ((m.type || "").startsWith("video/")) {
      const v = h("video", { src: m.url, autoplay: true, loop: true, playsinline: true, "aria-label": c.name });
      v.muted = true;
      box.append(v);
    } else {
      box.append(h("img", { src: m.url, alt: c.name, loading: "lazy" }));
    }
  } else {
    box.classList.add("emblem");
    box.setAttribute("style", `background:${c.sig[0]};color:${c.sig[1]}`);
    box.setAttribute("aria-hidden", "true");
    box.textContent = c.short;
  }
  return box;
}

function dots(c) {
  return h("span", { class: "dots", "aria-hidden": "true" }, c.colors.map(id => h("i", { style: `background:${COLORS[id]?.hex}` })));
}

function selectChar(id) {
  state.selChar = id; setMsg(""); render();
  if (window.matchMedia("(max-width: 900px)").matches) $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderChars() {
  const box = $("chars"); box.replaceChildren();
  const mp = myPick();
  for (const c of CHARS) {
    const owner = charOwner(c.id);
    const mine = mp?.character === c.id;
    const card = h("div", { class: "card" },
      h("button", {
        class: "char" + (owner ? " taken" : "") + (mine ? " mine" : ""),
        "aria-pressed": String(state.selChar === c.id),
        onclick: () => selectChar(c.id)
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

// Panel lateral: foto grande, sus 2 colores y el botón para reservar
function renderDetail() {
  const box = $("detail"); box.replaceChildren();
  const c = CHAR_BY_ID[state.selChar];
  if (!c) {
    box.classList.add("empty");
    box.append("Toca un personaje para ver su foto y sus 2 colores.");
    return;
  }
  box.classList.remove("empty");
  const owner = charOwner(c.id), mp = myPick(), mine = mp?.character === c.id;
  const name = nameInput.value.trim();
  let label = mp ? `Cambiarme a ${c.name}` : `Reservar a ${c.name}`;
  if (mine) label = `${c.name} ya es tuyo`;
  else if (owner) label = "No disponible";
  const btn = h("button", { class: "btn primary", id: "reserve", onclick: reserve }, label);
  btn.disabled = !state.ready || state.busy || !!owner || mine || !name;
  box.append(
    mediaEl(c, "detail"),
    h("div", {}, h("h3", {}, c.name),
      h("span", { class: "status" + (owner ? " full" : "") + (mine ? " mine" : "") },
        owner ? `Ya lo tiene ${owner.name}. Elige otro personaje.` : (mine ? "Es tu personaje." : "Disponible"))),
    h("span", { class: "duo-label" }, "Sus 2 colores"),
    h("div", { class: "duo" }, c.colors.map(id => h("span", { class: "chip" },
      h("i", { style: `background:${COLORS[id]?.hex}` }), h("b", {}, COLORS[id]?.n)))),
    btn,
    !name && !owner && !mine ? h("span", { class: "msg" }, "Escribe tu nombre arriba para reservar.") : null,
    h("span", { class: "msg " + state.msg.kind, id: "msg", role: "status" }, state.msg.text)
  );
}

function renderList() {
  const list = $("list"); list.replaceChildren();
  const picks = [...state.picks].sort((a, b) => (a.at || 0) - (b.at || 0));
  $("count").textContent = picks.length;
  if (!picks.length) {
    list.append(h("li", { class: "empty-list", style: "display:block" },
      state.ready ? "Nadie ha elegido todavía. Sé el primero en la parrilla." : "Cargando la parrilla…"));
    return;
  }
  picks.forEach((p, i) => {
    const c = CHAR_BY_ID[p.character];
    const mine = p.owner === state.owner;
    list.append(h("li", { class: mine ? "me" : "" },
      h("span", { class: "pos" }, `P${i + 1}`),
      c ? mediaEl(c, "list") : h("span"),
      c ? dots(c) : h("span"),
      h("span", { class: "who" }, h("b", {}, p.name + (mine ? " (tú)" : "")),
        h("span", {}, c ? `${c.name} · ${colorNames(c)}` : p.character)),
      (mine || state.isOwner) ? h("button", { class: "rel", onclick: () => release(p) }, "Liberar") : h("span")
    ));
  });
}

function renderAdmin() {
  $("admin").hidden = !state.isOwner;
  $("show-login").hidden = state.isOwner;
}

function render() {
  renderChars(); renderDetail(); renderList(); renderAdmin();
  for (const v of document.querySelectorAll("video")) if (v.paused) v.play().catch(() => {});
}

async function reserve() {
  const c = CHAR_BY_ID[state.selChar], name = nameInput.value.trim();
  if (!c || !name) return;
  state.busy = true; setMsg("Reservando…"); renderDetail();
  try {
    await api("POST", "/api/pick", { character: c.id, name, token: state.token });
    setMsg(`Listo: eres ${c.name}. Ese día vienes de ${colorNames(c)}.`, "ok");
  } catch (e) { setMsg(e.message, "err"); }
  finally { state.busy = false; render(); }
}

async function release(p) {
  try {
    await api("DELETE", `/api/pick/${encodeURIComponent(p.id)}`, undefined, { "x-player-token": state.token });
    setMsg(`Se liberó ${CHAR_BY_ID[p.character]?.name}.`, "ok");
  } catch (e) { setMsg(e.message, "err"); }
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


function applyState(s) {
  state.picks = s.picks || []; state.media = s.media || {};
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
