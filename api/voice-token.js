// Vercel serverless function: GET /api/voice-token
export default async function handler(_req, res) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return res.status(500).json({ error: "ASSEMBLYAI_API_KEY is not set" });
  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", "120");
  url.searchParams.set("max_session_duration_seconds", "1200");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) return res.status(r.status).json({ error: await r.text() });
  const { token } = await r.json();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ token });
}
