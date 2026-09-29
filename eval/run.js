// Replays the synthetic scenarios through the real case engine and checks every
// decision. Run: npm run eval
import { CaseSession } from "../public/core/caseEngine.js";
import { SCENARIOS } from "../public/core/scenarios.js";

export function runScenario(sc) {
  let t = 0;
  const s = new CaseSession({ now: () => (t += 1500) });
  const results = [];
  for (const step of sc.steps) {
    if (step.type === "user") s.addUserUtterance(step.text);
    else if (step.type === "agent") s.addAgentTurn(step.text);
    else {
      const out = s.handleTool(step.name, step.args);
      const got = out.is_error ? "blocked" : "accepted";
      results.push({ step, got, pass: got === step.expect, out });
    }
  }
  const snap = s.snapshot();
  const finalOk =
    (!sc.expectFinal.status || snap.status === sc.expectFinal.status) &&
    (!sc.expectFinal.level || snap.score.level === sc.expectFinal.level) &&
    (!sc.expectFinal.potential_level || snap.score.potential_level === sc.expectFinal.potential_level);
  return { results, snap, finalOk };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.js")) {
  let allPass = true;
  const totals = { decisions: 0, correct: 0 };
  for (const [id, sc] of Object.entries(SCENARIOS)) {
    const { results, snap, finalOk } = runScenario(sc);
    console.log(`\n=== ${id}: ${sc.title}`);
    for (const r of results) {
      totals.decisions++;
      if (r.pass) totals.correct++;
      else allPass = false;
      const mark = r.pass ? "✓" : "✗";
      const msg = r.out.is_error ? r.out.result.error : r.out.result.status ?? "";
      console.log(`  ${mark} ${r.step.name.padEnd(19)} ${r.got.padEnd(8)} ${r.step.why ? "— " + r.step.why : ""}${r.pass ? "" : `  [expected ${r.step.expect}] ${msg}`}`);
    }
    if (!finalOk) allPass = false;
    console.log(`  final: status=${snap.status} documented=${snap.score.level} potential=${snap.score.potential_level} ${finalOk ? "✓" : "✗ expected " + JSON.stringify(sc.expectFinal)}`);
    console.log(`  metrics: ${JSON.stringify(snap.metrics)}`);
  }
  console.log(`\nDecisions matching expectation: ${totals.correct}/${totals.decisions}`);
  console.log(allPass ? "ALL SCENARIOS PASS" : "SOME SCENARIOS FAIL");
  process.exit(allPass ? 0 : 1);
}
