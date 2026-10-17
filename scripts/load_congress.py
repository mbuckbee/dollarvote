"""Load voted bills, roll calls, legislators and votes for one Congress into Postgres.

Usage: .venv/bin/python -I scripts/load_congress.py [congress]   (default 118)
Writes to $DATABASE_URL, or the local "dollarvote" database when it is unset.
Rebuilds the data tables on each run; categories are upserted and bill_category_scores is never touched.
"""
import csv
import html
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
CONGRESS = int(sys.argv[1]) if len(sys.argv) > 1 else 118
RAW = ROOT / "data" / "raw" / str(CONGRESS)
DATABASE_URL = os.environ.get("DATABASE_URL", "dbname=dollarvote host=localhost")

VOTE_NAMES = {1: "yea", 2: "yea", 3: "yea", 4: "nay", 5: "nay", 6: "nay", 7: "present", 8: "present", 9: "not_voting"}
PARTY_NAMES = {100: "D", 200: "R"}
# Bills left out of category scoring: House rules that only set debate terms for another bill
# ("Providing for consideration of H.R. ..."), and the House's own business (CRS policy area "Congress":
# censures, Speaker votes, committee assignments, Legislative Branch appropriations).
# Roll calls where yea means "for this bill": passage, suspension, resolutions, conference reports,
# concurring and veto overrides. Amendment, recommit, cloture and other motions don't measure support.
SUPPORT_QUESTIONS = {
    "On Passage", "On Passage of the Bill", "On the Joint Resolution", "On the Resolution",
    "On Agreeing to the Resolution", "On Agreeing to the Resolution, as Amended",
    "On Motion to Suspend the Rules and Pass", "On Motion to Suspend the Rules and Pass, as Amended",
    "On Motion to Suspend the Rules and Agree", "On Motion to Suspend the Rules and Agree, as Amended",
    "On Motion to Suspend the Rules and Agree to the Resolution, as Amended",
    "On Motion to Suspend the Rules and Concur in the Senate Amendment", "On Motion to Concur in the Senate Amendment",
    "On the Conference Report", "On Overriding the Veto",
    "Passage, Objections of the President To The Contrary Notwithstanding",
}
PROCEDURAL_TITLE = re.compile(r"^Providing (for )?(further )?consideration", re.IGNORECASE)

SCHEMA = """
DROP VIEW IF EXISTS legislator_votes, scorable_bills, category_comparison;
DROP TABLE IF EXISTS votes, rollcalls, legislators, bills;

CREATE TABLE bills (
    congress integer, bill_id text, bill_type text, number integer, title text,
    introduced_date date, origin_chamber text, policy_area text, sponsor_bioguide_id text,
    latest_action_date date, latest_action_text text, law_number text, url text,
    summary text, summary_version text, exclude_reason text,
    PRIMARY KEY (congress, bill_id));

CREATE TABLE rollcalls (
    congress integer, chamber text, rollnumber integer, date date, session integer, clerk_rollnumber integer,
    bill_id text, vote_question text, vote_desc text, vote_result text, majority_requirement text,
    yea_count integer, nay_count integer, measures_support boolean,
    PRIMARY KEY (congress, chamber, rollnumber));
CREATE INDEX ON rollcalls (bill_id);

CREATE TABLE legislators (
    congress integer, chamber text, icpsr integer, bioguide_id text, name text, party text,
    state text, district integer, opensecrets_id text, fec_ids text, govtrack_id text,
    PRIMARY KEY (congress, chamber, icpsr));
CREATE INDEX ON legislators (bioguide_id);

CREATE TABLE votes (
    congress integer, chamber text, rollnumber integer, icpsr integer, vote text,
    PRIMARY KEY (congress, chamber, rollnumber, icpsr));
CREATE INDEX ON votes (congress, chamber, icpsr);

CREATE TABLE IF NOT EXISTS categories (
    category_id integer PRIMARY KEY, slug text UNIQUE, name text, is_axis boolean,
    positive_means text, negative_means text);

CREATE TABLE IF NOT EXISTS bill_category_scores (
    congress integer, bill_id text, category_id integer REFERENCES categories,
    score integer CHECK (score BETWEEN -2 AND 2),
    confidence text CHECK (confidence IN ('low', 'medium', 'high')),
    rationale text, scored_by text NOT NULL, scored_at timestamptz DEFAULT now(),
    PRIMARY KEY (congress, bill_id, category_id, scored_by));

CREATE VIEW category_comparison AS
SELECT s.congress, s.bill_id, c.slug AS category,
       max(s.score) FILTER (WHERE s.scored_by LIKE '%pilot') AS pilot_score,
       max(s.score) FILTER (WHERE s.scored_by LIKE 'typesafe:jev%') AS jev_score,
       max(s.score) FILTER (WHERE s.scored_by = 'claude-opus-5-5') AS opus_score,
       max(s.score) FILTER (WHERE s.scored_by LIKE 'gemma%') AS gemma_score
FROM bill_category_scores s JOIN categories c USING (category_id)
GROUP BY s.congress, s.bill_id, c.slug;

CREATE VIEW scorable_bills AS SELECT * FROM bills WHERE exclude_reason IS NULL;

CREATE VIEW legislator_votes AS
SELECT r.date, r.chamber, r.rollnumber, b.bill_id, b.title AS bill_title, r.vote_question, r.vote_result,
       l.bioguide_id, l.name, l.party, l.state, l.district, v.vote
FROM votes v
JOIN rollcalls r USING (congress, chamber, rollnumber)
JOIN bills b ON b.congress = r.congress AND b.bill_id = r.bill_id
JOIN legislators l ON l.congress = v.congress AND l.chamber = v.chamber AND l.icpsr = v.icpsr;
"""


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def text(el, path):
    found = el.find(path) if el is not None else None
    return found.text.strip() if found is not None and found.text else None


