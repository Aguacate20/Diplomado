// Proxy hacia NVIDIA NIM (API compatible con OpenAI). La clave vive solo en el servidor.
const { limitar, ip, body, cors } = require("./_lib");
const URL_NIM = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const MODELO = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
const MODELO_RAPIDO = process.env.NVIDIA_MODEL_QUICK || "meta/llama-3.1-8b-instruct";
const POR_MINUTO = Number(process.env.LIMITE_POR_MINUTO || 15);
const POR_DIA = Number(process.env.LIMITE_POR_DIA || 1500);

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

  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(URL_NIM, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ model: b.tier === "quick" ? MODELO_RAPIDO : MODELO, messages, max_tokens: 900, temperature: 0.3, top_p: 0.9, stream: false }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: "El modelo respondió con error " + r.status + (j.error && j.error.message ? ": " + j.error.message : ".") });
    const text = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : "";
    if (!text) return res.status(502).json({ error: "El modelo no devolvió texto." });
    return res.status(200).json({ text, model: b.tier === "quick" ? MODELO_RAPIDO : MODELO });
  } catch (e) {
    return res.status(504).json({ error: e.name === "AbortError" ? "El modelo tardó demasiado." : "No se pudo contactar al modelo: " + e.message });
  } finally { clearTimeout(timer); }
};
