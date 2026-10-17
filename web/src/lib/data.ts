import { query } from "./db";
import type { Pick } from "./picks";

export const CONGRESS = 118;

// Several scorers can score the same bill on the same issue (bill_category_scores.scored_by). The site
// uses their average, keeps the most recent confidence, and prefers a written reason over a model's
// shorthand ("TypeSafe: affects p=...").
const SCORES = `(
  SELECT congress, bill_id, category_id, avg(score)::float AS score, count(*)::int AS scorers,
         (array_agg(confidence ORDER BY scored_at DESC))[1] AS confidence,
         (array_agg(rationale ORDER BY (rationale LIKE 'TypeSafe:%'), scored_at DESC))[1] AS rationale
  FROM bill_category_scores GROUP BY congress, bill_id, category_id)`;

export type Category = {
  category_id: number;
  slug: string;
  name: string;
  is_axis: boolean;
  positive_means: string;
  negative_means: string;
  scored_bills: number;
};

export type Legislator = {
  chamber: "House" | "Senate";
  icpsr: number;
  bioguide_id: string;
  name: string;
  party: "D" | "R" | "I";
  state: string;
  district: number | null;
};

// Alignment for one interest: points earned over points possible, from -1 (always voted against) to 1.
export type Alignment = { points: number; possible: number; votes: number };

export type BoardRow = Legislator & { byPick: (Alignment | null)[]; overall: Alignment | null };

export type Coverage = { scorable: number; scored: number; scores: number };

export async function getCategories(): Promise<Category[]> {
  return query<Category>(
    `SELECT c.*, count(DISTINCT s.bill_id)::int AS scored_bills
     FROM categories c LEFT JOIN ${SCORES} s ON s.category_id = c.category_id AND s.score <> 0
     GROUP BY c.category_id ORDER BY c.category_id`,
  );
}

export async function getCoverage(): Promise<Coverage> {
  const [row] = await query<Coverage>(
    `SELECT (SELECT count(*) FROM scorable_bills)::int AS scorable,
            (SELECT count(DISTINCT bill_id) FROM bill_category_scores)::int AS scored,
            (SELECT count(*) FROM ${SCORES} s)::int AS scores`,
  );
  return row;
}

// Each legislator's last support-measuring yea/nay on every scored bill.
const SUPPORT_VOTES = `
  SELECT DISTINCT ON (v.chamber, v.icpsr, r.bill_id)
         v.chamber, v.icpsr, r.bill_id, r.rollnumber, r.date, r.vote_question, v.vote,
         CASE v.vote WHEN 'yea' THEN 1 ELSE -1 END AS sign
  FROM votes v JOIN rollcalls r USING (congress, chamber, rollnumber)
  WHERE r.congress = ${CONGRESS} AND r.measures_support AND v.vote IN ('yea', 'nay')
    AND r.bill_id IN (SELECT bill_id FROM bill_category_scores)
  ORDER BY v.chamber, v.icpsr, r.bill_id, r.date DESC, r.rollnumber DESC`;

