// Utilidades compartidas: almacenamiento (Upstash Redis por REST, con respaldo en archivo para desarrollo local) y límites de uso.
const fs = require("fs");
const path = require("path");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const LOCAL_FILE = path.join(process.env.LOCAL_DATA_DIR || "/tmp", "laboratorio-veredictos.json");

async function redis(...cmd) {
  const r = await fetch(REDIS_URL, { method: "POST", headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error("Redis: " + j.error);
  return j.result;
}
const hasRedis = () => !!(REDIS_URL && REDIS_TOKEN);

function readLocal() { try { return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")); } catch { return []; } }
function writeLocal(arr) { fs.writeFileSync(LOCAL_FILE, JSON.stringify(arr)); }

async function guardarVeredicto(v) {
  const s = JSON.stringify(v);
  if (hasRedis()) { await redis("RPUSH", "veredictos", s); return; }
  const arr = readLocal(); arr.push(v); writeLocal(arr);
}
async function listarVeredictos() {
  let arr;
  if (hasRedis()) arr = (await redis("LRANGE", "veredictos", 0, -1)).map((s) => JSON.parse(s));
  else arr = readLocal();
  // el último envío de cada (código, expediente) es el que vale; se conserva el historial en bruto
  // la identidad del estudiante es su nombre/código normalizado (sin tildes, mayúsculas ni espacios extra)
  const ultimo = new Map();
  for (const v of arr) { const k = (v.clave_est || String(v.codigo).toLowerCase().trim()) + "\u0001" + v.id; ultimo.set(k, v); }
  return { todos: arr, ultimos: [...ultimo.values()] };
}

// Límite de uso: n peticiones por ventana (segundos) por clave; usa Redis si existe, memoria si no.
const mem = new Map();
async function limitar(clave, n, ventana) {
  const slot = Math.floor(Date.now() / 1000 / ventana);
  const k = `rl:${clave}:${slot}`;
  if (hasRedis()) {
    const c = await redis("INCR", k);
    if (c === 1) await redis("EXPIRE", k, ventana + 5);
    return c <= n;
  }
  const c = (mem.get(k) || 0) + 1; mem.set(k, c);
  if (mem.size > 5000) mem.clear();
  return c <= n;
}

// Marcas con caducidad (p. ej. «este modelo falló hace poco»): Redis si existe, memoria si no.
const marcasMem = new Map();
async function marcar(clave, segundos, valor = "1") {
  if (hasRedis()) { try { await redis("SET", "m:" + clave, valor, "EX", Math.max(1, Math.round(segundos))); } catch {} return; }
  marcasMem.set(clave, { valor, hasta: Date.now() + segundos * 1000 });
}
async function marcadas(claves) {
  if (!claves.length) return [];
  if (hasRedis()) { try { return await redis("MGET", ...claves.map((k) => "m:" + k)); } catch { return claves.map(() => null); } }
  return claves.map((k) => { const m = marcasMem.get(k); return m && m.hasta > Date.now() ? m.valor : null; });
}

function ip(req) { return (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").toString().split(",")[0].trim(); }
function body(req) { if (!req.body) return {}; if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } } return req.body; }
function cors(res) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); }

module.exports = { hasRedis, guardarVeredicto, listarVeredictos, limitar, marcar, marcadas, ip, body, cors };
