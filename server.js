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
    picks: state.picks.map(({ token, ...p }) => p)
  };
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

app.listen(PORT, () => {
  console.log(`Torneo Caparazón Azul en puerto ${PORT} · datos en ${DATA_DIR}`);
  if (!ADMIN_PASSWORD) console.warn("ADMIN_PASSWORD no está configurado: el modo organizador está desactivado.");
});
