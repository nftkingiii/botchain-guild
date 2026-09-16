import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist");
const port = Number(process.env.PORT || 4320);
const revision = process.env.REVISION || process.env.RAILWAY_GIT_COMMIT_SHA || "local";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/healthz") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ ok: true, service: "guild", revision })); return; }
  const relative = normalize(decodeURIComponent(url.pathname).replace(/^[/\\]+/, ""));
  let path = join(root, relative);
  if (!path.startsWith(root)) { res.writeHead(400); res.end("Bad request"); return; }
  try { if (!(await stat(path)).isFile()) path = join(root, "index.html"); }
  catch { path = join(root, "index.html"); }
  try { const body = await readFile(path); res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "cache-control": extname(path) === ".html" ? "no-cache" : "public, max-age=31536000, immutable" }); res.end(body); }
  catch { res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }); res.end("Build the Guild app with npm run build first."); }
}).listen(port, "0.0.0.0", () => console.log(`Guild listening on 0.0.0.0:${port} (${revision})`));
