# dollarvote

Find out which members of Congress actually voted for the issues you care about.

Pick the five voter-interest categories that matter most to you (protecting the environment, say) and dollarvote ranks legislators by how well their recorded votes line up with those interests. Open a legislator to see the bills behind their score, and open a bill to see its category scores and how everyone voted.

This is a demo built on the 118th Congress (2023–2025).

## Goals

- **Interests first, parties second.** Visitors start from what they care about. Party is context, not the sort order.
- **Every score can be traced.** Any number leads back to the bills, the votes and the rationale behind it.
- **Neutral on contested issues.** Four categories (Firearms, Immigration, Abortion & reproductive health, AI & tech) are scored by the direction a bill moves policy, not whether that's good. The visitor picks the side.
- **Honest about coverage.** Results show how many scored votes they rest on, and the site says plainly that bill scores are AI judgments. Gaps are left as gaps, never filled with made-up scores.

Success looks like this: within a minute, someone who cares about the environment can name the legislators who voted for it and see the bills that back that up.

Money and campaign finance are not part of this demo yet, despite the name.

## How it works

1. **Data.** Bills come from GovInfo BILLSTATUS, roll-call votes from Voteview, and legislator IDs from [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators). That's 532 bills with a roll-call vote, 1,427 roll calls, 556 House and Senate members and about 548k individual votes. Of those bills, 89 are procedural House rules or internal business and are excluded, leaving 443 scorable bills.
2. **Scoring.** Each bill is scored from −2 to +2 on each of 24 interest categories it affects (`data/categories.csv`), with a confidence level and a one-line rationale. A bill that doesn't touch a category gets no score for it.
3. **Alignment.** Only votes on the bill itself count: final passage, suspension votes, resolutions, conference reports, concurrence and veto overrides. Amendment, cloture and other procedural votes are ignored. For each selected category, a yea adds the bill's score and a nay subtracts it.

## Models

Bill scores come from several AI models, stored side by side so they can be compared. Where models disagree, the site uses their average and lists every model's score on the bill page. Scoring runs are still in progress.

| Model | How it's run | Script |
|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | Direct annotation, including an initial pilot set | — |
| TypeSafe `jev-1.13.0` | TypeSafe System One API, version pinned so cached answers stay comparable | `scripts/score_bills.py` |
| Gemma 4 (`gemma4:12b` locally, `google/gemma-4-31b-it` via OpenRouter) | Local Ollama, or OpenRouter to resume runs | `scripts/score_bills_gemma.py`, `scripts/score_bills_openrouter.py` |
| GPT-6 Astra | Direct agent annotation, imported from run files in `data/astra/` | `scripts/import_astra_categories.py` |

Each model's scores are tagged in `bill_category_scores.scored_by`, or kept in per-model JSONB columns on `bills` (`gemma_categorization`, `gpt_6_astra_categorization`).

## Layout

- `web/`: Next.js (App Router, TypeScript) site. Server components query Postgres directly.
- `scripts/`: Python loaders and scorers (`load_congress.py`, `import_scores.py` and the scoring scripts above).
- `data/`: category definitions, cached model outputs (`typesafe/`, `astra/`) and raw source data (`raw/`, not committed; see `data/raw/118/README.md` for sources).
- `bill_categories.json`: an export of the bill scores.

## Running locally

Needs Postgres with a `dollarvote` database. Every script reads `DATABASE_URL` and falls back to the local database when it's unset.

```bash
# web app
cd web && npm install && npm run dev

# scorers (each needs its own key: TYPESAFE_API_KEY, OPENROUTER_API_KEY)
python -m venv .venv && .venv/bin/pip install "psycopg[binary]" typesafe-sdk
.venv/bin/python -I scripts/score_bills.py
```
