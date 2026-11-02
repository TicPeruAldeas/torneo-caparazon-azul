const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
// Con volumen de Railway se guarda siempre ahí, aunque DATA_DIR esté mal configurada
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const MEDIA_DIR = path.join(DATA_DIR, "media");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MAX_UPLOAD = 20 * 1024 * 1024;

const CHARS = require("./public/characters.json");
const CHAR_BY_ID = Object.fromEntries(CHARS.characters.map(c => [c.id, c]));
const MEDIA_TYPES = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm"
};

fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Estado: picks = reservas (un personaje por persona), media = foto/video subido por personaje
let state = { picks: [], media: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}

function save() {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// Torneo de la tarde: 12 jugadores y 12 partidas en parejas
const MATCHES = 12, PLAYERS = 12;

// Restaura reservas perdidas desde restore.json, una sola vez por id y sin pisar personajes ya tomados.
// El dueño queda al azar: solo el organizador puede liberarlas.
try {
  const restore = JSON.parse(fs.readFileSync(path.join(__dirname, "restore.json"), "utf8"));
  state.restored = state.restored || [];
  if (restore.id && !state.restored.includes(restore.id)) {
    const base = Math.min(Date.now(), ...state.picks.map(p => p.at || Date.now())) - restore.picks.length * 1000;
    let added = 0;
    restore.picks.forEach((r, i) => {
      if (!CHAR_BY_ID[r.character] || state.picks.some(p => p.character === r.character)) return;
      state.picks.push({ id: r.character, character: r.character, name: String(r.name).slice(0, 40),
        owner: crypto.randomBytes(12).toString("hex"), token: crypto.randomBytes(24).toString("hex"), at: base + i * 1000 });
      added++;
    });
    state.restored.push(restore.id);
    save();
    console.log(`Restauradas ${added} de ${restore.picks.length} reservas (${restore.id})`);
  }
  // Reinicio del torneo (resultados en cero), una vez por id; conserva jugadores y, si se pide, los números del sorteo
  for (const r of restore.resets || []) {
    if (!r.id || state.restored.includes(r.id)) continue;
    state.tournament = { ...emptyTournament(), numbers: r.keepNumbers ? { ...(state.tournament?.numbers || {}) } : {} };
    state.restored.push(r.id);
    save();
    console.log(`Torneo reiniciado (${r.id})${r.keepNumbers ? ", números conservados" : ""}`);
  }
  // Cambios de personaje para quien ya reservó (p. ej. un personaje que se quitó), una vez por id
  for (const m of restore.moves || []) {
    if (!m.id || state.restored.includes(m.id) || !CHAR_BY_ID[m.to]) continue;
    const pick = state.picks.find(p => p.character === m.from);
    const taken = state.picks.some(p => p.character === m.to && p !== pick);
    if (pick && !taken) { pick.character = m.to; pick.id = m.to; }
    state.restored.push(m.id);
    save();
    console.log(`Cambio ${m.from} → ${m.to}: ${pick && !taken ? pick.name : "sin cambios"}`);
  }
  // Cambios de plantel, una vez por id: quitar reservas, fijar números y quién no juega Smash
  for (const e of restore.edits || []) {
    if (!e.id || state.restored.includes(e.id)) continue;
    const t = state.tournament = { ...emptyTournament(), ...(state.tournament || {}) };
    t.numbers = { ...(t.numbers || {}) };
    for (const ch of e.remove || []) {
      const p = state.picks.find(x => x.character === ch);
      if (p) { state.picks = state.picks.filter(x => x !== p); delete t.numbers[p.id]; console.log(`Reserva quitada: ${p.name} (${ch})`); }
    }
    for (const [id, n] of Object.entries(e.numbers || {})) if (state.picks.some(p => p.id === id)) {
      for (const [k, v] of Object.entries(t.numbers)) if (v === n) delete t.numbers[k];
      t.numbers[id] = n;
    }
    for (const [id, n] of Object.entries(t.numbers)) if (!(n >= 1 && n <= PLAYERS)) delete t.numbers[id];
    if (e.smashOut) t.smashOut = e.smashOut.filter(id => state.picks.some(p => p.id === id));
    t.draw = { at: 0, id: "" };
    state.restored.push(e.id);
    save();
    console.log(`Plantel actualizado (${e.id})`);
  }
  // Cambio de meta en Tennis, una vez por id: el ganador anotado con la meta vieja pasa a la nueva
  for (const r of restore.tennisTo || []) {
    if (!r.id || state.restored.includes(r.id)) continue;
    let n = 0;
    for (const m of Object.values(state.tournament?.tennis || {})) {
      if (m.a === r.from && m.b < r.from) { m.a = r.to; n++; }
      else if (m.b === r.from && m.a < r.from) { m.b = r.to; n++; }
    }
    state.restored.push(r.id);
    save();
    console.log(`Tennis a ${r.to}: ${n} resultados actualizados (${r.id})`);
  }
} catch (err) {
  if (err.code !== "ENOENT") console.error("No se pudo restaurar:", err.message);
}

const hashToken = t => crypto.createHash("sha256").update(String(t)).digest("hex").slice(0, 24);

// Imágenes por defecto: public/img/<id del personaje>.<png|jpg|webp|gif|mp4|webm>
const IMG_DIR = path.join(__dirname, "public", "img");
const EXT_TYPES = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([t, e]) => [e, t]));
EXT_TYPES.jpeg = "image/jpeg";
const defaultMedia = {};
try {
  for (const f of fs.readdirSync(IMG_DIR)) {
    const ext = path.extname(f).slice(1).toLowerCase(), id = path.basename(f, path.extname(f)).toLowerCase();
    if (CHAR_BY_ID[id] && EXT_TYPES[ext]) defaultMedia[id] = { url: "/img/" + encodeURIComponent(f), type: EXT_TYPES[ext] };
  }
} catch {}

