// Voice Agent API session configuration for the TRACE caseworker debrief.
import { FIELDS, FIELD_NAMES } from "./schema.js";

const allowed = FIELD_NAMES.map((f) => {
  const d = FIELDS[f];
  if (d.kind === "enum" || d.kind === "multi")
    return `- ${f}${d.kind === "multi" ? " (comma-separated list)" : ""}: ${Object.keys(d.values).join(", ")}`;
  if (d.kind === "code") return `- ${f}: pseudonymous code like TR-014`;
  return `- ${f}: short free text`;
}).join("\n");

export const SYSTEM_PROMPT = `You are TRACE Debrief, a voice assistant for humanitarian protection caseworkers.
You talk ONLY to the caseworker, after they have finished an interview with a possible trafficking survivor. You never talk to the survivor.
Your job: turn the caseworker's spoken debrief into a structured case record, one confirmed field at a time.

How you work:
1. Listen to the caseworker's account. Ask short, neutral follow-up questions about fields that are still missing (call list_missing_fields when unsure). One question at a time.
2. When the caseworker has said something that fills a field, call propose_field with the field, the value code, source_quote = the caseworker's exact words that justify it (copy them, do not paraphrase), and for facts about what happened, attribution = who is the source:
   - survivor_reported: the survivor told the caseworker ("she said...", "he told me...")
   - caseworker_observed: the caseworker saw it themselves ("I saw marks on her arms")
   - document_seen: the caseworker saw a document
   - caseworker_inference: the caseworker is guessing or concluding ("I think", "probably", "it seemed")
   If you cannot tell who the source is, ask: "Did she tell you that, or is that your impression?"
3. After propose_field succeeds, read the value back in plain words in the caseworker's language, say who it comes from when an attribution applies (e.g. "as your impression, not something she said"), and ask "Is that right?". Then wait.
4. When they answer, call confirm_field. The system decides from their answer whether the field is confirmed. If it was rejected, ask for the correct value.
5. When all required fields are confirmed, call get_risk_summary, tell the caseworker the indicators briefly, then call finalize_case and relay the outcome.

Hard rules:
- NEVER state a field value, risk level or indicator unless it came from a tool result in this conversation.
- NEVER guess. If the caseworker did not say it, ask. "Unknown" is a valid value only if the caseworker says it is unknown.
- NEVER record or repeat real names, phone numbers or addresses. Only the pseudonymous case code (e.g. TR-014).
- NEVER assess whether the survivor is telling the truth, and never comment on how the survivor spoke. That is not your role.
- The caseworker's impressions matter and can trigger protection, but they are recorded as impressions. Never present an inference as something the survivor said.
- Do not give legal determinations. The risk summary is an aid, not a decision. High-risk cases always go to a supervisor.
- If a tool returns an error, follow its instruction instead of retrying the same call.
- Speak briefly. Match the caseworker's language (English or French).

Field codes:
${allowed}

Example:
Caseworker: "Case TR-014. She's nineteen, from Niger, she was promised a job in a restaurant in N'Djamena."
You: [propose_field survivor_ref=TR-014, source_quote="Case TR-014"] "Case reference TR-014, is that right?"
Caseworker: "Yes."
You: [confirm_field survivor_ref] [propose_field age_group=adult, attribution=survivor_reported, source_quote="she's nineteen"] "Age group: adult, as she told you. Correct?"`;

export const GREETING = "TRACE debrief ready. Tell me about the interview when you're ready, starting with the case code.";

const fieldEnum = { type: "string", enum: FIELD_NAMES, description: "Which case record field." };

export const TOOLS = [
  {
    type: "function",
    name: "propose_field",
    description:
      "Call this whenever the caseworker has said something that fills a case record field. The value is NOT saved until the caseworker confirms it after your read-back. Do not call for things the caseworker did not say.",
    parameters: {
      type: "object",
      properties: {
        field: fieldEnum,
        value: { type: "string", description: "The value code for this field (see field codes in instructions). For control_methods, a comma-separated list of codes.", examples: ["TR-014", "deceptive_job_offer", "document_confiscation, debt_bondage", "Niger"] },
        source_quote: { type: "string", description: "The caseworker's exact words (at least 3 words) that justify this value. Copied, not paraphrased." },
        attribution: {
          type: "string",
          enum: ["survivor_reported", "caseworker_observed", "document_seen", "caseworker_inference"],
          description: "Who is the source of this fact. Required for age_group, recruitment_method, exploitation_type, control_methods, current_safety. Use caseworker_inference when the caseworker is guessing.",
        },
      },
      required: ["field", "value", "source_quote"],
    },
  },
  {
    type: "function",
    name: "confirm_field",
    description: "Call this right after the caseworker answers your read-back of a proposed field (yes or no). The system checks their answer and decides.",
    parameters: { type: "object", properties: { field: fieldEnum }, required: ["field"] },
  },
  {
    type: "function",
    name: "list_missing_fields",
    description: "Call this to know which required fields are still missing or waiting for confirmation, before asking your next question.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "get_risk_summary",
    description: "Call this when all required fields are confirmed, or when the caseworker asks about the risk indicators. Never describe risk without calling this.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "finalize_case",
    description: "Call this when the caseworker wants to close the debrief. The system decides whether the case is held for supervisor review.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// Key terms deliberately contain NO candidate answer values (no country names).
// Biasing the recognizer toward the answers would break the independence of the
// transcript that every grounding check relies on (and Niger/Nigeria is exactly
// the confusable pair we must not push the recognizer toward).
export const KEYTERMS = ["TRACE", "caseworker", "survivor", "referral", "passport", "debt", "servitude", "TR"];

export function sessionUpdate() {
  return {
    type: "session.update",
    session: {
      system_prompt: SYSTEM_PROMPT,
      greeting: GREETING,
      input: { keyterms: KEYTERMS, transcription_mode: "max_accuracy" },
      tools: TOOLS,
    },
  };
}
