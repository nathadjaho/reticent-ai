import { CaseSession } from "./core/caseEngine.js";
import { sessionUpdate } from "./core/agentConfig.js";
import { SCENARIOS } from "./core/scenarios.js";
import { FIELDS, FIELD_NAMES, ATTRIBUTIONS, displayValue } from "./core/schema.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtT = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

let session = new CaseSession();
let mode = "idle";

// ---------- rendering ----------
function setStatus(text, cls) { const s = $("status"); s.textContent = text; s.className = `pill ${cls}`; }

function addLine(kind, html) {
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = html;
  $("transcript").appendChild(li);
  li.scrollIntoView({ block: "end", behavior: "smooth" });
}
const addUser = (text, t) => addLine("user", `<span class="who">Caseworker · ${fmtT(t)}</span>${esc(text)}`);
const addAgent = (text, interrupted) => addLine("agent", `<span class="who">TRACE${interrupted ? " · interrupted" : ""}</span>${esc(text)}`);
function addTool(name, args, out) {
  const blocked = out.is_error;
  const summary = name === "propose_field" ? `${args.field} = ${args.value}` : name === "confirm_field" ? args.field : "";
  const detail = blocked
    ? out.result.error
    : (out.result.status ?? "ok") + (out.result.attribution_note ? " · heard a hedge: recorded as the caseworker's inference, not the survivor's words" : "");
  addLine(`tool ${blocked ? "blocked" : "accepted"}`, `${blocked ? "⛔ blocked" : "✓"} <b>${esc(name)}</b> ${esc(summary)} — ${esc(detail)}`);
}

function renderRecord(snap) {
  $("record").innerHTML = FIELD_NAMES.map((f) => {
    const def = FIELDS[f];
    const e = snap.record[f];
    const status = e?.status ?? "missing";
    const val = e ? esc(displayValue(f, e.value)) : `<span style="color:var(--muted)">—</span>`;
    const quote = e
      ? `<div class="quote">“${esc(e.source_quote)}” <br/>from caseworker utterance at ${fmtT(e.utterance_t)}${e.confirm_text ? ` · confirmed: “${esc(e.confirm_text)}”` : ""}${e.reject_text ? ` · rejected: “${esc(e.reject_text)}”` : ""}</div>`
      : "";
    const attr = e?.attribution
      ? `<span class="attr ${ATTRIBUTIONS[e.attribution].established ? "" : "inference"}" title="${e.attribution_claimed && e.attribution_claimed !== e.attribution ? `model claimed: ${esc(e.attribution_claimed)}; code heard “${esc(e.hedge)}”` : ""}">${esc(ATTRIBUTIONS[e.attribution].en)}${e.attribution_claimed && e.attribution_claimed !== e.attribution ? " · downgraded by code" : ""}</span>`
      : "";
    return `<div class="field ${status}"><div class="top"><span class="name">${esc(def.label.en)}${def.required ? "" : " (optional)"} ${attr}</span><span class="chip ${status}">${status === "pending" ? "awaiting read-back" : status}</span></div><div class="val">${val}</div>${quote}</div>`;
  }).join("");
}

function renderRisk(snap) {
  const s = snap.score;
  const el = (k, label) =>
    `<div class="el ${s.elements[k] ? "on" : s.potential_elements[k] ? "maybe" : ""}" title="${s.elements[k] ? "documented" : s.potential_elements[k] ? "caseworker inference only" : "not documented"}">${label}</div>`;
  const gate =
    snap.status === "held_for_supervisor"
      ? `<div class="gate">Held for supervisor review — no referral leaves the device before approval</div>`
      : snap.status === "ready_for_review"
        ? `<div class="gate ok">Draft ready for caseworker review</div>`
        : s.requires_supervisor
          ? `<div class="gate">Will require supervisor approval</div>`
          : "";
  $("risk").innerHTML = `
    <div class="elements">${el("act", "Act")}${el("means", "Means")}${el("purpose", "Purpose")}</div>
    <div class="level ${s.level}">Documented: ${s.level.toUpperCase()}${s.urgent ? " · URGENT" : ""}</div>
    ${s.potential_level !== s.level ? `<div class="potential">With caseworker inferences: <b>${s.potential_level.toUpperCase()}</b> — protection follows this, evidence does not.</div>` : ""}
    ${gate}
    ${s.flags.map((f) => `<div class="flag ${f.established ? "" : "unverified"}">• ${esc(f.text)}${f.established ? "" : " <b>(inference, verify with survivor)</b>"} <span class="q">“${esc(f.quote)}”</span></div>`).join("") || `<div class="flag" style="color:var(--muted)">No confirmed indicators yet.</div>`}`;
}

