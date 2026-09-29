# TRACE Debrief: a voice agent that knows *who* said it

> Every voice agent assumes the speaker is the source of truth. In protection casework, the speaker is a caseworker reporting what a survivor said, what they saw, and what they suspect. TRACE Debrief keeps those apart in code. **A caseworker's impression can trigger protection. It never becomes evidence.**

**TRACE Debrief** is a voice agent for humanitarian protection caseworkers who document possible human-trafficking cases. It is built on the **AssemblyAI Voice Agent API**.

After an interview, the caseworker talks the case through out loud. The agent asks about whatever is still missing. It fills a structured case record (a subset of the IOM HTCDS standard) one field at a time, and it reads each value back before anything is saved.

The agent can only *propose* a field. **Code decides whether it gets written.**

> Part of [TRACE](https://github.com/ElkeDikoume/trace-humanitarian), a documentation tool for protection teams (e.g. Lake Chad Basin field offices). An earlier TRACE prototype placed 3rd at *Call for Code AI: United Against Trafficking*. This repo is the voice experiment built for the AssemblyAI Voice Agent Hackathon (Sept 2026). **Synthetic data only.**

## Why voice, and why it's risky here

Caseworkers in field offices spend a large share of their time turning interview notes into forms. Typing on a phone after a long interview is slow, and it's where fields get skipped. Speaking is faster and more natural.

A voice agent that "helps" by filling gaps is dangerous in this domain, though:

- A hallucinated *"her passport was confiscated"* becomes a trafficking indicator in a legal-adjacent record.
- A misheard *"no"* becomes a *"yes"*.

So the project tests whether a voice agent can be **fast and still unable to invent**.

## Hypotheses this MVP tests

| # | Hypothesis | How the MVP makes it testable |
|---|---|---|
| **H1** | A spoken debrief with targeted follow-up questions produces a complete structured record, and **every field traces back to the caseworker's own words**. | `propose_field` requires a `source_quote`. The case engine only accepts it if it matches (≥80% of words, in order, in a compact span) a final `transcript.user` utterance. Otherwise the tool returns an error and the agent must ask. |
| **H2** | Reading values back aloud before saving catches misunderstandings, and **the confirmation is decided by code, not by the model**. | `confirm_field` succeeds only if (a) the agent actually spoke the value after proposing it (checked against `transcript.agent`) and (b) the caseworker's next reply is a clear yes (deterministic EN/FR classifier). A "no" rejects the field. An ambiguous answer is refused. |

These are enforced in code as well:

- **One pending field at a time.** The read-back can't be batched or skipped.
- **Personal-data guard.** The record refuses phone numbers, emails and "her name is…" values. Only pseudonymous codes (`TR-014`) are stored.
- **Deterministic indicators.** The Palermo *Act / Means / Purpose* structure is computed from **confirmed fields only**, and every indicator cites its source quote.
- **Supervisor gate.** High-risk, urgent or child cases are *held for supervisor review* by code. The agent cannot close them.

### H3: second-hand speech (the core idea)

Every other design we reviewed treats the person talking as the source of the facts. A debrief is **second-hand speech**, and the record must say where each fact comes from:

| Attribution | Example | Counts as documented evidence? |
|---|---|---|
| `survivor_reported` | "She told me they took her passport" | yes |
| `caseworker_observed` | "I saw marks on her arms" | yes |
| `document_seen` | "Her contract says..." | yes |
| `caseworker_inference` | "**I think** they took her papers" | **no**, it is flagged *to verify with the survivor* |

- **The model proposes an attribution. Code can only downgrade it.** If the quoted span (or the 5 words before it) contains a hedge ("I think", "probably", "it seemed", "je pense", "peut-être"…), the field is stored as `caseworker_inference`, whatever the model claimed. The model can never upgrade an inference to a report.
- **Asymmetric scoring.** The scorer computes two levels:
  - **documented level**: reported, observed or document-seen facts only. This is what the record can stand behind.
  - **potential level**: the same, plus the caseworker's inferences. This is what protection must assume.

  The supervisor gate follows the *potential* level, so an inference can **raise protection** (supervisor review, child safeguards), but it can never raise the documented evidence.
- **Scenario `second-hand`:**
  - Recruitment and domestic servitude are reported by the survivor.
  - Document confiscation is only the caseworker's hunch ("I think they took her papers"), and the model mislabels it as `survivor_reported`.
  - Code records it as an inference. The result is: documented **MEDIUM**, potential **HIGH**, **held for supervisor**, with "Identity documents confiscated" listed as *verify with survivor*.

### Value-level grounding and recognizer independence

- **A real quote isn't enough. It has to support this exact value.** For place fields, the quote must name the country, a synonym (Tchad/Chad) or a known city (N'Djamena → Chad, Maiduguri → Nigeria, Maroua → Cameroon…). Token matches are exact, so "from Niger" never supports *Nigeria*.
- **No answer values in the recognizer's key terms.** Biasing speech recognition toward candidate answers (e.g. the country list) would make the transcript agree with the model instead of independently recording what was said, and every grounding check depends on that independence. Niger/Nigeria is exactly the confusable pair we must not push the recognizer toward. A test enforces that no key term is a place name.

