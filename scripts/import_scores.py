"""Import category scores from JSON files into bill_category_scores under one scorer tag.

Usage: .venv/bin/python -I scripts/import_scores.py <scored_by> <file.json> [...] [--congress N]   (default 118)
Each file is a list (or {"bills": [...]}, as in bill_categories.json) of
{"bill_id", "scores": [{"category": <slug>, "score": -2..2, "confidence", "rationale"}]}.
Replaces every existing row for <scored_by> on the bills in the files; other scorers' rows are left alone.
Writes to $DATABASE_URL, or the local "dollarvote" database when it is unset.
"""
import argparse
import json
import os

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL", "dbname=dollarvote host=localhost")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scored_by")
    parser.add_argument("files", nargs="+")
    parser.add_argument("--congress", type=int, default=118)
    args = parser.parse_args()

    bills = []
    for path in args.files:
        data = json.load(open(path))
        bills += data["bills"] if isinstance(data, dict) else data

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute("SELECT slug, category_id FROM categories")
        ids_by_slug = dict(cur.fetchall())
        cur.execute("SELECT bill_id FROM bills WHERE congress = %s", (args.congress,))
        known = {r[0] for r in cur.fetchall()}

        seen = set()
        rows = []
        for bill in bills:
            bill_id = bill["bill_id"]
            assert bill_id in known, f"unknown bill {bill_id}"
            assert bill_id not in seen, f"duplicate bill {bill_id}"
            seen.add(bill_id)
            for s in bill["scores"]:
                assert s["category"] in ids_by_slug, f"{bill_id}: unknown category {s['category']}"
                rows.append((args.congress, bill_id, ids_by_slug[s["category"]], s["score"],
                             s["confidence"], s["rationale"], args.scored_by))

        cur.execute("DELETE FROM bill_category_scores WHERE congress = %s AND scored_by = %s AND bill_id = ANY(%s)",
                    (args.congress, args.scored_by, list(seen)))
        cur.executemany("""
            INSERT INTO bill_category_scores (congress, bill_id, category_id, score, confidence, rationale, scored_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)""", rows)
        print(f"{len(seen)} bills, {len(rows)} rows imported as {args.scored_by}")


if __name__ == "__main__":
    main()