function renderGuards(snap) {
  const m = snap.metrics;
  const blocked = m.blocked_ungrounded + m.blocked_value_mismatch + m.blocked_pii + m.blocked_invalid + m.blocked_order + m.confirmations_blocked;
  const tile = (v, label, cls = "") => `<div class="metric ${cls}"><b>${v}</b><span>${label}</span></div>`;
  $("metrics").innerHTML =
    tile(m.confirmations, "fields confirmed", "good") +
    tile(m.blocked_ungrounded, "ungrounded writes blocked", m.blocked_ungrounded ? "bad" : "") +
    tile(blocked, "model actions blocked", blocked ? "bad" : "") +
    tile(m.caseworker_rejections, "caseworker said no") +
    tile(m.inferences_marked, "inferences kept apart", m.inferences_marked ? "warn" : "") +
    tile(m.blocked_value_mismatch, "wrong values blocked", m.blocked_value_mismatch ? "bad" : "") +
    tile(m.blocked_pii, "personal data refused", m.blocked_pii ? "bad" : "") +
    tile(fmtT(snap.duration_ms), "session time");
  $("audit").innerHTML = snap.audit
    .filter((a) => a.tool === "propose_field" || a.tool === "confirm_field" || a.tool === "finalize_case")
    .slice(-12).reverse()
    .map((a) => `<li class="${a.decision}"><b>${a.decision}</b> ${esc(a.tool)} ${esc(a.args.field ?? "")}<span class="why">${esc(a.result?.error ?? a.result?.status ?? "")}</span></li>`)
    .join("");
}

function render() {
  const snap = session.snapshot();
  renderRecord(snap); renderRisk(snap); renderGuards(snap);
}

function reset() {
  session = new CaseSession();
  $("transcript").innerHTML = ""; $("partial").textContent = "";
  render();
}

// ---------- tool execution (shared by live + replay) ----------
function runTool(name, args) {
  const out = session.handleTool(name, args);
  addTool(name, args, out);
  render();
  return out;
}

// ---------- live mode: AssemblyAI Voice Agent API ----------
let ws, audioCtx, stream, worklet, playbackTime = 0, playing = [], pendingResults = [];

function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function playPcm16(b64) {
  const raw = atob(b64);
  const n = raw.length >> 1;
  const f32 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    f32[i] = v / 32768;
  }
  const buffer = audioCtx.createBuffer(1, n, 24000);
  buffer.getChannelData(0).set(f32);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  playbackTime = Math.max(playbackTime, audioCtx.currentTime);
  src.start(playbackTime);
  playbackTime += buffer.duration;
  playing.push(src);
  src.onended = () => { playing = playing.filter((p) => p !== src); };
}

function flushPlayback() {
  for (const p of playing) try { p.stop(); } catch {}
  playing = [];
  playbackTime = audioCtx.currentTime;
}

