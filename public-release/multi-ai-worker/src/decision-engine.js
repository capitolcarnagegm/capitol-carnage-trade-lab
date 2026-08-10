export const GRADE_SCALE = [
  [97, "A+"], [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"],
  [77, "C+"], [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"], [0, "F"]
];

export const MIN_ACCEPTABLE_SCORE = 87;
export const VALUE_HORIZON_YEARS = 5;
export const MAX_CONTRACT_YEARS = 5;

const PROFILES = {
  trade: {
    championshipEquity: 22,
    fiveYearSurplusValue: 22,
    marketEdge: 18,
    capContractEfficiency: 14,
    scarcityReplacement: 10,
    flexibilityLiquidity: 9,
    downsideRisk: 5
  },
  freeAgency: {
    championshipEquity: 20,
    fiveYearSurplusValue: 20,
    marketEdge: 14,
    capContractEfficiency: 22,
    scarcityReplacement: 12,
    flexibilityLiquidity: 7,
    downsideRisk: 5
  },
  extension: {
    championshipEquity: 16,
    fiveYearSurplusValue: 23,
    marketEdge: 12,
    capContractEfficiency: 25,
    scarcityReplacement: 9,
    flexibilityLiquidity: 9,
    downsideRisk: 6
  },
  draft: {
    championshipEquity: 14,
    fiveYearSurplusValue: 25,
    marketEdge: 18,
    capContractEfficiency: 12,
    scarcityReplacement: 13,
    flexibilityLiquidity: 12,
    downsideRisk: 6
  },
  roster: {
    championshipEquity: 24,
    fiveYearSurplusValue: 18,
    marketEdge: 10,
    capContractEfficiency: 16,
    scarcityReplacement: 13,
    flexibilityLiquidity: 12,
    downsideRisk: 7
  },
  default: {
    championshipEquity: 20,
    fiveYearSurplusValue: 20,
    marketEdge: 15,
    capContractEfficiency: 15,
    scarcityReplacement: 10,
    flexibilityLiquidity: 12,
    downsideRisk: 8
  }
};

function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 50;
}

export function gradeForScore(score) {
  const s = Math.round(clamp(score));
  return GRADE_SCALE.find(([min]) => s >= min)?.[1] || "F";
}

export function weightedDecisionScore(components = {}, actionType = "default") {
  const profile = PROFILES[actionType] || PROFILES.default;
  let total = 0;
  const normalized = {};
  for (const [key, weight] of Object.entries(profile)) {
    const score = clamp(components[key]);
    normalized[key] = { score, weight, contribution: score * weight / 100 };
    total += score * weight / 100;
  }
  const score = Math.round(total * 10) / 10;
  return {
    scoreOutOf100: score,
    letterGrade: gradeForScore(score),
    acceptable: score >= MIN_ACCEPTABLE_SCORE,
    components: normalized,
    profile: actionType in PROFILES ? actionType : "default"
  };
}

export function evaluateFourGates(gates = {}) {
  const names = ["championshipPath", "marketValue", "opportunityCost", "betterAlternative"];
  const normalized = {};
  let hardFail = false;
  for (const name of names) {
    const raw = gates[name] || {};
    const score = clamp(raw.score);
    const pass = raw.pass !== false && score >= 70;
    normalized[name] = { score, pass, reason: String(raw.reason || "") };
    if (!pass) hardFail = true;
  }
  return { pass: !hardFail, gates: normalized };
}

export function fiveYearValueCurve(years = []) {
  const curve = Array.from({ length: VALUE_HORIZON_YEARS }, (_, i) => {
    const y = years[i] || {};
    return {
      year: i + 1,
      projectedValue: Number(y.projectedValue || 0),
      expectedPoints: Number(y.expectedPoints || 0),
      salary: Number(y.salary || 0),
      surplusValue: Number(y.surplusValue || 0),
      championshipImpact: Number(y.championshipImpact || 0),
      confidence: clamp(y.confidence ?? 50)
    };
  });
  return curve;
}

export function finalRecommendation({ components, gates, actionType = "default", dataIntegrity = true }) {
  const score = weightedDecisionScore(components, actionType);
  const gateResult = evaluateFourGates(gates);
  const recommend = Boolean(dataIntegrity && gateResult.pass && score.acceptable);
  return {
    ...score,
    fourQuestionValueTest: gateResult,
    dataIntegrity,
    recommendation: recommend ? "APPROVE" : "REJECT_OR_REWORK",
    reasonCode: !dataIntegrity ? "DATA_INTEGRITY" : !gateResult.pass ? "VALUE_GATE_FAIL" : !score.acceptable ? "BELOW_B_PLUS" : "APPROVED"
  };
}
