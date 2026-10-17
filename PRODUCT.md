# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, TypeScript, Node.js (user's choice). Server components query Postgres directly. Local Postgres database `dollarvote` in development; the final home is the Heroku app `dollarvote` (Heroku Postgres). Nothing goes to Heroku without the user's explicit go.

## Users

A voter, not a policy expert. They arrive with a few issues they care about (for example, protecting the environment) and want to know which members of Congress actually voted to advance those issues. It's a demo, so the first visit must make sense without any explanation.

## Product Purpose

Someone lands, picks the 5 voter-interest categories that matter most to them, and gets a list of the legislators whose votes promoted those interests, ranked by how well they line up. From there they can open a legislator to see the bills behind their score, and open a bill to see its category scores and how everyone voted.

Success: within a minute, someone who cares about the environment can name the legislators who voted for it, and can see the bills that back that up.

## Positioning

dollarvote measures votes against voter interests, not party labels or press releases. Each bill that got a recorded vote is scored from −2 to +2 on 24 interest categories. A legislator's alignment comes from how they voted on those bills. Money and campaign finance are not part of this demo.

## Operating Context

- Data: the 118th Congress (2023–2025). That's 532 bills that got a roll-call vote, 1,427 roll calls, 556 House and Senate members and 548k individual votes, from GovInfo BILLSTATUS, Voteview and unitedstates/congress-legislators.
- Excluded bills: 89 are left out of scoring (`bills.exclude_reason`). They're procedural House rules and the House's internal business. That leaves 443 scorable bills (the `scorable_bills` view).
- Scores: `bill_category_scores` holds one row per bill per affected category, with a score from −2 to +2, a confidence level (low, medium or high) and a one-line rationale. A missing row means the bill doesn't affect that category.
- Which votes count: only votes on the bill itself measure support. That's final passage, motions to suspend the rules and pass or agree, joint and simple resolutions, conference reports, concurring in the other chamber's amendment, and veto overrides. A yea counts as support and a nay as opposition. Amendment votes, motions to recommit or table, cloture votes and other procedural motions are not used for alignment.

## Capabilities and Constraints

- Categories: 24 (`categories` table). Four are axis categories (`is_axis`): Firearms, Immigration, Abortion & reproductive health, and AI & tech. On these, the score shows the direction a bill moves, not whether that's good. A visitor who picks an axis category must also pick a side (for example, "tighter immigration enforcement" or "more legal pathways"). The ranking then credits votes that move policy in that direction.
- How alignment works: for each selected category, each counted vote adds the bill's score when the legislator voted yea and subtracts it when they voted nay. Not voting and present count for nothing. Results are shown with how many scored votes they rest on, so a strong-looking score built on one vote doesn't read as solid.
- Scoring status: scores come from several AI models (Claude Opus 5.5, TypeSafe jev-1.13.0, GPT-6 Astra and Gemma 4), stored side by side in `bill_category_scores.scored_by`, and runs are still in progress. Where models disagree, the site uses their average for a bill and issue, and lists every model's score on the bill page. The site has to show live coverage honestly and say that the scores are AI judgments. It must not fill gaps with made-up scores.
- Terminology: "legislator" (members of both chambers); "bill" covers resolutions too; and use "roll call" or "recorded vote".

## Evidence on Hand

- The real data is in local Postgres `dollarvote`. Category definitions are in `data/categories.csv`, and an export of the scores is in `bill_categories.json`.
- There's no imagery, logo, or testimonials. Don't invent endorsements, user counts or partner logos.

## Product Principles

1. Interests first, parties second. Visitors start from what they care about, and party is context, not the main sort.
2. Every score can be traced. Any number leads to the bills and votes behind it, along with the rationale.
3. Be neutral on contested issues. Axis categories show direction, and the visitor decides which way is good.
4. Be honest about coverage. Show how many scored votes a result rests on, and say clearly when the data is thin.

## Accessibility & Inclusion

Meet WCAG AA. Don't use color alone for meaning (a positive versus negative score needs a sign or label as well as a color). It should work fully with a keyboard and on a phone.
