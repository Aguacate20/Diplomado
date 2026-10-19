// Diagnóstico: qué modelos de chat tiene disponibles la clave y cuáles usaría el laboratorio.
const { cors } = require("./_lib");
const { modelosVivos, elegirModelos } = require("./preguntar");
module.exports = async (req, res) => {
  cors(res);
  if (!process.env.NVIDIA_API_KEY) return res.status(503).json({ error: "Falta NVIDIA_API_KEY." });
  try { const vivos = await modelosVivos(); res.status(200).json({ usaria: await elegirModelos(false), usaria_rapido: await elegirModelos(true), disponibles: vivos }); }
  catch (e) { res.status(502).json({ error: e.message }); }
};
