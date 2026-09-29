// The case engine: the only code allowed to write to the case record.
// The voice agent can PROPOSE; this code DECIDES.

import { FIELDS, FIELD_NAMES, REQUIRED_FIELDS, ATTRIBUTIONS, ATTRIBUTED_FIELDS, valueLabels, displayValue } from "./schema.js";
import {
  groundQuote, classifyReply, agentSaidValue, piiViolation, findHedge,
  canonicalCountry, quoteSupportsCountry, quoteSupportsText, GAZETTEER,
} from "./grounding.js";
import { scoreCase } from "./scorer.js";

export class CaseSession {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.seq = 0;
    this.startedAt = now();
    this.utterances = []; // caseworker final transcripts
    this.agentTurns = []; // agent final transcripts
    this.record = {}; // field -> entry
    this.pending = null; // field awaiting read-back confirmation
    this.status = "open";
    this.audit = [];
    this.metrics = {
      tool_calls: 0,
      proposals: 0,
      proposals_accepted: 0,
      blocked_ungrounded: 0,
      blocked_value_mismatch: 0,
      inferences_marked: 0,
      blocked_pii: 0,
      blocked_invalid: 0,
      blocked_order: 0,
      confirmations: 0,
      confirmations_blocked: 0,
      caseworker_rejections: 0,
      corrections: 0,
    };
  }

  // ---- inputs from the voice stream ----
  addUserUtterance(text, id) {
    if (!text || !text.trim()) return;
    const u = { id: id || `u${this.utterances.length + 1}`, seq: ++this.seq, t: this.now() - this.startedAt, text: text.trim() };
    this.utterances.push(u);
    return u;
  }
  addAgentTurn(text) {
    if (!text || !text.trim()) return;
    const a = { seq: ++this.seq, t: this.now() - this.startedAt, text: text.trim() };
    this.agentTurns.push(a);
    return a;
  }

  // ---- tool dispatch ----
  handleTool(name, args = {}) {
    this.metrics.tool_calls++;
    const seq = ++this.seq;
    let out;
    try {
      switch (name) {
        case "propose_field": out = this.#propose(args, seq); break;
        case "confirm_field": out = this.#confirm(args, seq); break;
        case "list_missing_fields": out = ok(this.missing()); break;
        case "get_risk_summary": out = ok(this.#riskForSpeech()); break;
        case "finalize_case": out = this.#finalize(); break;
        default: out = err(`Unknown tool ${name}`);
      }
    } catch (e) {
      out = err(`Internal error: ${e.message}`);
    }
    this.audit.push({ seq, t: this.now() - this.startedAt, tool: name, args, decision: out.is_error ? "blocked" : "accepted", result: out.result });
    return out;
  }

  #propose({ field, value, source_quote, attribution }, seq) {
    this.metrics.proposals++;
    const def = FIELDS[field];
    if (!def) { this.metrics.blocked_invalid++; return err(`Unknown field "${field}". Valid fields: ${FIELD_NAMES.join(", ")}`); }
    if (this.status !== "open") { this.metrics.blocked_order++; return err(`Case is ${this.status}; no further edits by voice.`); }
    if (this.pending && this.pending !== field) {
      this.metrics.blocked_order++;
      return err(`Field "${this.pending}" is still waiting for read-back confirmation. Read it back and get a yes or no first.`);
    }
    const parsed = parseValue(def, value);
    if (parsed.error) { this.metrics.blocked_invalid++; return err(`Invalid value for ${field}: ${parsed.error}`); }
    const pii = def.kind === "text" || def.kind === "country" ? piiViolation(parsed.value) : null;
    if (pii) { this.metrics.blocked_pii++; return err(`Refused: value ${pii}. The record never stores personal identifiers. Use a pseudonymous code.`); }
    const g = groundQuote(source_quote, this.utterances);
    if (!g.ok) { this.metrics.blocked_ungrounded++; return err(g.reason); }

    // Value-level grounding: the quote must support THIS value, not just exist.
    if (def.kind === "country") {
      const supported = canonicalCountry(parsed.value)
        ? quoteSupportsCountry(parsed.value, g.matched)
        : quoteSupportsText(parsed.value, g.matched);
      if (!supported) {
        this.metrics.blocked_value_mismatch++;
        return err(`The quote does not name "${parsed.value}" or a place in it. Quote the words where the caseworker names the place, or ask them.`);
      }
    } else if (def.kind === "text" && !quoteSupportsText(parsed.value, g.matched)) {
      this.metrics.blocked_value_mismatch++;
      return err(`The quote does not support the value "${parsed.value}". Use the caseworker's own words.`);
    }

    // Attribution: second-hand speech. Hedged speech is recorded as the caseworker's
    // inference whatever the model claimed. Code can downgrade, never upgrade.
    let attrib = null, hedge = null, downgraded = false;
    if (ATTRIBUTED_FIELDS.includes(field)) {
      if (!ATTRIBUTIONS[attribution]) {
        this.metrics.blocked_invalid++;
        return err(`attribution is required for ${field}: one of ${Object.keys(ATTRIBUTIONS).join(", ")}. Ask the caseworker whether the survivor said it, they observed it, or they are inferring it.`);
      }
      hedge = findHedge(g.context);
      attrib = attribution;
      if (hedge && attribution !== "caseworker_inference") { attrib = "caseworker_inference"; downgraded = true; }
      if (attrib === "caseworker_inference") this.metrics.inferences_marked++;
    }

    const correction = this.record[field]?.status === "confirmed";
    if (correction) this.metrics.corrections++;
    this.record[field] = {
      value: parsed.value,
      status: "pending",
      source_quote,
      utterance_id: g.utterance.id,
      utterance_text: g.utterance.text,
      utterance_t: g.utterance.t,
      coverage: Number(g.coverage.toFixed(2)),
      attribution: attrib,
      attribution_claimed: ATTRIBUTED_FIELDS.includes(field) ? attribution : null,
      hedge,
      proposed_seq: seq,
      correction,
    };
    this.pending = field;
    this.metrics.proposals_accepted++;
    const say = displayValue(field, parsed.value, "en");
    return ok({
      status: "pending_readback",
      field,
      value_to_read_back: say,
      value_to_read_back_fr: displayValue(field, parsed.value, "fr"),
      ...(attrib && { attribution: attrib }),
      ...(downgraded && {
        attribution_note: `The caseworker hedged ("${hedge}"), so this is recorded as the caseworker's inference, not as something the survivor reported. Mention that in the read-back.`,
      }),
      instruction: `Read back "${def.label.en}: ${say}" to the caseworker in their language and ask them to confirm. Call confirm_field only after they answer.`,
    });
  }

  #confirm({ field }, seq) {
    const entry = this.record[field];
    if (!entry || entry.status !== "pending" || this.pending !== field) {
      this.metrics.confirmations_blocked++;
      return err(`Nothing pending for "${field}". Call propose_field first.`);
    }
    const labels = FIELDS[field].kind === "country"
      ? [entry.value, ...(GAZETTEER[entry.value] ?? [])]
      : valueLabels(field, entry.value);
    const readback = this.agentTurns.find((a) => a.seq > entry.proposed_seq && agentSaidValue(labels, a.text));
    if (!readback) {
      this.metrics.confirmations_blocked++;
      return err(`You have not read the value back aloud yet. Say "${displayValue(field, entry.value)}" to the caseworker and ask for confirmation.`);
    }
    const replies = this.utterances.filter((u) => u.seq > readback.seq);
    const reply = replies[replies.length - 1];
    if (!reply) {
      this.metrics.confirmations_blocked++;
      return err("The caseworker has not answered the read-back yet. Wait for their answer.");
    }
    const verdict = classifyReply(reply.text);
    if (verdict === "yes") {
      entry.status = "confirmed";
      entry.readback_text = readback.text;
      entry.confirm_text = reply.text;
      entry.confirm_utterance_id = reply.id;
      this.pending = null;
      this.metrics.confirmations++;
      return ok({ status: "confirmed", field, missing: this.missing().missing_required });
    }
    if (verdict === "no") {
      entry.status = "rejected";
      entry.reject_text = reply.text;
      this.pending = null;
      this.metrics.caseworker_rejections++;
      return ok({ status: "rejected_by_caseworker", field, instruction: "The caseworker said this is not right. Ask what the correct value is, then propose_field again." });
    }
    this.metrics.confirmations_blocked++;
    return err(`The caseworker's answer ("${reply.text}") is not a clear yes or no. Ask again.`);
  }

  missing() {
    const confirmed = (f) => this.record[f]?.status === "confirmed";
    return {
      missing_required: REQUIRED_FIELDS.filter((f) => !confirmed(f)),
      missing_optional: FIELD_NAMES.filter((f) => !FIELDS[f].required && !confirmed(f)),
      pending_readback: this.pending,
    };
  }

  score() { return scoreCase(this.record); }

  #riskForSpeech() {
    const s = this.score();
    return {
      documented_level: s.level,
      potential_level_including_inferences: s.potential_level,
      urgent: s.urgent,
      elements_documented: s.elements,
      indicators: s.flags.map((f) => `${f.text} (from ${f.field}${f.established ? "" : ", caseworker inference only"})`),
      to_verify_with_survivor: s.unverified.map((f) => f.text),
      note: "Computed by deterministic rules from confirmed fields only. It is an aid for the caseworker, not a determination of trafficking status.",
    };
  }

  #finalize() {
    const m = this.missing();
    if (m.pending_readback || m.missing_required.length) this.metrics.blocked_order++;
    if (m.pending_readback) return err(`"${m.pending_readback}" is still waiting for confirmation.`);
    if (m.missing_required.length) return err(`Cannot finalize. Missing required fields: ${m.missing_required.join(", ")}`);
    const s = this.score();
    if (s.requires_supervisor) {
      this.status = "held_for_supervisor";
      return ok({
        status: "held_for_supervisor",
        documented_level: s.level,
        potential_level: s.potential_level,
        urgent: s.urgent,
        to_verify_with_survivor: s.unverified.map((f) => f.text),
        instruction: "Tell the caseworker the case is held for supervisor review. No referral or document leaves the device before a supervisor approves. If some indicators rest only on their inference, name them as points to verify with the survivor at the next contact.",
      });
    }
    this.status = "ready_for_review";
    return ok({ status: "ready_for_review", documented_level: s.level, to_verify_with_survivor: s.unverified.map((f) => f.text), instruction: "Tell the caseworker the draft record is ready for their written review. Nothing is sent automatically." });
  }

  snapshot() {
    return {
      status: this.status,
      record: this.record,
      pending: this.pending,
      score: this.score(),
      metrics: this.metrics,
      utterances: this.utterances,
      agentTurns: this.agentTurns,
      audit: this.audit,
      duration_ms: this.now() - this.startedAt,
    };
  }
}