// Lo que ven todos: nunca el token, solo su hash. Lo subido desde la página gana sobre public/img
function publicState() {
  const media = { ...defaultMedia };
  for (const [id, m] of Object.entries(state.media)) media[id] = { url: "/media/" + encodeURIComponent(m.file), type: m.type, uploaded: true };
  return {
    media,
    picks: state.picks.map(({ token, ...p }) => p),
    tournament: state.tournament || emptyTournament(),
    now: Date.now()
  };
}

// Torneo de la tarde: números del sorteo, resultados de los 3 juegos y qué se ve en la transmisión
const SMASH_STAGES = ["campeon", "sub", "tercero", "cuarto", "cuartos", "primera"];
const VIEWS = ["auto", "general", "mk", "tennis", "smash", "partida", "calendario", "podio", "reglas", "sorteo"];
const SLIDES = 7;
const GAMES = ["mk", "tennis", "smash"];
function emptyTournament() {
  return { numbers: {}, smashOut: [], mk: {}, tennis: {}, smash: {}, tb: { mk: {}, tennis: {} }, view: "auto", current: { game: "mk", match: 0 }, countdown: { until: 0, autoStart: false }, slide: 0, draw: { at: 0, id: "" },
    timers: { match: { acc: 0, start: 0, running: false }, total: { acc: 0, start: 0, running: false } } };
}
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const obj = v => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};