async function startLive() {
  reset();
  mode = "live";
  $("start").disabled = true; $("replay").disabled = true; $("end").disabled = false;
  setStatus("Connecting…", "idle");
  try {
    const r = await fetch("/api/voice-token");
    const { token, error } = await r.json();
    if (!token) throw new Error(error || "no token");

    audioCtx = new AudioContext();
    await audioCtx.resume();
    await audioCtx.audioWorklet.addModule("pcm-processor.js");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
    const source = audioCtx.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(audioCtx, "pcm-processor", { processorOptions: { inputSampleRate: audioCtx.sampleRate, targetSampleRate: 24000 } });
    const mute = audioCtx.createGain(); mute.gain.value = 0;
    source.connect(worklet).connect(mute).connect(audioCtx.destination);

    const url = new URL("wss://agents.assemblyai.com/v1/ws");
    url.searchParams.set("token", token);
    ws = new WebSocket(url);
    let ready = false;
    worklet.port.onmessage = (e) => {
      if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input.audio", audio: b64FromBuffer(e.data) }));
    };
    ws.onopen = () => ws.send(JSON.stringify(sessionUpdate()));
    ws.onmessage = (ev) => onServerEvent(JSON.parse(ev.data), () => { ready = true; });
    ws.onclose = () => { if (mode === "live") stopLive(); };
  } catch (e) {
    setStatus(`Error: ${e.message}`, "error");
    stopLive(true);
  }
}

function onServerEvent(msg, markReady) {
  switch (msg.type) {
    case "session.ready": markReady(); setStatus("Live · listening", "live"); break;
    case "transcript.user.delta": $("partial").textContent = msg.text; break;
    case "transcript.user": {
      $("partial").textContent = "";
      const u = session.addUserUtterance(msg.text, msg.item_id);
      if (u) addUser(u.text, u.t);
      render();
      break;
    }
    case "transcript.agent": session.addAgentTurn(msg.text); addAgent(msg.text, msg.interrupted); break;
    case "reply.audio": playPcm16(msg.data); break;
    case "tool.call": {
      // Decide now (order matters for read-back checks); send at reply.done.
      const out = runTool(msg.name, msg.arguments || {});
      pendingResults.push({ call_id: msg.call_id, out });
      break;
    }
    case "reply.done":
      if (msg.status === "interrupted") { flushPlayback(); pendingResults = []; break; }
      for (const p of pendingResults)
        ws.send(JSON.stringify({ type: "tool.result", call_id: p.call_id, result: JSON.stringify(p.out.result), is_error: p.out.is_error }));
      pendingResults = [];
      break;
    case "session.error": setStatus(`Error: ${msg.code}`, "error"); console.warn(msg); break;
    case "session.ended": stopLive(); break;
  }
}

function stopLive(keepStatus) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "session.end" }));
  try { ws?.close(); } catch {}
  stream?.getTracks().forEach((t) => t.stop());
  try { audioCtx?.close(); } catch {}
  ws = null; stream = null; audioCtx = null;
  mode = "idle";
  $("start").disabled = false; $("replay").disabled = false; $("end").disabled = true;
  if (!keepStatus) setStatus("Idle", "idle");
}

window.addEventListener("pagehide", () => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "session.end" })); });

// ---------- replay mode: scripted synthetic session, no mic ----------
async function replay() {
  const sc = SCENARIOS[$("scenario").value];
  reset();
  mode = "replay";
  $("start").disabled = true; $("replay").disabled = true;
  setStatus("Replay · synthetic", "replay");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const step of sc.steps) {
    if (mode !== "replay") break;
    if (step.type === "user") { const u = session.addUserUtterance(step.text); addUser(u.text, u.t); render(); await wait(1100); }
    else if (step.type === "agent") { session.addAgentTurn(step.text); addAgent(step.text); await wait(900); }
    else { runTool(step.name, step.args); await wait(700); }
  }
  mode = "idle";
  $("start").disabled = false; $("replay").disabled = false;
  setStatus("Replay done", "replay");
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), synthetic: true, ...session.snapshot() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trace-debrief-${Date.now()}.json`;
  a.click();
}

// ---------- wire up ----------
for (const [id, sc] of Object.entries(SCENARIOS)) {
  const o = document.createElement("option");
  o.value = id; o.textContent = sc.title.split(" — ")[0] + " · " + id;
  $("scenario").appendChild(o);
}
$("start").onclick = startLive;
$("end").onclick = () => stopLive();
$("replay").onclick = replay;
$("export").onclick = exportJson;
render();
