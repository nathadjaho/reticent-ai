// Deterministic checks. No model is involved in any of these decisions.

export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[’'`]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s) {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

// Longest common in-order token subsequence between quote q and utterance u,
// returning its length and the span it covers in u.
function lcsAlign(q, u) {
  const m = q.length, n = u.length;
  const dp = Array.from({ length: m + 1 }, () => new Int16Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = q[i - 1] === u[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  // backtrack to find matched positions in u
  let i = m, j = n, first = -1, last = -1;
  while (i > 0 && j > 0) {
    if (q[i - 1] === u[j - 1]) {
      if (last < 0) last = j - 1;
      first = j - 1;
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return { len: dp[m][n], span: first < 0 ? 0 : last - first + 1, first, last };
}

export const MIN_QUOTE_TOKENS = 3;
export const MIN_COVERAGE = 0.8;

/**
 * Is `quote` something the caseworker actually said?
 * Returns the best matching utterance or a reason for rejection.
 * Tolerates small transcription/paraphrase noise (80% of quote words, in order,
 * within a compact span of one utterance) but not invention.
 */
export function groundQuote(quote, utterances) {
  const q = tokens(quote);
  if (q.length < MIN_QUOTE_TOKENS)
    return { ok: false, reason: `source_quote too short: give at least ${MIN_QUOTE_TOKENS} words the caseworker actually said` };
  let best = null;
  for (const utt of utterances) {
    const u = tokens(utt.text);
    const { len, span, first, last } = lcsAlign(q, u);
    const coverage = len / q.length;
    const compact = span <= Math.ceil(q.length * 1.5) + 2;
    if (compact && (!best || coverage > best.coverage))
      best = {
        utterance: utt,
        coverage,
        // the matched span plus up to 5 words before it (where hedges like "I think" live)
        context: first < 0 ? [] : u.slice(Math.max(0, first - 5), last + 1),
        matched: first < 0 ? [] : u.slice(first, last + 1),
      };
  }
  if (best && best.coverage >= MIN_COVERAGE) return { ok: true, ...best };
  return {
    ok: false,
    coverage: best?.coverage ?? 0,
    reason: "source_quote does not match anything the caseworker said. Ask the caseworker instead of guessing.",
  };
}

const YES = [
  "yes", "yeah", "yep", "correct", "right", "confirmed", "confirm", "exactly", "affirmative", "ok", "okay",
  "oui", "exact", "exactement", "confirme", "c est ca", "c est juste", "d accord", "tout a fait",
];
const NO = [
  "no", "nope", "not", "wrong", "incorrect", "isn t", "that s not",
  "non", "pas", "faux", "incorrect", "erreur",
];

function hasPhrase(norm, phrase) {
  return new RegExp(`(^| )${phrase}( |$)`).test(norm);
}

/** Deterministic yes/no classification of a caseworker reply. */
export function classifyReply(text) {
  // Only the opening of the reply decides ("Yes, and she could not leave" is a yes).
  const n = normalize(text).split(" ").slice(0, 4).join(" ");
  const yes = YES.some((p) => hasPhrase(n, p));
  const no = NO.some((p) => hasPhrase(n, p));
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}

/** Did the agent actually say the value out loud? (read-back verification) */
export function agentSaidValue(labels, agentText) {
  const said = new Set(tokens(agentText));
  return labels.some((label) => {
    const lt = tokens(label).filter((t) => t.length > 2);
    if (lt.length === 0) return tokens(label).every((t) => said.has(t));
    const hit = lt.filter((t) => said.has(t)).length;
    return hit / lt.length >= 0.6;
  });
}

/** Personal-data guard for values written to the record. */
export function piiViolation(value) {
  const s = String(value);
  if ((s.match(/\d/g) || []).length >= 7) return "looks like a phone or ID number";
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) return "looks like an email address";
  const n = normalize(s);
  if (/(^| )(name|named|called|s appelle|nom|prenom)( |$)/.test(n)) return "looks like a personal name";
  return null;
}

// ---------- attribution: who is the source of this fact? ----------
// A caseworker debrief is second-hand speech. Hedges mark the caseworker's own
// inference, which code records as such whatever the model claims.
const HEDGES = [
  "i think", "i guess", "i believe", "i suspect", "i assume", "maybe", "probably", "possibly", "perhaps",
  "seems", "seemed", "looks like", "looked like", "might", "may have", "apparently", "not sure", "likely",
  "je pense", "je crois", "je suppose", "peut etre", "probablement", "semble", "semblait", "on dirait",
  "sans doute", "il me semble", "pas sur", "pas sure", "apparemment", "j ai l impression",
];

export function findHedge(tokenList) {
  const n = tokenList.join(" ");
  return HEDGES.find((h) => hasPhrase(n, h)) ?? null;
}

// ---------- value-level grounding for place fields ----------
// The quote must name the country itself, a known synonym, or a known city in it.
// Exact token match: "Niger" never supports "Nigeria" and vice versa.
export const GAZETTEER = {
  Chad: ["chad", "tchad", "n djamena", "ndjamena", "bol", "moundou", "abeche", "sarh", "lac"],
  Niger: ["niger", "niamey", "diffa", "zinder", "agadez", "maradi"],
  Nigeria: ["nigeria", "kano", "lagos", "abuja", "maiduguri", "borno", "kaduna"],
  Cameroon: ["cameroon", "cameroun", "maroua", "yaounde", "douala", "garoua", "kousseri"],
  Libya: ["libya", "libye", "tripoli", "sabha", "sebha"],
  Sudan: ["sudan", "soudan", "khartoum", "darfur"],
  "Central African Republic": ["central african republic", "centrafrique", "republique centrafricaine", "bangui"],
};

export function canonicalCountry(value) {
  const n = normalize(value);
  for (const [country, names] of Object.entries(GAZETTEER)) if (names.includes(n) || normalize(country) === n) return country;
  return null;
}

export function quoteSupportsCountry(country, tokenList) {
  const n = tokenList.join(" ");
  return (GAZETTEER[country] ?? [normalize(country)]).some((name) => hasPhrase(n, name));
}

export function quoteSupportsText(value, tokenList) {
  const set = new Set(tokenList);
  const content = tokens(value).filter((t) => t.length > 3);
  if (!content.length) return true;
  return content.filter((t) => set.has(t)).length / content.length >= 0.5;
}
