// Proxy hacia NVIDIA NIM (API compatible con OpenAI). La clave vive solo en el servidor.
// El modelo se elige automáticamente entre los que la clave tiene disponibles (GET /v1/models),
// porque NVIDIA retira modelos del catálogo gratuito con frecuencia (responden 410 Gone).
const { limitar, ip, body, cors } = require("./_lib");
const BASE = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/chat\/completions$/, "").replace(/\/$/, "");
const POR_MINUTO = Number(process.env.LIMITE_POR_MINUTO || 15);
const POR_DIA = Number(process.env.LIMITE_POR_DIA || 1500);
// Orden de preferencia (el primero que exista en la cuenta gana). Se puede fijar con NVIDIA_MODEL / NVIDIA_MODEL_QUICK.
const PREFERIDOS = ["openai/gpt-oss-120b", "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "meta/llama-3.3-70b-instruct", "meta/llama-3.1-70b-instruct", "qwen/qwen3-235b-a22b", "mistralai/mistral-large-latest", "openai/gpt-oss-20b", "meta/llama-3.1-8b-instruct"];
const PREFERIDOS_RAPIDOS = ["openai/gpt-oss-20b", "nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-3-nano-30b-a3b", "meta/llama-3.1-8b-instruct", "qwen/qwen3-30b-a3b", "openai/gpt-oss-120b"];
const EXCLUIR = /embed|rerank|vision|-vl|whisper|tts|asr|guard|safety|parakeet|clip|nemoretriever|image|video|audio|ocr/i;

let cache = { ts: 0, ids: [], muertos: new Set() };
async function modelosVivos() {
  if (Date.now() - cache.ts < 10 * 60 * 1000 && cache.ids.length) return cache.ids;
  const r = await fetch(BASE + "/models", { headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` } });
  if (!r.ok) throw new Error("No pude listar los modelos (" + r.status + "). ¿La clave NVIDIA_API_KEY es válida?");
  const j = await r.json();
  cache = { ts: Date.now(), ids: (j.data || []).map((m) => m.id).filter((id) => !EXCLUIR.test(id)), muertos: cache.muertos };
  return cache.ids;
}
async function elegirModelos(rapido) {
  const fijo = rapido ? process.env.NVIDIA_MODEL_QUICK : process.env.NVIDIA_MODEL;
  const vivos = await modelosVivos();
  const lista = [];
  if (fijo) lista.push(fijo);
  for (const p of (rapido ? PREFERIDOS_RAPIDOS : PREFERIDOS)) if (vivos.includes(p)) lista.push(p);
  // cualquier otro modelo de chat vivo, por si ninguno de los preferidos existe
  for (const id of vivos) if (/instruct|chat|gpt|nemotron|llama|qwen|mistral|gemma|deepseek|phi/i.test(id) && !lista.includes(id)) lista.push(id);
  return [...new Set(lista)].filter((id) => !cache.muertos.has(id)).slice(0, 4);
}
async function llamar(modelo, messages, signal) {
  const extra = /nemotron|qwen3|deepseek/i.test(modelo) ? { chat_template_kwargs: { enable_thinking: false } } : {};
  const r = await fetch(BASE + "/chat/completions", { method: "POST", signal, headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ model: modelo, messages, max_tokens: 1500, temperature: 0.3, top_p: 0.9, stream: false, ...extra }) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });
  if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: "El asistente de IA no está configurado (falta NVIDIA_API_KEY)." });
  const b = body(req);
  if (process.env.CLAVE_CLASE && (b.clase || "") !== process.env.CLAVE_CLASE) return res.status(401).json({ error: "Clave de clase incorrecta." });
  if (!(await limitar("ip:" + ip(req), POR_MINUTO, 60))) return res.status(429).json({ error: "Demasiadas consultas seguidas; espera un minuto." });
  if (!(await limitar("global", POR_DIA, 86400))) return res.status(429).json({ error: "Se alcanzó el cupo diario de consultas de la clase." });

  let messages;
  if (typeof b.input === "string") messages = [{ role: "user", content: b.input }];
  else if (Array.isArray(b.input)) messages = b.input.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content }));
  else return res.status(400).json({ error: "Falta input." });
  const total = messages.reduce((s, m) => s + m.content.length, 0);
  if (!messages.length || total > 60000) return res.status(400).json({ error: "La pregunta está vacía o es demasiado larga." });
  messages.unshift({ role: "system", content: "Eres el Analista IA de un laboratorio de análisis de datos criminales para estudiantes sin formación técnica. Respondes siempre en español, de forma breve y clara. Cuando des código, usa únicamente las funciones y la sintaxis que describe el mensaje del usuario (es un subconjunto de pandas) y ponlo en un bloque ```python." });

  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 55000);
  try {
    let candidatos;
    try { candidatos = await elegirModelos(b.tier === "quick"); } catch (e) { return res.status(502).json({ error: e.message }); }
    if (!candidatos.length) return res.status(502).json({ error: "La cuenta de NVIDIA no tiene ningún modelo de chat disponible. Revisa build.nvidia.com." });
    let ultimo = null;
    for (const modelo of candidatos) {
      const { ok, status, j } = await llamar(modelo, messages, ctl.signal);
      if (ok) {
        const msg = j.choices && j.choices[0] && j.choices[0].message; const text = (msg && (msg.content || msg.reasoning_content)) || "";
        if (text) return res.status(200).json({ text, model: modelo });
        ultimo = `«${modelo}» no devolvió texto`; continue;
      }
      ultimo = `«${modelo}» respondió ${status}${j.error && j.error.message ? ": " + j.error.message : j.detail ? ": " + (typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail)) : ""}`;
      if (status === 410 || status === 404) { cache.muertos.add(modelo); continue; }   // retirado: probar el siguiente
      if (status === 429 || status >= 500) continue;                                   // saturado: probar el siguiente
      break;                                                                            // 400/401/403: no tiene sentido insistir
    }
    return res.status(502).json({ error: "No pude obtener respuesta del modelo. " + (ultimo || "") });
  } catch (e) {
    return res.status(504).json({ error: e.name === "AbortError" ? "El modelo tardó demasiado." : "No se pudo contactar al modelo: " + e.message });
  } finally { clearTimeout(timer); }
};
module.exports.modelosVivos = modelosVivos; module.exports.elegirModelos = elegirModelos;
