import { test } from "node:test";
import assert from "node:assert/strict";
import { groundQuote, classifyReply, agentSaidValue, piiViolation } from "../public/core/grounding.js";
import { CaseSession } from "../public/core/caseEngine.js";
import { SCENARIOS } from "../public/core/scenarios.js";
import { runScenario } from "../eval/run.js";

const utts = [{ id: "u1", seq: 1, t: 0, text: "When she arrived they took her passport, and the owner said she owed him for the transport." }];

test("grounding accepts exact and lightly noisy quotes", () => {
  assert.equal(groundQuote("they took her passport", utts).ok, true);
  assert.equal(groundQuote("They took her passport and the owner said she owed him", utts).ok, true);
  assert.equal(groundQuote("quand elle est arrivée", [{ id: "x", text: "Quand elle est arrivée, ils ont pris son passeport" }]).ok, true);
});

test("grounding rejects invented or too-short quotes", () => {
  assert.equal(groundQuote("they beat her every day", utts).ok, false);
  assert.equal(groundQuote("passport", utts).ok, false);
  // scattered words across a long utterance do not count
  assert.equal(groundQuote("she said owed transport", [{ id: "y", text: "she was said to be many things owed nothing about any kind of transport" }]).ok, false);
});

test("reply classification is deterministic and conservative", () => {
  assert.equal(classifyReply("Yes."), "yes");
  assert.equal(classifyReply("Oui, c'est ça."), "yes");
  assert.equal(classifyReply("Yes, and she could not leave the house"), "yes");
  assert.equal(classifyReply("No, it was domestic servitude"), "no");
  assert.equal(classifyReply("Non, pas du tout"), "no");
  assert.equal(classifyReply("Hmm, I think so, maybe."), "unclear");
});

test("read-back must actually contain the value", () => {
  assert.equal(agentSaidValue(["deceptive job offer", "fausse offre d'emploi"], "Recruitment: deceptive job offer, right?"), true);
  assert.equal(agentSaidValue(["deceptive job offer"], "Got it, is that right?"), false);
});

test("PII guard", () => {
  assert.ok(piiViolation("call 0801234567"));
  assert.ok(piiViolation("her name is Amina"));
  assert.ok(piiViolation("elle s'appelle Amina"));
  assert.equal(piiViolation("needs shelter and medical check"), null);
});

test("nothing is written without grounding + read-back + yes", () => {
  const s = new CaseSession();
  s.addUserUtterance("She comes from Niger, I think.");
  assert.equal(s.handleTool("propose_field", { field: "country_of_origin", value: "Niger", source_quote: "she comes from Niger" }).is_error, false);
  assert.equal(s.record.country_of_origin.status, "pending");
  assert.equal(s.handleTool("confirm_field", { field: "country_of_origin" }).is_error, true);
  s.addAgentTurn("Country of origin: Niger, correct?");
  s.addUserUtterance("Yes.");
  assert.equal(s.handleTool("confirm_field", { field: "country_of_origin" }).is_error, false);
  assert.equal(s.record.country_of_origin.status, "confirmed");
});

for (const [id, sc] of Object.entries(SCENARIOS)) {
  test(`scenario ${id}`, () => {
    const { results, finalOk } = runScenario(sc);
    for (const r of results) assert.equal(r.got, r.step.expect, `${r.step.name} ${JSON.stringify(r.step.args)} -> ${JSON.stringify(r.out.result)}`);
    assert.ok(finalOk);
  });
}

test("hedged speech is recorded as the caseworker's inference, whatever the model claims", () => {
  const { snap } = runScenario(SCENARIOS["second-hand"]);
  const cm = snap.record.control_methods;
  assert.equal(cm.attribution_claimed, "survivor_reported");
  assert.equal(cm.attribution, "caseworker_inference");
  assert.equal(cm.hedge, "i think");
  assert.equal(snap.score.level, "medium"); // documented evidence
  assert.equal(snap.score.potential_level, "high"); // protection view
  assert.equal(snap.score.requires_supervisor, true); // inference raises protection
  assert.deepEqual(snap.score.unverified.map((f) => f.text), ["Identity documents confiscated"]);
});

test("code never upgrades an inference", () => {
  const s = new CaseSession();
  s.addUserUtterance("They took her passport when she arrived.");
  const out = s.handleTool("propose_field", { field: "control_methods", value: "document_confiscation", source_quote: "they took her passport", attribution: "caseworker_inference" });
  assert.equal(out.is_error, false);
  assert.equal(s.record.control_methods.attribution, "caseworker_inference");
});

test("value must be supported by the quote (Niger is not Nigeria)", () => {
  const s = new CaseSession();
  s.addUserUtterance("She comes from Niger, near Diffa.");
  assert.equal(s.handleTool("propose_field", { field: "country_of_origin", value: "Nigeria", source_quote: "she comes from Niger" }).is_error, true);
  assert.equal(s.handleTool("propose_field", { field: "country_of_origin", value: "Niger", source_quote: "she comes from Niger" }).is_error, false);
  const s2 = new CaseSession();
  s2.addUserUtterance("He worked on a farm near Maiduguri for two years.");
  const ok2 = s2.handleTool("propose_field", { field: "country_of_exploitation", value: "Nigeria", source_quote: "a farm near Maiduguri" });
  assert.equal(ok2.is_error, false); // city -> country via gazetteer
});

test("no candidate answer values in recognizer key terms", async () => {
  const { KEYTERMS } = await import("../public/core/agentConfig.js");
  const { GAZETTEER } = await import("../public/core/grounding.js");
  const places = new Set(Object.values(GAZETTEER).flat());
  for (const k of KEYTERMS) assert.ok(!places.has(k.toLowerCase()), `keyterm ${k} is a candidate answer`);
});