def strip_html(markup):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", markup))).strip() if markup else None


def parse_bill(path):
    bill = ET.parse(path).getroot().find("bill")
    summaries = sorted(bill.findall("summaries/summary"),
                       key=lambda s: (text(s, "actionDate") or "", text(s, "updateDate") or ""))
    latest = summaries[-1] if summaries else None
    title = text(bill, "title")
    if text(bill, "type") == "HRES" and PROCEDURAL_TITLE.match(title or ""):
        exclude_reason = "procedural_rule"
    elif text(bill, "policyArea/name") == "Congress":
        exclude_reason = "house_business"
    else:
        exclude_reason = None
    return (
        CONGRESS, f"{text(bill, 'type')}{text(bill, 'number')}", text(bill, "type"), int(text(bill, "number")),
        title, text(bill, "introducedDate"), text(bill, "originChamber"),
        text(bill, "policyArea/name"), text(bill, "sponsors/item/bioguideId"),
        text(bill, "latestAction/actionDate"), text(bill, "latestAction/text"),
        text(bill, "laws/item/number"), text(bill, "legislationUrl"),
        strip_html(text(latest, "cdata/text")), text(latest, "actionDesc"),
        exclude_reason,
    )


def copy(cur, table, columns, rows):
    with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as cp:
        for row in rows:
            cp.write_row(row)


def main():
    rollcalls = read_csv(RAW / "voteview" / f"HS{CONGRESS}_rollcalls.csv")
    voted_ids = {r["bill_number"] for r in rollcalls if r["bill_number"]}
    bill_paths = [p for p in sorted((RAW / "billstatus").glob("*/*.xml"))
                  if p.stem.removeprefix(f"BILLSTATUS-{CONGRESS}").upper() in voted_ids]
    bills = [parse_bill(p) for p in bill_paths]
    bill_ids = {b[1] for b in bills}

    rollcalls = [r for r in rollcalls if r["bill_number"] in bill_ids]
    rollcall_keys = {(r["chamber"], r["rollnumber"]) for r in rollcalls}

    crosswalk = {row["bioguide_id"]: row
                 for name in ["legislators-historical.csv", "legislators-current.csv"]
                 for row in read_csv(RAW / "legislators" / name)}
    members = [m for m in read_csv(RAW / "voteview" / f"HS{CONGRESS}_members.csv") if m["chamber"] in ("House", "Senate")]
    member_keys = {(m["chamber"], m["icpsr"]) for m in members}

    # Voteview also records the President's position (chamber "President"); member_keys drops those rows.
    votes = [
        (CONGRESS, v["chamber"], int(v["rollnumber"]), int(v["icpsr"]), VOTE_NAMES[int(v["cast_code"])])
        for chamber in ["H", "S"]
        for v in read_csv(RAW / "voteview" / f"{chamber}{CONGRESS}_votes.csv")
        if (v["chamber"], v["rollnumber"]) in rollcall_keys
        and (v["chamber"], v["icpsr"]) in member_keys
        and int(v["cast_code"]) in VOTE_NAMES
    ]

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute(SCHEMA)
        copy(cur, "bills", ["congress", "bill_id", "bill_type", "number", "title", "introduced_date", "origin_chamber",
                            "policy_area", "sponsor_bioguide_id", "latest_action_date", "latest_action_text",
                            "law_number", "url", "summary", "summary_version", "exclude_reason"], bills)
        copy(cur, "rollcalls", ["congress", "chamber", "rollnumber", "date", "session", "clerk_rollnumber", "bill_id",
                                "vote_question", "vote_desc", "vote_result", "majority_requirement",
                                "yea_count", "nay_count", "measures_support"],
             ((CONGRESS, r["chamber"], r["rollnumber"], r["date"], r["session"], r["clerk_rollnumber"] or None,
               r["bill_number"], r["vote_question"] or None, r["vote_desc"] or None, r["vote_result"] or None,
               r["majority_requirement"] or None, r["yea_count"], r["nay_count"],
               r["vote_question"] in SUPPORT_QUESTIONS) for r in rollcalls))
        copy(cur, "legislators", ["congress", "chamber", "icpsr", "bioguide_id", "name", "party", "state", "district",
                                  "opensecrets_id", "fec_ids", "govtrack_id"],
             ((CONGRESS, m["chamber"], m["icpsr"], m["bioguide_id"] or None, m["bioname"],
               PARTY_NAMES.get(int(m["party_code"]), "I"), m["state_abbrev"],
               None if m["district_code"] in ("", "0") else m["district_code"],
               crosswalk.get(m["bioguide_id"], {}).get("opensecrets_id") or None,
               crosswalk.get(m["bioguide_id"], {}).get("fec_ids") or None,
               crosswalk.get(m["bioguide_id"], {}).get("govtrack_id") or None) for m in members))
        copy(cur, "votes", ["congress", "chamber", "rollnumber", "icpsr", "vote"], votes)

        for c in read_csv(ROOT / "data" / "categories.csv"):
            cur.execute("""
                INSERT INTO categories VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (category_id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name,
                    is_axis = EXCLUDED.is_axis, positive_means = EXCLUDED.positive_means,
                    negative_means = EXCLUDED.negative_means""",
                (int(c["category_id"]), c["slug"], c["name"], c["is_axis"] == "true",
                 c["positive_means"], c["negative_means"]))
        cur.execute("ANALYZE")

        for table in ["bills", "scorable_bills", "rollcalls", "legislators", "votes", "categories", "bill_category_scores"]:
            cur.execute(f"SELECT count(*) FROM {table}")
            print(f"{table:22} {cur.fetchone()[0]:>9,}")


if __name__ == "__main__":
    main()
