"""Score bills against data/categories.csv with TypeSafe and write bill_category_scores.

Usage: .venv/bin/python -I scripts/score_bills.py [congress] [--bill ID ...] [--limit N] [--eval]   (default 118)
Needs $TYPESAFE_API_KEY. Writes to $DATABASE_URL, or the local "dollarvote" database when it is unset.

Each bill gets one request: per category, a Noul (does the bill materially affect it?) and a five-level Score
(-2..2). Raw answers are cached in data/typesafe/<congress>/<bill_id>.json and only fetched when missing, so
thresholds below can be retuned without re-running inference. Rows are stored with scored_by "typesafe:<model>"
alongside other scorers' rows (pilot, gemma); see the category_comparison view. Only typesafe rows are replaced.
--eval compares cached answers with the pilot rows instead of writing.
"""
import argparse
import asyncio
import csv
import json
import os
from pathlib import Path

import psycopg
from typesafe_sdk import AsyncTypeSafeClient, Noul, Score

ROOT = Path(__file__).resolve().parent.parent
DATABASE_URL = os.environ.get("DATABASE_URL", "dbname=dollarvote host=localhost")
MODEL = "jev-1.13.0"  # pinned so cached answers and thresholds stay comparable
CONCURRENCY = 8
SUMMARY_CHARS = 24_000  # large irrelevant state lowers accuracy; omnibus summaries run to ~290k chars

AFFECTS_MIN = 0.6  # Noul threshold for a category to count as affected
MAJOR_MIN = 1.75  # |expected effect| needed for a ±2; plain rounding overstated magnitude against the pilot
# Score confidence and Noul probability both feed the stored low/medium/high label.
HIGH = {"affects": 0.85, "confidence": 0.6}
MEDIUM = {"affects": 0.65, "confidence": 0.3}


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def questions(categories):
    qs = {}
    for c in categories:
        name, pos, neg = c["name"], c["positive_means"], c["negative_means"]
        qs[f"{c['slug']}:affects"] = Noul(
            instructions=f"Would enacting `bill` directly and materially affect {name}?",
            criteria={"true": f"The bill's provisions would change outcomes for {name}, for example: {pos}; or: {neg}.",
                      "false": f"The bill touches {name} only incidentally, symbolically, or not at all."})
        qs[f"{c['slug']}:effect"] = Score(
            instructions=f"If `bill` were enacted, what would its effect be on {name}?",
            criteria=[f"Major effect on {name}: {neg}",
                      f"Modest or indirect effect on {name}: {neg}",
                      f"No meaningful effect on {name} either way",
                      f"Modest or indirect effect on {name}: {pos}",
                      f"Major effect on {name}: {pos}"])
    return qs


def bill_state(bill):
    title, policy_area, summary = bill[1:]
    return {"bill": {"title": title, "policy_area": policy_area,
                     "summary": summary[:SUMMARY_CHARS] if summary else "No summary available."}}


async def judge(client, sem, qs, bill, path):
    async with sem:
        response = await client.system_one(bill_state(bill), qs, model=MODEL)
    answers = {"model": response.model, "request_id": response.request_id,
               "input_tokens": response.usage.input_tokens, "affects": {}, "effect": {}}
    for qid, a in response.nouls.items():
        answers["affects"][qid.split(":")[0]] = a.noul
    for qid, a in response.scores.items():
        answers["effect"][qid.split(":")[0]] = {"score": a.score - 2, "confidence": a.confidence,
                                                "probabilities": {k - 2: p for k, p in a.probabilities.items()}}
    path.write_text(json.dumps(answers, indent=1))
    print(f"judged {bill[0]:12} {answers['input_tokens']:>7,} tokens")


def decide(answers, slug):
    affects, effect = answers["affects"][slug], answers["effect"][slug]
    magnitude = abs(effect["score"])
    if affects < AFFECTS_MIN or magnitude < 0.5:
        return None
    score = (2 if magnitude >= MAJOR_MIN else 1) * (1 if effect["score"] > 0 else -1)
    level = next((name for name, t in [("high", HIGH), ("medium", MEDIUM)]
                  if affects >= t["affects"] and effect["confidence"] >= t["confidence"]), "low")
    return score, level, affects, effect


