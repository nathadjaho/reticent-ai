// Deterministic trafficking-indicator scorer.
// Structure follows the Palermo Protocol elements (Act / Means / Purpose), with
// indicator wording inspired by CTDC/IOM categories. Only CONFIRMED fields count.
// It never reads audio, timing, hesitation or tone: survivor credibility is not assessed.
//
// Second-hand speech rule: a caseworker's inference can RAISE PROTECTION
// (supervisor review, child safeguards) but never counts as DOCUMENTED EVIDENCE.
//   documented_level  uses reported / observed / document-seen facts only
//   potential_level   also includes the caseworker's inferences
import { ATTRIBUTIONS } from "./schema.js";

const MEANS_CONTROL = {
  document_confiscation: "Identity documents confiscated",
  debt_bondage: "Debt bondage",
  threats: "Threats",
  restricted_movement: "Restricted freedom of movement",
  withheld_wages: "Wages withheld",
  physical_violence: "Physical violence",
  isolation: "Isolation",
};

function levelOf(flags) {
  const has = (el) => flags.some((f) => f.element === el);
  const child = has("status");
  const elements = { act: has("act"), means: has("means"), purpose: has("purpose") };
  let level = "insufficient";
  if (elements.act && elements.purpose && (elements.means || child)) level = "high";
  else if ([elements.act, elements.means, elements.purpose].filter(Boolean).length >= 2) level = "medium";
  else if (flags.some((f) => ["act", "means", "purpose", "status"].includes(f.element))) level = "low";
  return { level, elements };
}

export function scoreCase(record) {
  const c = (f) => (record[f]?.status === "confirmed" ? record[f] : null);
  const flags = [];
  const cite = (field, element, text, weight) => {
    const e = record[field];
    const attribution = e.attribution ?? null;
    flags.push({
      field, element, text, weight,
      quote: e.source_quote,
      utterance_id: e.utterance_id,
      attribution,
      established: attribution ? ATTRIBUTIONS[attribution].established : true,
    });
  };

  const age = c("age_group");
  const rec = c("recruitment_method");
  const expl = c("exploitation_type");
  const ctrl = c("control_methods");
  const origin = c("country_of_origin");
  const dest = c("country_of_exploitation");
  const safety = c("current_safety");

  // ACT
  if (rec && rec.value !== "unknown") cite("recruitment_method", "act", "Recruitment documented", 1);
  if (origin && dest && origin.value.trim().toLowerCase() !== dest.value.trim().toLowerCase())
    cite("country_of_exploitation", "act", "Cross-border movement (transport/transfer)", 1);

  // MEANS
  if (rec && rec.value === "deceptive_job_offer") cite("recruitment_method", "means", "Deception about the nature of the work", 2);
  if (rec && rec.value === "abduction") cite("recruitment_method", "means", "Abduction / use of force", 3);
  if (rec && rec.value === "debt_offer") cite("recruitment_method", "means", "Recruitment through debt", 2);
  if (ctrl) for (const m of ctrl.value) if (MEANS_CONTROL[m]) cite("control_methods", "means", MEANS_CONTROL[m], m === "physical_violence" ? 3 : 2);

  // PURPOSE
  if (expl && expl.value !== "unknown") cite("exploitation_type", "purpose", "Exploitation purpose documented", 2);

  // Special status
  const child = age && age.value === "child";
  if (child) cite("age_group", "status", "Child: 'means' element not required under the Palermo Protocol", 3);

  const safetyAtRisk = safety && safety.value === "at_risk";
  if (safetyAtRisk) cite("current_safety", "urgency", "Person reported still at risk", 3);

  const documented = levelOf(flags.filter((f) => f.established));
  const potential = levelOf(flags);
  const unverified = flags.filter((f) => !f.established);

  return {
    level: documented.level, // what the record can stand behind
    elements: documented.elements,
    potential_level: potential.level, // what protection must assume
    potential_elements: potential.elements,
    urgent: !!safetyAtRisk,
    points: flags.filter((f) => f.established).reduce((s, f) => s + f.weight, 0),
    flags,
    unverified,
    // Inference can raise protection: any child indication, urgency, or a HIGH
    // potential level sends the case to a supervisor.
    requires_supervisor: potential.level === "high" || !!safetyAtRisk || !!child,
  };
}
