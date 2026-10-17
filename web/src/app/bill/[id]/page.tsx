import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ScoreChip } from "@/components/ScoreChip";
import { getBill, getCategories, type BoardVote, type Rollcall } from "@/lib/data";
import { SLOT_COLORS, parsePicks } from "@/lib/picks";
import { billLabel, displayName, formatDate, signed, surname } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/bill/[id]">): Promise<Metadata> {
  await connection();
  const data = await getBill((await params).id.toUpperCase());
  if (!data) return { title: "Bill not found" };
  return {
    title: `${billLabel(data.bill.bill_id)}: ${data.bill.title}`,
    description: `How ${billLabel(data.bill.bill_id)} moves voter issues, and how every member of the 118th Congress voted on it.`,
  };
}

export default function BillPage(props: PageProps<"/bill/[id]">) {
  return (
    <Suspense fallback={<div className="wrap page-head"><div className="skeleton" style={{ height: "12rem" }} /></div>}>
      <Bill {...props} />
    </Suspense>
  );
}

const CONFIDENCE = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

async function Bill({ params, searchParams }: PageProps<"/bill/[id]">) {
  await connection();
  const [{ id }, { i }, categories] = await Promise.all([params, searchParams, getCategories()]);
  const data = await getBill(id.toUpperCase());
  if (!data) notFound();
  const picks = parsePicks(i, new Set(categories.map((c) => c.slug)), new Set(categories.filter((c) => c.is_axis).map((c) => c.slug)));
  const slotOf = (slug: string) => {
    const n = picks.findIndex((p) => p.slug === slug);
    return n >= 0 ? n : undefined;
  };
  const { bill, scores, rawScores, rollcalls, boards } = data;
  const long = (bill.summary?.length ?? 0) > 1400;

  return (
    <div className="wrap bill">
      <header className="bill__head">
        <Link href="/bills" className="back-link">
          All bills
        </Link>
        <p className="bill__label strip-type">
          {billLabel(bill.bill_id)}
          {bill.law_number && <span className="bill__law">Public Law {bill.law_number}</span>}
        </p>
        <h1 className="bill__title">{bill.title}</h1>
        <p className="bill__meta">
          {bill.sponsor_name && bill.sponsor_bioguide_id && (
            <>
              Sponsored by <Link href={`/legislator/${bill.sponsor_bioguide_id}`}>{displayName(bill.sponsor_name)}</Link> ·{" "}
            </>
          )}
          Introduced {formatDate(bill.introduced_date)}
          {bill.policy_area && <> · {bill.policy_area}</>}
          {bill.url && (
            <>
              {" "}
              · <a href={bill.url}>Congress.gov record</a>
            </>
          )}
        </p>
      </header>

      <section className="bill__section" aria-labelledby="scores-title">
        <h2 id="scores-title" className="section-title">
          How it moves voter issues
        </h2>
        {bill.exclude_reason ? (
          <p className="empty">
            {bill.exclude_reason === "procedural_rule"
              ? "This is a House rule that sets the terms of debate for another bill, so it isn't scored on its own."
              : "This resolution deals with the House's own business, so it isn't scored for voter issues."}
          </p>
        ) : scores.length ? (
          <ul className="score-list">
            {scores.map((s) => (
              <li key={s.slug} className="score-item">
                <ScoreChip score={s} slot={slotOf(s.slug)} slotColor={slotOf(s.slug) !== undefined ? SLOT_COLORS[slotOf(s.slug)!] : undefined} />
                <p className="score-item__why">{s.rationale}</p>
                <p className="score-item__confidence" data-level={s.confidence}>
                  {CONFIDENCE[s.confidence as keyof typeof CONFIDENCE]}
                  {s.is_axis && " · direction only, not good or bad"}
                </p>
                <p className="score-item__scorers">
                  {rawScores.filter((r) => r.slug === s.slug).length > 1 ? "AI scores averaged: " : "AI score: "}
                  {rawScores
                    .filter((r) => r.slug === s.slug)
                    .map((r) => `${signed(r.score)} from ${r.scored_by}`)
                    .join(", ")}
                  . <Link href="/models">Compare the models</Link>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Not scored yet. Votes on this bill don’t count toward anyone’s ranking until it is.</p>
        )}
      </section>

      {bill.summary && (
        <section className="bill__section" aria-labelledby="summary-title">
          <h2 id="summary-title" className="section-title">
            What it does
          </h2>
          {long ? (
            <details className="summary">
              <summary>
                <span className="summary__preview">{bill.summary.slice(0, 900).replace(/\s+\S*$/, "")}…</span>
                <span className="summary__toggle">Read the full summary</span>
              </summary>
              <p className="summary__full">{bill.summary}</p>
            </details>
          ) : (
            <p className="summary__text">{bill.summary}</p>
          )}
          <p className="summary__source">
            Summary by the Congressional Research Service{bill.summary_version ? `, ${bill.summary_version.toLowerCase()} version` : ""}.
          </p>
        </section>
      )}

      {boards.map(({ call, votes }) => (
        <ChamberBoard key={`${call.chamber}-${call.rollnumber}`} call={call} votes={votes} />
      ))}

      <section className="bill__section" aria-labelledby="calls-title">
        <h2 id="calls-title" className="section-title">
          Every recorded vote on it
        </h2>
        <ol className="call-list">
          {rollcalls.map((r) => (
            <li key={`${r.chamber}-${r.rollnumber}`} className="call" data-counts={r.measures_support || undefined}>
              <span className="call__date">{formatDate(r.date)}</span>
              <span className="call__question">
                <span className="call__chamber">{r.chamber}</span> {r.vote_question ?? "Vote"}
                {r.vote_desc && <span className="call__desc">{r.vote_desc}</span>}
              </span>
              <span className="call__tally">
                <span className="call__yea">{r.yea_count} yea</span> <span className="call__nay">{r.nay_count} nay</span>
              </span>
              <span className="call__counts">{r.measures_support ? "Counts toward rankings" : "Procedural, not counted"}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// The signature view: the chamber's tally board for the vote that decided the bill.
function ChamberBoard({ call, votes }: { call: Rollcall; votes: BoardVote[] }) {
  const counts = { yea: 0, nay: 0, present: 0, not_voting: 0 } as Record<string, number>;
  for (const v of votes) counts[v.vote] = (counts[v.vote] ?? 0) + 1;
  const id = `board-${call.chamber}`;
  return (
    <section className="bill__section tally" aria-labelledby={id}>
      <div className="tally__head">
        <h2 id={id} className="section-title">
          {call.chamber} board
        </h2>
        <p className="tally__question">
          {call.vote_question}, {formatDate(call.date)}
          {call.vote_result && <> · {call.vote_result}</>}
        </p>
      </div>
      <div className="tally__totals" role="list" aria-label="Totals">
        {(["yea", "nay", "present", "not_voting"] as const).map((key) => (
          <div key={key} className="tally__total" data-vote={key} role="listitem">
            <span className="tally__total-n">{counts[key] ?? 0}</span>
            <span className="tally__total-label">{key === "not_voting" ? "Not voting" : key === "yea" ? "Yea" : key === "nay" ? "Nay" : "Present"}</span>
          </div>
        ))}
      </div>
      <ul className="tally__grid" data-chamber={call.chamber}>
        {votes.map((v) => (
          <li key={v.icpsr} className="tally__cell" data-vote={v.vote}>
            <Link href={`/legislator/${v.bioguide_id}`} className="tally__name strip-type" title={displayName(v.name)}>
              <span className="tally__surname">{surname(v.name)}</span>
              <span className="tally__state">{v.state}</span>
            </Link>
            <span className={`vote-lamp vote-lamp--${v.vote}`} role="img" aria-label={voteWord(v.vote)}>
              {v.vote === "yea" ? "Y" : v.vote === "nay" ? "N" : v.vote === "present" ? "P" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function voteWord(vote: string): string {
  return vote === "not_voting" ? "Not voting" : vote.charAt(0).toUpperCase() + vote.slice(1);
}
