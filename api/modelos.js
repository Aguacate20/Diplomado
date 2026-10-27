// Diagnóstico: qué modelos de chat tiene disponibles la clave y cuáles usaría el laboratorio.
// Con ?probar=1&clave=CLAVE_PROFESOR además le hace la misma pregunta corta a cada candidato y mide cuánto tarda.
const { cors, limitar, marcadas, ip } = require("./_lib");
const { modelosVivos, elegirModelos, llamar, SISTEMA } = require("./preguntar");
const PRUEBA = "Este laboratorio ejecuta un subconjunto de pandas. Bases: homicidios (columnas: departamento, sexo_victima, edad_aprox). Funciones: value_counts, groupby, mean, round, sort_values, head, grafico_barras(serie, horizontal=True). Pregunta: ¿cuál es la edad promedio de las víctimas por departamento? Muestra los 10 más altos en una gráfica de barras.";
module.exports = async (req, res) => {
  cors(res);
  if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: "Falta NVIDIA_API_KEY." });
  try {
    const vivos = await modelosVivos();
    const todos = [...new Set([...(await elegirModelos(false, { conPausados: true })), ...(await elegirModelos(true, { conPausados: true }))])];
    const pausa = await marcadas(todos.map((id) => "pausa:" + id));
    const out = { usaria: await elegirModelos(false), usaria_rapido: await elegirModelos(true), en_pausa: Object.fromEntries(todos.map((id, i) => [id, pausa[i]]).filter(([, v]) => v)), disponibles: vivos };
    const q = req.query || {};
    if (q.probar) {
      if (!process.env.CLAVE_PROFESOR || q.clave !== process.env.CLAVE_PROFESOR) { await limitar("prof:" + ip(req), 10, 60); return res.status(401).json({ error: "Para probar los modelos agrega &clave= con la CLAVE_PROFESOR." }); }
      const lista = (typeof q.modelos === "string" && q.modelos ? q.modelos.split(",") : todos).slice(0, 8);
      out.prueba = await Promise.all(lista.map(async (modelo) => {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
        try { const r = await llamar(modelo, [{ role: "system", content: SISTEMA }, { role: "user", content: PRUEBA }], ctl.signal); return { modelo, status: r.status, segundos: Math.round(r.ms / 100) / 10, fin: r.fin, texto: r.text.slice(0, 600) || JSON.stringify(r.j).slice(0, 300) }; }
        catch (e) { return { modelo, error: e.name === "AbortError" ? "más de 45 s" : e.message }; }
        finally { clearTimeout(t); }
      }));
    }
    res.status(200).json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
};
