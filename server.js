// Minimal zero-dependency server: serves the web app and mints short-lived
// AssemblyAI Voice Agent tokens so the API key never reaches the browser.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public/", import.meta.url));

// tiny .env loader
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = process.env.PORT || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

export async function mintToken() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return { status: 500, body: { error: "ASSEMBLYAI_API_KEY is not set" } };
  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", "120");
  url.searchParams.set("max_session_duration_seconds", "1200"); // 20 min debrief cap
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) return { status: r.status, body: { error: await r.text() } };
  const { token } = await r.json();
  return { status: 200, body: { token } };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/voice-token") {
      const { status, body } = await mintToken();
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(body));
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (path.includes("..")) { res.writeHead(400); return res.end(); }
    let file = join(root, path || "index.html");
    if (existsSync(file) && (await stat(file)).isDirectory()) file = join(file, "index.html");
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});

server.listen(PORT, () => console.log(`TRACE Voice running on http://localhost:${PORT}`));