### Explicit non-goals (ethics)

- **The agent never talks to survivors** and does not listen during the interview.
- **No credibility scoring.** It does not compute hesitation, pause, pace or tone features. Speech-timing analysis is tempting with word-level timestamps, but using it to judge whether a trafficking survivor is truthful would be harmful. Trauma affects how people speak.
- **No trafficking determination.** The indicators support the caseworker. They do not replace the caseworker or the supervisor.

## Architecture

```
Browser (mic, 24 kHz PCM16) ──WebSocket──► AssemblyAI Voice Agent API
   │   ▲                                   (Universal-3 Pro STT, LLM, TTS, turn-taking)
   │   └── transcript.user / transcript.agent / tool.call / reply.audio
   ▼
CaseSession (public/core/caseEngine.js), the only writer of the record
   ├─ grounding.js   quote ↔ transcript matching, yes/no classifier, read-back check, PII guard
   ├─ scorer.js      deterministic Act/Means/Purpose indicators with citations
   └─ schema.js      HTCDS-inspired field subset (EN/FR labels)
server.js / api/voice-token.js   mints single-use tokens (API key never reaches the browser)
```

The agent is configured inline with `session.update`: system prompt, greeting, 5 JSON-Schema function tools, key terms, and `transcription_mode: max_accuracy`. Tool calls are **decided when they arrive** (so read-back ordering is exact) and returned in `tool.result` on `reply.done`, as the docs recommend.

## Run it

```bash
cp .env.example .env        # add your ASSEMBLYAI_API_KEY
npm start                   # http://localhost:3000   (Node 18+, no dependencies)
npm test                    # unit tests + scenarios
npm run eval                # replays synthetic sessions through the real engine
```

- **Start live debrief** uses the mic. Chrome/Edge are recommended.
- **Replay** plays a scripted synthetic session through the same engine, with no mic and no API key. Use it for demos and reproducibility.
- **Export JSON** downloads the record, the transcript and the full audit log.

Deploy: `vercel` (static `public/`, plus the `api/voice-token` function). Set `ASSEMBLYAI_API_KEY` in the project env.

## Evaluation

### 1. Guardrail evaluation (deterministic, reproducible): `npm run eval`

The three synthetic scenarios run through the real case engine:

| Scenario | What it shows | Result |
|---|---|---|
| `en-full` | Full debrief. The model pre-empts facts the caseworker hasn't said yet (blocked), the caseworker corrects a read-back ("No, it was domestic servitude"), and a high + urgent case is held for supervisor review | 21/21 decisions as expected |
| `fr-partial` | French debrief. Finalizing is refused while required fields are missing | 7/7 |
| `adversarial` | Confirm before read-back, confirm before the answer, two pending fields, invented quote, phone number, personal name, out-of-schema value, a fact with no attribution, a real quote supporting the wrong value (Niger vs Nigeria), premature finalize, ambiguous "maybe" | 16/16 (13 shortcuts blocked) |
| `second-hand` | The caseworker's hunch is mislabelled "survivor reported" by the model. Code records it as an inference: documented MEDIUM, potential HIGH, held for supervisor | 18/18 |

**62/62 engine decisions match expectation, and 14 unit tests pass.** This checks the *guardrails*, not model quality.

### 2. Live evaluation protocol (H1/H2 with the real model)

1. Read each synthetic debrief script aloud in a live session: 3 EN and 2 FR, adapted from `public/core/scenarios.js`.
2. Export the JSON after each session.
3. Report, from the exported `metrics` and `audit`:
   - **Grounded field rate**: confirmed fields whose source quote matches a caseworker utterance. By construction this is 100%, and the number that matters is *how often the model tried to write something ungrounded* (`blocked_ungrounded / proposals`).
   - **Field accuracy**: confirmed values vs. the script's ground truth.
   - **Read-back catches**: `caseworker_rejections`, the errors caught before they reached the record.
   - **Attribution accuracy**: stored attribution vs. the script's truth. Track how often the model claimed "survivor reported" for a hedged statement (`inferences_marked` with `attribution_claimed ≠ attribution`).
   - **Time to a complete record** vs. typing the same case into a form.

## Limitations (stated plainly)

- The HTCDS subset and the indicator rules are **illustrative and not practitioner-validated**.
- Quote grounding checks that the words were said. It does not check that the *interpretation* is right. That is what the spoken read-back and the caseworker's "yes" are for.
- The PII guard is heuristic (digits, emails, "name is" patterns). It is not a guarantee.
- Low-resource field languages (Hausa, Kanuri, Fulfulde, Chadian Arabic) are **not addressed**. EN/FR only.
- Audio goes to a cloud API. A real deployment needs a data-protection assessment, informed consent, and org-controlled storage.
- The yes/no classifier and the hedge list cover common EN/FR phrasings only. Hedge detection is lexical: an unhedged inference ("they took her papers", said as a guess) is not caught, which is why the agent also asks "Did she tell you that, or is that your impression?".
- The gazetteer covers the Lake Chad Basin and neighbouring countries only.

## License

MIT