function sanitizeTournament(input) {
  const t = obj(input), out = emptyTournament();
  const pickIds = new Set(state.picks.map(p => p.id)), usedNums = new Set();
  for (const [id, n] of Object.entries(obj(t.numbers))) {
    if (pickIds.has(id) && intIn(n, 1, PLAYERS) && !usedNums.has(n)) { out.numbers[id] = n; usedNums.add(n); }
  }
  // Jugadores que no juegan Smash (por reserva)
  if (Array.isArray(t.smashOut)) out.smashOut = [...new Set(t.smashOut.filter(id => pickIds.has(id)))];
  for (const [m, res] of Object.entries(obj(t.mk))) {
    if (!intIn(+m, 0, MATCHES - 1)) continue;
    const r = {};
    for (const [num, pos] of Object.entries(obj(res))) if (intIn(+num, 1, PLAYERS) && intIn(pos, 1, 24)) r[num] = pos;
    if (Object.keys(r).length) out.mk[m] = r;
  }
  for (const [m, res] of Object.entries(obj(t.tennis))) {
    const r = obj(res);
    if (intIn(+m, 0, MATCHES - 1) && intIn(r.a, 0, 7) && intIn(r.b, 0, 7)) out.tennis[m] = { a: r.a, b: r.b };
  }
  for (const [num, stage] of Object.entries(obj(t.smash))) if (intIn(+num, 1, PLAYERS) && SMASH_STAGES.includes(stage)) out.smash[num] = stage;
  for (const g of ["mk", "tennis"]) for (const [num, v] of Object.entries(obj(obj(t.tb)[g]))) if (intIn(+num, 1, PLAYERS) && intIn(v, 1, 99)) out.tb[g][num] = v;
  if (VIEWS.includes(t.view)) out.view = t.view;
  const cur = obj(t.current);
  if (GAMES.includes(cur.game)) out.current.game = cur.game;
  if (intIn(cur.match, 0, MATCHES - 1)) out.current.match = cur.match;
  // Cuenta regresiva con la hora del servidor: countdownSeconds la inicia (0 la cancela); si no, se conserva
  if (intIn(t.countdownSeconds, 0, 3600)) out.countdown.until = t.countdownSeconds ? Date.now() + t.countdownSeconds * 1000 : 0;
  else {
    const until = obj(t.countdown).until;
    if (Number.isInteger(until) && until >= 0 && until <= Date.now() + 3600 * 1000) out.countdown.until = until;
  }
  // Al terminar la cuenta regresiva arranca el cronómetro de partida (lo decide el servidor, no el cliente)
  const prevCd = state.tournament?.countdown || {};
  out.countdown.autoStart = intIn(t.countdownSeconds, 1, 3600) ? true : out.countdown.until === prevCd.until && out.countdown.until > 0 ? !!prevCd.autoStart : false;
  // Presentación de reglas y sorteo en vivo
  if (intIn(t.slide, 0, SLIDES - 1)) out.slide = t.slide;
  const dr = obj(t.draw);
  if (Number.isInteger(dr.at) && dr.at > Date.now() - 24 * 3600 * 1000 && dr.at <= Date.now() + 60000 && typeof dr.id === "string" && dr.id.length <= 24) out.draw = { at: dr.at, id: dr.id };
  if (t.drawStart === true) out.draw = { at: Date.now(), id: crypto.randomBytes(6).toString("hex") };
  // Cronómetros (partida y total) con la hora del servidor; timerCmd = { match|total: "start"|"pause"|"reset" }
  const now = Date.now(), DAY = 24 * 3600 * 1000;
  for (const key of ["match", "total"]) {
    // Base: lo que ya tiene el servidor (los relojes solo cambian con timerCmd o con el fin de la cuenta)
    const tm = obj(obj(state.tournament?.timers)[key]);
    const running = tm.running === true && Number.isInteger(tm.start) && tm.start > now - DAY && tm.start <= now + 60000;
    out.timers[key] = { acc: intIn(tm.acc, 0, DAY) ? tm.acc : 0, start: running ? tm.start : 0, running };
  }
  const cmds = obj(t.timerCmd);
  const apply = (key, cmd) => {
    const tm = out.timers[key];
    if (cmd === "start" && !tm.running) { tm.running = true; tm.start = now; }
    else if (cmd === "pause" && tm.running) { tm.acc = Math.min(DAY, tm.acc + now - tm.start); tm.running = false; tm.start = 0; }
    else if (cmd === "reset") { tm.acc = 0; tm.running = false; tm.start = 0; }
    else if (cmd === "restart") { tm.acc = 0; tm.running = true; tm.start = now; }
  };
  for (const key of ["match", "total"]) if (["start", "pause", "reset", "restart"].includes(cmds[key])) apply(key, cmds[key]);
  // Al iniciar una partida, el tiempo total arranca solo si aún no empezó
  if ((cmds.match === "start" || cmds.match === "restart") && !out.timers.total.running && out.timers.total.acc === 0) apply("total", "start");
  return out;
}

const clients = new Set();
function broadcast() {
  const data = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(data);
}

function isAdmin(req) {
  const given = req.get("x-admin-password") || "";
  if (!ADMIN_PASSWORD || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Falta configurar ADMIN_PASSWORD en el servidor." });
  if (!isAdmin(req)) return res.status(401).json({ error: "Contraseña de organizador incorrecta." });
  next();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/media", express.static(MEDIA_DIR, { maxAge: "7d", immutable: true }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/state", (req, res) => res.json(publicState()));

app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(publicState())}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});