export async function getBoard(picks: Pick[], categories: Category[]): Promise<BoardRow[]> {
  const legislators = await query<Legislator>(
    `SELECT chamber, icpsr, bioguide_id, name, party, state, district FROM legislators
     WHERE congress = $1 ORDER BY name`,
    [CONGRESS],
  );
  const ids = picks.map((p) => categories.find((c) => c.slug === p.slug)!.category_id);
  const dirs = picks.map((p) => p.dir);

  const rows = ids.length
    ? await query<{ chamber: string; icpsr: number; slot: number; points: number; possible: number; votes: number }>(
        `WITH picks AS (SELECT * FROM unnest($1::int[], $2::int[]) WITH ORDINALITY AS p(category_id, dir, slot)),
              support AS (${SUPPORT_VOTES})
         SELECT sv.chamber, sv.icpsr, p.slot::int - 1 AS slot,
                sum(s.score * p.dir * sv.sign) AS points, sum(abs(s.score)) AS possible, count(*)::int AS votes
         FROM support sv
         JOIN ${SCORES} s ON s.bill_id = sv.bill_id AND s.score <> 0
         JOIN picks p ON p.category_id = s.category_id
         GROUP BY sv.chamber, sv.icpsr, p.slot`,
        [ids, dirs],
      )
    : [];

  // A bill touching several picked issues still counts as one vote in the overall total.
  const billCounts = ids.length
    ? await query<{ chamber: string; icpsr: number; bills: number }>(
        `WITH support AS (${SUPPORT_VOTES})
         SELECT sv.chamber, sv.icpsr, count(DISTINCT sv.bill_id)::int AS bills
         FROM support sv JOIN ${SCORES} s ON s.bill_id = sv.bill_id AND s.score <> 0
         WHERE s.category_id = ANY($1::int[])
         GROUP BY sv.chamber, sv.icpsr`,
        [ids],
      )
    : [];
  const billsByKey = new Map(billCounts.map((b) => [`${b.chamber}:${b.icpsr}`, b.bills]));

  const byKey = new Map<string, (Alignment | null)[]>();
  for (const r of rows) {
    const key = `${r.chamber}:${r.icpsr}`;
    const slots = byKey.get(key) ?? picks.map(() => null);
    slots[r.slot] = { points: r.points, possible: r.possible, votes: r.votes };
    byKey.set(key, slots);
  }

  return legislators.map((l) => {
    const byPick = byKey.get(`${l.chamber}:${l.icpsr}`) ?? picks.map(() => null);
    const present = byPick.filter((a): a is Alignment => a !== null);
    const overall = present.length
      ? present.reduce((sum, a) => ({ points: sum.points + a.points, possible: sum.possible + a.possible, votes: sum.votes }),
          { points: 0, possible: 0, votes: billsByKey.get(`${l.chamber}:${l.icpsr}`) ?? 0 })
      : null;
    return { ...l, byPick, overall };
  });
}

export type BillScore = { slug: string; name: string; is_axis: boolean; score: number; confidence: string; rationale: string };
export type RawScore = { slug: string; score: number; scored_by: string; rationale: string };

export type LegislatorVote = {
  bill_id: string;
  title: string;
  date: string;
  vote_question: string;
  vote: "yea" | "nay";
  scores: BillScore[];
};

export async function getLegislator(bioguideId: string) {
  const [legislator] = await query<Legislator & { opensecrets_id: string | null; govtrack_id: string | null }>(
    `SELECT chamber, icpsr, bioguide_id, name, party, state, district, opensecrets_id, govtrack_id
     FROM legislators WHERE congress = $1 AND bioguide_id = $2 ORDER BY chamber LIMIT 1`,
    [CONGRESS, bioguideId],
  );
  if (!legislator) return null;

  const votes = await query<LegislatorVote>(
    `WITH support AS (${SUPPORT_VOTES})
     SELECT sv.bill_id, b.title, sv.date, sv.vote_question, sv.vote,
            json_agg(json_build_object('slug', c.slug, 'name', c.name, 'is_axis', c.is_axis, 'score', s.score,
                     'confidence', s.confidence, 'rationale', s.rationale) ORDER BY abs(s.score) DESC, c.category_id) AS scores
     FROM support sv
     JOIN bills b ON b.congress = ${CONGRESS} AND b.bill_id = sv.bill_id
     JOIN ${SCORES} s ON s.bill_id = sv.bill_id
     JOIN categories c ON c.category_id = s.category_id
     WHERE sv.chamber = $1 AND sv.icpsr = $2
     GROUP BY sv.bill_id, b.title, sv.date, sv.vote_question, sv.vote
     ORDER BY sv.date DESC`,
    [legislator.chamber, legislator.icpsr],
  );

  const [tally] = await query<{ yea: number; nay: number; missed: number }>(
    `SELECT count(*) FILTER (WHERE v.vote = 'yea')::int AS yea, count(*) FILTER (WHERE v.vote = 'nay')::int AS nay,
            count(*) FILTER (WHERE v.vote IN ('not_voting', 'present'))::int AS missed
     FROM votes v WHERE v.congress = $1 AND v.chamber = $2 AND v.icpsr = $3`,
    [CONGRESS, legislator.chamber, legislator.icpsr],
  );

  return { legislator, votes, tally };
}

export type BillRow = {
  bill_id: string;
  title: string;
  policy_area: string | null;
  law_number: string | null;
  latest_action_date: string | null;
  exclude_reason: string | null;
  scores: BillScore[];
};

