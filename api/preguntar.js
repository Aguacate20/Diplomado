// Proxy hacia NVIDIA NIM (API compatible con OpenAI). La clave vive solo en el servidor.
// El modelo se elige automáticamente entre los que la clave tiene disponibles (GET /v1/models),
// porque NVIDIA retira modelos del catálogo gratuito con frecuencia (responden 410 Gone).
// Si un modelo falla, tarda demasiado o responde vacío, queda «en pausa» unos minutos y se usa el siguiente.
const { limitar, marcar, marcadas, ip, body, cors } = require("./_lib");
const BASE = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/chat\/completions$/, "").replace(/\/$/, "");
const POR_MINUTO = Number(process.env.LIMITE_POR_MINUTO || 20);            // por estudiante (dispositivo)
const POR_MINUTO_RED = Number(process.env.LIMITE_POR_MINUTO_RED || 200);   // por red: un salón entero comparte la misma IP
const POR_DIA = Number(process.env.LIMITE_POR_DIA || 3000);                // toda la clase
const LENTO_MS = 25000;
// Orden de preferencia (el primero que exista en la cuenta y no esté en pausa gana). Se puede fijar con NVIDIA_MODEL / NVIDIA_MODEL_QUICK.
const PREFERIDOS = ["openai/gpt-oss-120b", "nvidia/nemotron-3-super-120b-a12b", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3", "nvidia/nemotron-3-ultra-550b-a55b", "moonshotai/kimi-k2.6", "mistralai/mistral-large-2-instruct", "meta/llama-3.3-70b-instruct", "qwen/qwen3-235b-a22b", "nvidia/llama-3.1-nemotron-70b-instruct", "openai/gpt-oss-20b"];
const PREFERIDOS_RAPIDOS = ["nvidia/nemotron-3.5-lightning-30b-a3b", "z-ai/glm-5.3-flash", "deepseek-ai/deepseek-v4.1-flash", "nvidia/nemotron-3-super-120b-a12b", "minimaxai/minimax-m3.1-flash", "openai/gpt-oss-20b", "nvidia/nemotron-nano-3-30b-a3b", "meta/llama-3.1-8b-instruct"];
const EXCLUIR = /embed|rerank|vision|-vl|whisper|tts|asr|guard|safety|parakeet|clip|nemoretriever|image|video|audio|ocr|parse|reward|omni|diffusion|coder|codegemma|codellama|codestral|chatqa|llama2|gemma-2b|recurrent|minitron|sea-lion|-7b|-8b/i;
const SISTEMA = "Eres el Analista IA de un laboratorio de análisis de datos criminales para estudiantes sin formación técnica (psicólogos, funcionarios). Respondes siempre en español, de forma breve y clara.\n"
  + "El laboratorio NO es Python completo: es un subconjunto de pandas que corre en el navegador. Reglas obligatorias para el código:\n"
  + "- Nunca importes librerías (sklearn, matplotlib, seaborn, scipy, statsmodels, plotly…) ni uses plt o sns: no existen ahí.\n"
  + "- No uses for, while, if como instrucción, def, lambda, listas por comprensión, .apply ni .iterrows.\n"
  + "- Usa únicamente las funciones, atributos y nombres de bases que describe el mensaje del usuario; no inventes otros. No uses nombres de ejemplo como df.\n"
  + "- Si lo que piden no se puede hacer con esas funciones, dilo y ofrece lo más cercano que sí existe.\n"
  + "Pon el código en un bloque ```python. Si el mensaje te pide no decidir por el estudiante, respétalo.";

let cache = { ts: 0, ids: [], muertos: new Set() };
async function modelosVivos() {
  if (Date.now() - cache.ts < 10 * 60 * 1000 && cache.ids.length) return cache.ids;
  const r = await fetch(BASE + "/models", { headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` } });
  if (!r.ok) throw new Error("No pude listar los modelos (" + r.status + "). ¿La clave NVIDIA_API_KEY es válida?");
  const j = await r.json();
  cache = { ts: Date.now(), ids: (j.data || []).map((m) => m.id).filter((id) => !EXCLUIR.test(id)), muertos: cache.muertos };
  return cache.ids;
}
async function elegirModelos(rapido, { conPausados = false } = {}) {
  const fijo = rapido ? process.env.NVIDIA_MODEL_QUICK : process.env.NVIDIA_MODEL;
  const vivos = await modelosVivos();
  const lista = [];
  if (fijo) lista.push(fijo);
  for (const p of (rapido ? PREFERIDOS_RAPIDOS : PREFERIDOS)) if (vivos.includes(p)) lista.push(p);
  // si casi ninguno de los preferidos existe, cualquier otro modelo de chat grande que esté vivo
  if (lista.length < 3) for (const id of vivos) if (/instruct|chat|gpt|nemotron|llama|qwen|mistral|gemma|deepseek|glm|kimi/i.test(id) && !lista.includes(id)) lista.push(id);
  const unicos = [...new Set(lista)].filter((id) => !cache.muertos.has(id));
  if (conPausados) return unicos;
  const pausa = await marcadas(unicos.map((id) => "pausa:" + id));
  const activos = unicos.filter((id, i) => !pausa[i]);
  // nunca quedarse sin candidatos: si todos están en pausa, se intenta igual con los primeros
  return (activos.length ? activos : unicos).slice(0, 4);
}
function opcionesModelo(modelo) {
  // apaga el «pensamiento largo» de los modelos que lo traen: lo que el estudiante necesita es la respuesta, rápido
  if (/nemotron|qwen3|deepseek|glm|kimi|minimax/i.test(modelo)) return { chat_template_kwargs: { enable_thinking: false, thinking: false } };
  return {};
}
async function llamar(modelo, messages, signal) {
  const msgs = /gpt-oss/i.test(modelo) ? [{ role: "system", content: messages[0].content + "\nReasoning: low" }, ...messages.slice(1)] : messages;
  const t0 = Date.now();
  const r = await fetch(BASE + "/chat/completions", { method: "POST", signal, headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ model: modelo, messages: msgs, max_tokens: 1800, temperature: 0.2, top_p: 0.9, stream: false, ...opcionesModelo(modelo) }) });
  const j = await r.json().catch(() => ({}));
  const choice = j.choices && j.choices[0]; const msg = choice && choice.message;
  // solo vale el contenido final; el «razonamiento» interno no se le muestra al estudiante
  const text = ((msg && msg.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();
  return { ok: r.ok, status: r.status, j, text, ms: Date.now() - t0, fin: choice && choice.finish_reason };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });
  if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: "El asistente de IA no está configurado (falta NVIDIA_API_KEY)." });
  const b = body(req);
  if (process.env.CLAVE_CLASE && (b.clase || "") !== process.env.CLAVE_CLASE) return res.status(401).json({ error: "Clave de clase incorrecta." });
  const quien = typeof b.dispositivo === "string" && /^[\w-]{8,64}$/.test(b.dispositivo) ? "disp:" + b.dispositivo : "ip:" + ip(req);
  if (!(await limitar(quien, POR_MINUTO, 60))) return res.status(429).json({ error: "Demasiadas consultas seguidas; espera un minuto." });
  if (!(await limitar("red:" + ip(req), POR_MINUTO_RED, 60))) return res.status(429).json({ error: "Muchas consultas a la vez desde esta red; espera un minuto." });
  if (!(await limitar("global", POR_DIA, 86400))) return res.status(429).json({ error: "Se alcanzó el cupo diario de consultas de la clase." });

  let messages;
  if (typeof b.input === "string") messages = [{ role: "user", content: b.input }];
  else if (Array.isArray(b.input)) messages = b.input.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content }));
  else return res.status(400).json({ error: "Falta input." });
  const total = messages.reduce((s, m) => s + m.content.length, 0);
  if (!messages.length || total > 60000) return res.status(400).json({ error: "La pregunta está vacía o es demasiado larga." });
  // mensajes seguidos del mismo rol se unen (algunos modelos los rechazan)
  messages = messages.reduce((acc, m) => { const u = acc[acc.length - 1]; if (u && u.role === m.role) u.content += "\n\n" + m.content; else acc.push({ ...m }); return acc; }, []);
  messages.unshift({ role: "system", content: SISTEMA });

  const inicio = Date.now(); const intentos = [];
  try {
    let candidatos;
    try { candidatos = await elegirModelos(b.tier === "quick"); } catch (e) { return res.status(502).json({ error: e.message }); }
    if (!candidatos.length) return res.status(502).json({ error: "La cuenta de NVIDIA no tiene ningún modelo de chat disponible. Revisa build.nvidia.com." });
    for (const modelo of candidatos) {
      const resta = 56000 - (Date.now() - inicio); if (resta < 6000) break;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), Math.min(resta, intentos.length ? resta : 32000));
      let r;
      try { r = await llamar(modelo, messages, ctl.signal); }
      catch (e) { intentos.push(`${modelo}: ${e.name === "AbortError" ? "tardó demasiado" : e.message}`); await marcar("pausa:" + modelo, 300); continue; }
      finally { clearTimeout(timer); }
      if (r.ok && r.text) {
        if (r.ms > LENTO_MS) await marcar("pausa:" + modelo, 180, "lento");
        return res.status(200).json({ text: r.text, model: modelo, ms: r.ms, intentos });
      }
      const detalle = r.j && r.j.error && r.j.error.message ? r.j.error.message : r.j && r.j.detail ? (typeof r.j.detail === "string" ? r.j.detail : JSON.stringify(r.j.detail)) : "";
      intentos.push(`${modelo}: ${r.ok ? "respuesta vacía" + (r.fin ? " (" + r.fin + ")" : "") : r.status}${detalle ? " " + String(detalle).slice(0, 160) : ""}`);
      if (r.status === 401 || r.status === 403) break;                                        // la clave no sirve: no tiene sentido insistir
      if (r.status === 410 || r.status === 404) { cache.muertos.add(modelo); await marcar("pausa:" + modelo, 6 * 3600, "retirado"); continue; }
      await marcar("pausa:" + modelo, r.status === 429 ? 120 : 300, r.ok ? "vacía" : String(r.status));          // saturado, vacío o con error: probar el siguiente
    }
    return res.status(502).json({ error: "No pude obtener respuesta del modelo. " + (intentos[intentos.length - 1] || ""), intentos });
  } catch (e) {
    return res.status(504).json({ error: "No se pudo contactar al modelo: " + e.message, intentos });
  }
};
module.exports.modelosVivos = modelosVivos; module.exports.elegirModelos = elegirModelos; module.exports.llamar = llamar; module.exports.SISTEMA = SISTEMA;
