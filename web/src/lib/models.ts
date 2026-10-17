import { query } from "./db";

// The four AI models that scored bills. Prices are USD per million tokens, as listed in October 2026.
export const MODELS = [
  {
    key: "opus",
    name: "Claude Opus 5.5",
    maker: "Anthropic",
    route: "A Claude Code agent session",
    method: "Reads each bill and writes −2 to +2 scores directly, each with a reason and a confidence level.",
    price: { input: 4, output: 20 },
    color: "#4fd6ff",
  },
  {
    key: "typesafe",
    name: "TypeSafe jev-1.13.0",
    maker: "TypeSafe",
    route: "TypeSafe API",
    method:
      "Answers, as probabilities, whether a bill affects each issue and how much. An issue counts when the chance it’s affected is at least 0.6 and the effect at least 0.5; effects of 1.75 or more score ±2.",
    price: { input: 0.042, output: 0 },
    color: "#8aa4ff",
  },
  {
    key: "gemma",
    name: "Gemma 4 31B",
    maker: "Google, open weights",
    route: "OpenRouter, mostly served by DeepInfra",
    method: "Writes −2 to +2 scores directly into a strict JSON schema, each with a reason and a confidence level.",
    price: null,
    color: "#ff78d8",
  },
  {
    key: "astra",
    name: "GPT-6 Astra",
    maker: "OpenAI",
    route: "An agent annotation run",
    method: "Writes −2 to +2 scores directly, each with a reason.",
    price: { input: 10, output: 50 },
    color: "#45e0c8",
  },
] as const;

export type ModelKey = (typeof MODELS)[number]["key"];

// TypeSafe logs input tokens per request in data/typesafe/118/*.json, not in the database.
const TYPESAFE_INPUT_TOKENS = 3_287_102;

// Every issue score from every model, on scorable bills, in one shape.
const ALL_SCORES = `
  SELECT 'opus' AS model, s.bill_id, c.slug, s.score::float AS score, length(coalesce(s.rationale, '')) AS chars
  FROM bill_category_scores s JOIN categories c USING (category_id) WHERE s.scored_by = 'claude-opus-5-5'
  UNION ALL
  SELECT 'typesafe', s.bill_id, c.slug, s.score::float, length(coalesce(s.rationale, ''))
  FROM bill_category_scores s JOIN categories c USING (category_id) WHERE s.scored_by LIKE 'typesafe:%'
  UNION ALL
  SELECT 'gemma', b.bill_id, e->>'category', (e->>'score')::float, length(e::text)
  FROM bills b, jsonb_array_elements(b.gemma_categorization->'scores') e
  UNION ALL
  SELECT 'astra', b.bill_id, e->>'category', (e->>'score')::float, length(e::text)
  FROM bills b, jsonb_array_elements(b.gpt_6_astra_categorization->'scores') e`;

export type ModelStats = {
  key: ModelKey;
  bills: number;
  scores: number;
  positive: number;
  negative: number;
  outputChars: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  costBasis: "reported" | "logged tokens × price" | "estimated";
};

export type ScoreRow = { model: ModelKey; bill_id: string; slug: string; score: number };

export async function getModelComparison() {
  const scorable = `SELECT bill_id FROM bills WHERE exclude_reason IS NULL`;
  const [rows, perModel, gemma, [{ scorable_bills }]] = await Promise.all([
    query<ScoreRow>(`SELECT model, bill_id, slug, score FROM (${ALL_SCORES}) a WHERE bill_id IN (${scorable})`),
    query<{ model: ModelKey; bills: number; scores: number; positive: number; negative: number; chars: number }>(
      `SELECT model, count(DISTINCT bill_id)::int AS bills, count(*)::int AS scores,
              count(*) FILTER (WHERE score > 0)::int AS positive, count(*) FILTER (WHERE score < 0)::int AS negative,
              sum(chars)::int AS chars
       FROM (${ALL_SCORES}) a WHERE bill_id IN (${scorable}) GROUP BY model`,
    ),
    query<{ bills: number; cost: number; input: number; output: number }>(
      `SELECT count(*)::int AS bills, sum((gemma_categorization->>'cost')::float) AS cost,
              sum((gemma_categorization->>'input_tokens')::int)::int AS input,
              sum((gemma_categorization->>'output_tokens')::int)::int AS output
       FROM bills WHERE gemma_categorization ? 'cost' AND gemma_categorization->>'cost' IS NOT NULL`,
    ),
    query<{ scorable_bills: number }>(`SELECT count(*)::int AS scorable_bills FROM bills WHERE exclude_reason IS NULL`),
  ]);

  // Gemma saw each bill's title and summary, so its real prompt size per bill is the yardstick for the
  // two models that logged no usage. Output is estimated at 4 characters per token, plus JSON overhead.
  const g = gemma[0];
  const inputPerBill = g.bills ? g.input / g.bills : 0;
  const stats: ModelStats[] = MODELS.map((model) => {
    const m = perModel.find((p) => p.model === model.key) ?? { bills: 0, scores: 0, positive: 0, negative: 0, chars: 0 };
    const base = { key: model.key, bills: m.bills, scores: m.scores, positive: m.positive, negative: m.negative, outputChars: m.chars };
    if (model.key === "gemma") {
      return { ...base, cost: g.cost, inputTokens: g.input, outputTokens: g.output, costBasis: "reported" };
    }
    if (model.key === "typesafe") {
      return { ...base, cost: (TYPESAFE_INPUT_TOKENS / 1e6) * model.price.input, inputTokens: TYPESAFE_INPUT_TOKENS, outputTokens: 0, costBasis: "logged tokens × price" };
    }
    const inputTokens = Math.round(inputPerBill * scorable_bills);
    const outputTokens = Math.round(m.chars / 4 + scorable_bills * 40);
    const price = model.price!;
    return {
      ...base,
      cost: (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output,
      inputTokens,
      outputTokens,
      costBasis: "estimated",
    };
  });

  return { rows, stats, scorableBills: scorable_bills, gemmaBills: g.bills };
}

// Bit order matches the Venn ellipses left to right.
export const MODEL_BITS: Record<ModelKey, number> = { opus: 1, typesafe: 2, gemma: 4, astra: 8 };

export function overlap(rows: ScoreRow[]) {
  const calls = new Map<string, { mask: number; scores: Partial<Record<ModelKey, number>> }>();
  for (const r of rows) {
    const key = `${r.bill_id}:${r.slug}`;
    const entry = calls.get(key) ?? { mask: 0, scores: {} };
    entry.mask |= MODEL_BITS[r.model];
    entry.scores[r.model] = r.score;
    calls.set(key, entry);
  }
  const regions = new Map<number, number>();
  for (const { mask } of calls.values()) regions.set(mask, (regions.get(mask) ?? 0) + 1);

  const keys = MODELS.map((m) => m.key);
  const pairs = keys.flatMap((a, i) =>
    keys.slice(i + 1).map((b) => {
      let both = 0, either = 0, sameSign = 0;
      for (const { scores } of calls.values()) {
        const sa = scores[a], sb = scores[b];
        if (sa === undefined && sb === undefined) continue;
        either++;
        if (sa !== undefined && sb !== undefined) {
          both++;
          if (Math.sign(sa) === Math.sign(sb)) sameSign++;
        }
      }
      return { a, b, both, either, sameSign };
    }),
  );
  return { total: calls.size, regions, pairs };
}