export async function getBills(): Promise<BillRow[]> {
  return query<BillRow>(
    `SELECT b.bill_id, b.title, b.policy_area, b.law_number, b.latest_action_date, b.exclude_reason,
            coalesce(json_agg(json_build_object('slug', c.slug, 'name', c.name, 'is_axis', c.is_axis, 'score', s.score,
                     'confidence', s.confidence, 'rationale', s.rationale) ORDER BY abs(s.score) DESC, c.category_id)
                     FILTER (WHERE s.bill_id IS NOT NULL), '[]') AS scores
     FROM bills b
     LEFT JOIN ${SCORES} s ON s.congress = b.congress AND s.bill_id = b.bill_id
     LEFT JOIN categories c ON c.category_id = s.category_id
     WHERE b.congress = $1 AND b.exclude_reason IS NULL
     GROUP BY b.bill_id, b.title, b.policy_area, b.law_number, b.latest_action_date, b.exclude_reason
     ORDER BY count(s.bill_id) = 0, b.latest_action_date DESC NULLS LAST`,
    [CONGRESS],
  );
}

export type Rollcall = {
  chamber: "House" | "Senate";
  rollnumber: number;
  date: string;
  vote_question: string | null;
  vote_desc: string | null;
  vote_result: string | null;
  yea_count: number;
  nay_count: number;
  measures_support: boolean;
};

export type BoardVote = Legislator & { vote: string };

export async function getBill(billId: string) {
  const [bill] = await query<{
    bill_id: string; bill_type: string; number: number; title: string; policy_area: string | null;
    introduced_date: string | null; latest_action_date: string | null; latest_action_text: string | null;
    law_number: string | null; url: string | null; summary: string | null; summary_version: string | null;
    exclude_reason: string | null; sponsor_name: string | null; sponsor_bioguide_id: string | null;
  }>(
    `SELECT b.*, l.name AS sponsor_name FROM bills b
     LEFT JOIN LATERAL (SELECT name FROM legislators WHERE congress = b.congress AND bioguide_id = b.sponsor_bioguide_id LIMIT 1) l ON true
     WHERE b.congress = $1 AND b.bill_id = $2`,
    [CONGRESS, billId],
  );
  if (!bill) return null;

  const [scores, rawScores, rollcalls] = await Promise.all([
    query<BillScore>(
      `SELECT c.slug, c.name, c.is_axis, s.score, s.confidence, s.rationale
       FROM ${SCORES} s JOIN categories c USING (category_id)
       WHERE s.congress = $1 AND s.bill_id = $2 ORDER BY abs(s.score) DESC, c.category_id`,
      [CONGRESS, billId],
    ),
    query<RawScore>(
      `SELECT c.slug, s.score, s.scored_by, s.rationale
       FROM bill_category_scores s JOIN categories c USING (category_id)
       WHERE s.congress = $1 AND s.bill_id = $2 ORDER BY s.scored_at`,
      [CONGRESS, billId],
    ),
    query<Rollcall>(
      `SELECT chamber, rollnumber, date, vote_question, vote_desc, vote_result, yea_count, nay_count, measures_support
       FROM rollcalls WHERE congress = $1 AND bill_id = $2 ORDER BY date, chamber, rollnumber`,
      [CONGRESS, billId],
    ),
  ]);

  // The board shows the last support-measuring roll call in each chamber.
  const boardCalls = ["House", "Senate"]
    .map((chamber) => rollcalls.filter((r) => r.chamber === chamber && r.measures_support).at(-1))
    .filter((r): r is Rollcall => Boolean(r));

  const boards = await Promise.all(
    boardCalls.map(async (call) => ({
      call,
      votes: await query<BoardVote>(
        `SELECT l.chamber, l.icpsr, l.bioguide_id, l.name, l.party, l.state, l.district, v.vote
         FROM votes v JOIN legislators l USING (congress, chamber, icpsr)
         WHERE v.congress = $1 AND v.chamber = $2 AND v.rollnumber = $3 ORDER BY l.name`,
        [CONGRESS, call.chamber, call.rollnumber],
      ),
    })),
  );

  return { bill, scores, rawScores, rollcalls, boards };
}