function parseValue(def, value) {
  if (value === undefined || value === null || value === "") return { error: "empty value" };
  if (def.kind === "enum") {
    const v = String(value).trim().toLowerCase();
    return def.values[v] ? { value: v } : { error: `must be one of ${Object.keys(def.values).join(", ")}` };
  }
  if (def.kind === "multi") {
    const arr = (Array.isArray(value) ? value : String(value).split(/[,;]/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const bad = arr.filter((x) => !def.values[x]);
    if (!arr.length) return { error: "empty list" };
    if (bad.length) return { error: `unknown values ${bad.join(", ")}; allowed: ${Object.keys(def.values).join(", ")}` };
    return { value: [...new Set(arr)] };
  }
  if (def.kind === "country") {
    const v = String(value).trim();
    if (!v || v.length > 60) return { error: "give a country name" };
    return { value: canonicalCountry(v) ?? v };
  }
  if (def.kind === "code") {
    const v = String(value).trim().toUpperCase().replace(/[\s-]/g, "").replace(/^TR(\d)/, "TR-$1");
    return def.pattern.test(v) ? { value: v } : { error: "must be a pseudonymous code like TR-014" };
  }
  const v = String(value).trim();
  if (v.length > 160) return { error: "too long; keep it short" };
  return { value: v };
}

const ok = (result) => ({ result, is_error: false });
const err = (message) => ({ result: { error: message }, is_error: true });