app.post("/api/pick", (req, res) => {
  const { character, token } = req.body || {};
  const name = String(req.body?.name || "").trim().slice(0, 40);
  const c = CHAR_BY_ID[character];
  if (!c) return res.status(400).json({ error: "Personaje no válido." });
  if (!name) return res.status(400).json({ error: "Escribe tu nombre." });
  if (typeof token !== "string" || token.length < 16) return res.status(400).json({ error: "Recarga la página e inténtalo de nuevo." });

  const owner = hashToken(token);
  const others = state.picks.filter(p => p.owner !== owner);
  const charClash = others.find(p => p.character === character);
  if (charClash) return res.status(409).json({ error: `Llegaste tarde: ${charClash.name} ya es ${c.name}.` });
  state.picks = state.picks.filter(p => p.owner !== owner);
  state.picks.push({ id: character, character, name, owner, token, at: Date.now() });
  save(); broadcast();
  res.json({ ok: true, owner });
});

app.delete("/api/pick/:id", (req, res) => {
  const pick = state.picks.find(p => p.id === req.params.id);
  if (!pick) return res.json({ ok: true });
  const token = req.get("x-player-token") || "";
  if (!isAdmin(req) && pick.token !== token) return res.status(403).json({ error: "Solo puedes liberar tu propia reserva." });
  state.picks = state.picks.filter(p => p !== pick);
  save(); broadcast();
  res.json({ ok: true });
});

app.post("/api/admin/login", requireAdmin, (req, res) => res.json({ ok: true }));

app.put("/api/admin/tournament", requireAdmin, (req, res) => {
  state.tournament = sanitizeTournament(req.body);
  scheduleAutoStart();
  save(); broadcast();
  res.json({ ok: true, tournament: state.tournament });
});

app.get("/marcador", (req, res) => res.sendFile(path.join(__dirname, "public", "marcador.html")));
app.get("/control", (req, res) => res.sendFile(path.join(__dirname, "public", "control.html")));
app.get("/resultados", (req, res) => res.sendFile(path.join(__dirname, "public", "resultados.html")));
app.get("/guia", (req, res) => res.sendFile(path.join(__dirname, "public", "guia.html")));
app.get("/diagnostico", (req, res) => res.sendFile(path.join(__dirname, "public", "diagnostico.html")));

function removeMediaFile(charId) {
  const old = state.media[charId];
  if (old?.file) fs.promises.unlink(path.join(MEDIA_DIR, old.file)).catch(() => {});
}

app.put("/api/admin/media/:charId", requireAdmin,
  express.raw({ type: Object.keys(MEDIA_TYPES), limit: MAX_UPLOAD }),
  (req, res) => {
    const c = CHAR_BY_ID[req.params.charId];
    const type = (req.get("content-type") || "").split(";")[0].trim();
    const ext = MEDIA_TYPES[type];
    if (!c) return res.status(404).json({ error: "Personaje no encontrado." });
    if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ error: "Formato no admitido. Usa JPG, PNG, GIF, WebP, MP4 o WebM." });
    const file = `${c.id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), req.body);
    removeMediaFile(c.id);
    state.media[c.id] = { file, type };
    save(); broadcast();
    res.json({ ok: true, file });
  });

app.delete("/api/admin/media/:charId", requireAdmin, (req, res) => {
  removeMediaFile(req.params.charId);
  delete state.media[req.params.charId];
  save(); broadcast();
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "El archivo pesa más de 20 MB. Usa uno más liviano." });
  console.error(err);
  res.status(500).json({ error: "Error del servidor. Inténtalo de nuevo." });
});

// Cuando vence la cuenta regresiva: cronómetro de partida desde cero (y el total, si no había empezado)
let autoTimer = null;
function scheduleAutoStart() {
  clearTimeout(autoTimer);
  const cd = state.tournament?.countdown;
  if (!cd?.until || !cd.autoStart) return;
  autoTimer = setTimeout(() => {
    const t = state.tournament, c = t?.countdown;
    if (!c || c.until !== cd.until || !c.autoStart) return;
    t.timers ||= emptyTournament().timers;
    t.timers.match = { acc: 0, start: c.until, running: true };
    if (!t.timers.total.running && !t.timers.total.acc) t.timers.total = { acc: 0, start: c.until, running: true };
    c.autoStart = false;
    save(); broadcast();
  }, Math.max(0, cd.until - Date.now()));
}
scheduleAutoStart();

app.listen(PORT, () => {
  console.log(`Torneo Caparazón Azul en puerto ${PORT} · datos en ${DATA_DIR}`);
  if (!ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD no está configurado: el modo organizador está desactivado.");
});