def evaluate(cur, congress, cache, ids_by_slug):
    cur.execute("""SELECT bill_id, category_id, score FROM bill_category_scores
                   WHERE congress = %s AND scored_by LIKE '%%pilot'""", (congress,))
    reference = {}
    for bill_id, category_id, score in cur.fetchall():
        reference.setdefault(bill_id, {})[category_id] = score
    hits = misses = extras = same_sign = abs_err = 0
    for bill_id, ref in sorted(reference.items()):
        path = cache / f"{bill_id}.json"
        if not path.exists():
            print(f"{bill_id:12} not judged; run without --eval first")
            continue
        answers = json.loads(path.read_text())
        ours = {ids_by_slug[s]: d[0] for s in ids_by_slug if (d := decide(answers, s))}
        slugs = {v: k for k, v in ids_by_slug.items()}
        print(f"\n{bill_id}")
        for cid in sorted(ref.keys() | ours.keys()):
            a = answers["affects"][slugs[cid]]
            e = answers["effect"][slugs[cid]]
            print(f"  {slugs[cid]:26} ref {ref.get(cid, ''):>3}  ours {ours.get(cid, ''):>3}"
                  f"   affects {a:.2f}  effect {e['score']:+.2f} (conf {e['confidence']:.2f})")
            if cid in ref and cid in ours:
                hits += 1
                same_sign += (ref[cid] > 0) == (ours[cid] > 0)
                abs_err += abs(ref[cid] - ours[cid])
            elif cid in ref:
                misses += 1
            else:
                extras += 1
    if hits:
        print(f"\nreference rows found {hits}/{hits + misses}, extra rows {extras}, "
              f"same sign {same_sign}/{hits}, mean abs error {abs_err / hits:.2f}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("congress", nargs="?", type=int, default=118)
    parser.add_argument("--bill", nargs="*", default=None)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--eval", action="store_true")
    args = parser.parse_args()

    categories = read_csv(ROOT / "data" / "categories.csv")
    ids_by_slug = {c["slug"]: int(c["category_id"]) for c in categories}
    cache = ROOT / "data" / "typesafe" / str(args.congress)
    cache.mkdir(parents=True, exist_ok=True)

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        if args.eval:
            cur.execute("""SELECT DISTINCT bill_id FROM bill_category_scores
                           WHERE congress = %s AND scored_by LIKE '%%pilot'""", (args.congress,))
            args.bill = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT bill_id, title, policy_area, summary FROM bills WHERE congress = %s"
                    " AND (%s::text[] IS NULL OR bill_id = ANY(%s)) ORDER BY bill_id LIMIT %s",
                    (args.congress, args.bill, args.bill, args.limit))
        bills = cur.fetchall()

        todo = [b for b in bills if not (cache / f"{b[0]}.json").exists()]
        if todo:
            qs = questions(categories)
            sem = asyncio.Semaphore(CONCURRENCY)
            async with AsyncTypeSafeClient() as client:
                await asyncio.gather(*(judge(client, sem, qs, b, cache / f"{b[0]}.json") for b in todo))

        if args.eval:
            evaluate(cur, args.congress, cache, ids_by_slug)
            return

        rows = 0
        for bill_id, *_ in bills:
            answers = json.loads((cache / f"{bill_id}.json").read_text())
            cur.execute("DELETE FROM bill_category_scores WHERE congress = %s AND bill_id = %s"
                        " AND scored_by LIKE 'typesafe:%%'", (args.congress, bill_id))
            for slug, category_id in ids_by_slug.items():
                if not (d := decide(answers, slug)):
                    continue
                score, level, affects, effect = d
                cur.execute("""
                    INSERT INTO bill_category_scores (congress, bill_id, category_id, score, confidence, rationale, scored_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (args.congress, bill_id, category_id, score, level,
                     f"TypeSafe: affects p={affects:.2f}, effect {effect['score']:+.2f} (conf {effect['confidence']:.2f})",
                     f"typesafe:{answers['model']}"))
                rows += cur.rowcount
        print(f"{len(bills)} bills, {rows} typesafe rows written")


if __name__ == "__main__":
    asyncio.run(main())
