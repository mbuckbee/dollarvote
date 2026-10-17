import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCategories, getCoverage } from "@/lib/data";
import { SHRINK } from "@/lib/format";

export const metadata: Metadata = {
  title: "How scoring works",
  description: "How dollarvote scores bills on 24 voter issues and turns recorded votes into a ranking.",
};

export default function MethodPage() {
  return (
    <div className="wrap method">
      <header className="page-head">
        <h1>How a vote becomes a lamp</h1>
        <p>
          Every number on the board can be traced to specific bills, the score each bill got on an issue, and how the
          member voted on it. Here is the whole chain.
        </p>
      </header>
      <div className="method__grid">
        <article className="prose">
          <h2>1. Bills that got a recorded vote</h2>
          <p>
            The 118th Congress (January 2023 to January 2025) held recorded votes on 532 bills and resolutions. We leave
            out 89 of them: House rules that only set the terms of debate for another bill, and resolutions about the
            House’s own business, like censures and Speaker elections. That leaves 443 bills that can be scored.
          </p>

          <h2>2. A score on each issue it touches</h2>
          <p>
            The scoring is done by AI models, not people: each model reads the bill’s title and Congressional Research
            Service summary. <Link href="/models">The models page</Link> compares them. Each bill is read against 24
            voter issues and scored from <strong>−2</strong> (clearly hurts that issue) to{" "}
            <strong>+2</strong> (clearly helps it). Most bills touch one to four issues; the rest get no score at all,
            rather than a zero. A <strong>0</strong> means the bill helps the issue in some ways and hurts it in others.
            Every score comes with a reason and a confidence level. When more than one scorer rated the same bill on
            the same issue, the site uses their average and lists each score on the bill’s page.
          </p>
          <p>
            Four issues have no built-in right answer: firearms, immigration, abortion and reproductive health, and AI
            and tech. On those, the score records which way a bill moves policy, and you pick the side you favor.
          </p>

          <h2>3. Only votes on the bill itself</h2>
          <p>
            A yea on final passage, a motion to suspend the rules and pass, a conference report, or a veto override
            means the member backed the bill. Votes on amendments, motions to recommit, cloture and other procedural
            steps don’t measure that, so they don’t count. If a member voted on the same bill more than once, their
            last vote counts. Missed votes and present votes count for nothing.
          </p>

          <h2>4. From votes to a ranking</h2>
          <p>
            For each issue you pick, a yea on a bill adds its score and a nay subtracts it. The lamp shows the result as
            a share of the most a member could have earned: <strong>+100</strong> means every counted vote moved that
            issue your way, <strong>−100</strong> means every one moved it against you.
          </p>
          <p>
            The ranking is a little more careful than the lamp. A member with one lucky vote shouldn’t outrank one with
            twenty strong ones, so ranking adds {SHRINK} points of doubt to everyone’s total. Thin records sink a little;
            long records barely move. The vote count next to each lamp tells you how much a number rests on.
          </p>

          <h2>5. What this is not</h2>
          <ul>
            <li>It isn’t a party score. Party is shown, never used.</li>
            <li>It isn’t about money. Campaign finance isn’t part of this yet.</li>
            <li>
              It isn’t final. Scores are judgments, and you can read every reason on the bill’s page and disagree with
              it.
            </li>
          </ul>
        </article>
        <aside className="method__aside" aria-label="Coverage">
          <Suspense fallback={<div className="skeleton" style={{ height: "20rem" }} />}>
            <CoverageTable />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}

async function CoverageTable() {
  await connection();
  const [categories, coverage] = await Promise.all([getCategories(), getCoverage()]);
  return (
    <div className="coverage">
      <h2 className="coverage__title">Scored so far</h2>
      <p className="coverage__lede">
        {coverage.scored} of {coverage.scorable} bills, {coverage.scores} issue scores in all.{" "}
        {coverage.scored < coverage.scorable
          ? "Scoring is still in progress; unscored bills don’t count toward any ranking yet."
          : "Every scorable bill has been scored."}
      </p>
      <ul className="coverage__list">
        {categories.map((c) => (
          <li key={c.slug} data-empty={c.scored_bills === 0 || undefined}>
            <span>{c.name}</span>
            <span className="coverage__n">{c.scored_bills}</span>
          </li>
        ))}
      </ul>
      <p className="coverage__foot">
        <Link href="/bills">Browse the scored bills</Link>
      </p>
    </div>
  );
}
