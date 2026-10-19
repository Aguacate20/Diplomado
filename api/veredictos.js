// POST: guarda un veredicto. GET ?clave=...: lista todos (solo el profesor).
const { guardarVeredicto, listarVeredictos, limitar, ip, body, cors } = require("./_lib");
const limpiar = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, n);

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "POST") {
    if (!(await limitar("ver:" + ip(req), 30, 60))) return res.status(429).json({ error: "Demasiados envíos seguidos." });
    const b = body(req);
    const v = { codigo: limpiar(b.codigo, 80), id: limpiar(b.id, 10), sesion: Number(b.sesion) || 0, titulo: limpiar(b.titulo, 120), hipotesis: limpiar(b.hipotesis, 300), veredicto: limpiar(b.veredicto, 4000), fecha: new Date().toISOString() };
    if (!v.codigo || !v.id || !v.veredicto) return res.status(400).json({ error: "Faltan el código del estudiante, el expediente o el texto." });
    try { await guardarVeredicto(v); return res.status(200).json({ ok: true, fecha: v.fecha }); }
    catch (e) { return res.status(500).json({ error: "No se pudo guardar: " + e.message }); }
  }
  if (req.method === "GET") {
    const clave = (req.query && req.query.clave) || new URL(req.url, "http://x").searchParams.get("clave") || "";
    if (!process.env.CLAVE_PROFESOR) return res.status(503).json({ error: "Define la variable CLAVE_PROFESOR en Vercel para poder consultar los veredictos." });
    if (clave !== process.env.CLAVE_PROFESOR) { await limitar("prof:" + ip(req), 10, 60); return res.status(401).json({ error: "Clave de profesor incorrecta." }); }
    try { const { todos, ultimos } = await listarVeredictos(); return res.status(200).json({ total: todos.length, veredictos: ultimos, historial: todos }); }
    catch (e) { return res.status(500).json({ error: "No se pudo leer: " + e.message }); }
  }
  return res.status(405).json({ error: "Método no permitido" });
};
