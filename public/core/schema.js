// HTCDS-inspired case record subset used by the TRACE voice debrief.
// This is a deliberately small subset for a synthetic demo. It is NOT the full
// IOM Human Trafficking Case Data Standard and has not been reviewed by practitioners.

export const FIELDS = {
  survivor_ref: {
    label: { en: "survivor reference", fr: "référence du survivant" },
    kind: "code",
    pattern: /^TR-?\d{3}$/i,
    help: "Pseudonymous case code only, e.g. TR-014. Never a real name.",
    required: true,
  },
  age_group: {
    label: { en: "age group", fr: "tranche d'âge" },
    kind: "enum",
    values: {
      child: { en: "child, under 18", fr: "enfant, moins de 18 ans" },
      adult: { en: "adult", fr: "adulte" },
      unknown: { en: "unknown", fr: "inconnu" },
    },
    required: true,
  },
  country_of_origin: {
    label: { en: "country of origin", fr: "pays d'origine" },
    kind: "country",
    required: true,
  },
  country_of_exploitation: {
    label: { en: "country of exploitation", fr: "pays d'exploitation" },
    kind: "country",
    required: true,
  },
  recruitment_method: {
    label: { en: "recruitment method", fr: "méthode de recrutement" },
    kind: "enum",
    values: {
      deceptive_job_offer: { en: "deceptive job offer", fr: "fausse offre d'emploi" },
      family_or_acquaintance: { en: "recruited by family or acquaintance", fr: "recruté par la famille ou une connaissance" },
      abduction: { en: "abduction", fr: "enlèvement" },
      debt_offer: { en: "loan or debt offer", fr: "offre de prêt ou de dette" },
      unknown: { en: "unknown", fr: "inconnu" },
    },
    required: true,
  },
  exploitation_type: {
    label: { en: "type of exploitation", fr: "type d'exploitation" },
    kind: "enum",
    values: {
      forced_labour: { en: "forced labour", fr: "travail forcé" },
      domestic_servitude: { en: "domestic servitude", fr: "servitude domestique" },
      sexual_exploitation: { en: "sexual exploitation", fr: "exploitation sexuelle" },
      forced_begging: { en: "forced begging", fr: "mendicité forcée" },
      armed_group_association: { en: "association with an armed group", fr: "association à un groupe armé" },
      unknown: { en: "unknown", fr: "inconnu" },
    },
    required: true,
  },
  control_methods: {
    label: { en: "means of control", fr: "moyens de contrôle" },
    kind: "multi",
    values: {
      document_confiscation: { en: "documents confiscated", fr: "documents confisqués" },
      debt_bondage: { en: "debt bondage", fr: "servitude pour dettes" },
      threats: { en: "threats", fr: "menaces" },
      restricted_movement: { en: "restricted movement", fr: "liberté de mouvement restreinte" },
      withheld_wages: { en: "wages withheld", fr: "salaire retenu" },
      physical_violence: { en: "physical violence", fr: "violence physique" },
      isolation: { en: "isolation", fr: "isolement" },
    },
    required: true,
  },
  current_safety: {
    label: { en: "current safety", fr: "sécurité actuelle" },
    kind: "enum",
    values: {
      safe: { en: "currently safe", fr: "actuellement en sécurité" },
      at_risk: { en: "still at risk", fr: "toujours en danger" },
      unknown: { en: "unknown", fr: "inconnue" },
    },
    required: true,
  },
  immediate_needs: {
    label: { en: "immediate needs", fr: "besoins immédiats" },
    kind: "text",
    required: false,
  },
};

export const FIELD_NAMES = Object.keys(FIELDS);
export const REQUIRED_FIELDS = FIELD_NAMES.filter((f) => FIELDS[f].required);

// Human-readable label of a value (used for read-back verification and UI).
export function valueLabels(field, value) {
  const def = FIELDS[field];
  if (!def) return [];
  if (def.kind === "enum") {
    const v = def.values[value];
    return v ? [v.en, v.fr] : [];
  }
  if (def.kind === "multi") {
    return value.flatMap((x) => (def.values[x] ? [def.values[x].en, def.values[x].fr] : []));
  }
  return [String(value)];
}

export function displayValue(field, value, lang = "en") {
  const def = FIELDS[field];
  if (!def) return String(value);
  if (def.kind === "enum") return def.values[value]?.[lang] ?? value;
  if (def.kind === "multi") return value.map((x) => def.values[x]?.[lang] ?? x).join(", ");
  return String(value);
}

// Who is the source of a fact. Code may downgrade the model's claim to
// caseworker_inference (hedged speech); it never upgrades it.
export const ATTRIBUTIONS = {
  survivor_reported: { en: "survivor reported", fr: "rapporté par le survivant", established: true },
  caseworker_observed: { en: "caseworker observed", fr: "observé par le caseworker", established: true },
  document_seen: { en: "document seen", fr: "document vu", established: true },
  caseworker_inference: { en: "caseworker inference", fr: "déduction du caseworker", established: false },
};
// Fields where attribution matters for evidence (facts about what happened).
export const ATTRIBUTED_FIELDS = ["recruitment_method", "exploitation_type", "control_methods", "age_group", "current_safety"];
