// Servidor local de prueba: node dev-server.js  →  http://localhost:3000  (lee variables de .env si existe)
const http = require("http"), fs = require("fs"), path = require("path");
try { for (const l of fs.readFileSync(".env", "utf8").split("\n")) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } } catch {}
process.env.LOCAL_DATA_DIR = process.env.LOCAL_DATA_DIR || __dirname;
const types = { ".html": "text/html; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5).replace(/[^a-z_]/g, "");
    let raw = ""; for await (const c of req) raw += c;
    req.body = raw; req.query = Object.fromEntries(u.searchParams);
    const r = { status(c) { res.statusCode = c; return r; }, setHeader: (k, v) => res.setHeader(k, v), json(o) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); }, end: (s) => res.end(s) };
    try { delete require.cache[require.resolve(`./api/${name}.js`)]; await require(`./api/${name}.js`)(req, r); } catch (e) { r.status(500).json({ error: e.message }); }
    return;
  }
  let p = path.join(__dirname, "public", u.pathname === "/" ? "index.html" : u.pathname);
  if (!p.startsWith(path.join(__dirname, "public"))) { res.statusCode = 403; return res.end(); }
  fs.readFile(p, (err, data) => { if (err) { res.statusCode = 404; return res.end("no encontrado"); } res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream"); res.end(data); });
}).listen(process.env.PORT || 3000, () => console.log("Laboratorio en http://localhost:" + (process.env.PORT || 3000)));
