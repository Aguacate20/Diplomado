const { hasRedis, cors } = require("./_lib");
module.exports = async (req, res) => {
  cors(res);
  res.status(200).json({ ok: true, ia: !!process.env.NVIDIA_API_KEY, clave: !!process.env.CLAVE_CLASE, almacenamiento: hasRedis() ? "redis" : "local" });
};
