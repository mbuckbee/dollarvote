import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Lamp } from "@/components/Lamp";
import { ScoreChip } from "@/components/ScoreChip";
import { getCategories, getLegislator, type BillScore, type Category, type LegislatorVote } from "@/lib/data";
import { PARTY_NAMES, billLabel, displayName, formatDate, percent, seat } from "@/lib/format";
import { SLOT_COLORS, parsePicks, picksQuery, type Pick } from "@/lib/picks";

export async function generateMetadata({ params }: PageProps<"/legislator/[id]">): Promise<Metadata> {
  await connection();
  const data = await getLegislator((await params).id);
  if (!data) return { title: "Member not found" };
  const name = displayName(data.legislator.name);
  return {
    title: name,
    description: `How ${name} (${seat(data.legislator)}) voted on scored bills in the 118th Congress, issue by issue.`,
  };
}

export default function LegislatorPage(props: PageProps<"/legislator/[id]">) {
  return (
    <Suspense fallback={<div className="wrap page-head"><div className="skeleton" style={{ height: "12rem" }} /></div>}>
      <Legislator {...props} />
    </Suspense>
  );
}

type IssueSummary = { category: Category; pick?: Pick; slot?: number; points: number; possible: number; votes: number };

async function Legislator({ params, searchParams }: PageProps<"/legislator/[id]">) {
  await connection();
  const [{ id }, { i }, categories] = await Promise.all([params, searchParams, getCategories()]);
  const data = await getLegislator(id);
  if (!data) notFound();
  const { legislator, votes, tally } = data;

  const picks = parsePicks(i, new Set(categories.map((c) => c.slug)), new Set(categories.filter((c) => c.is_axis).map((c) => c.slug)));
  const issues = summarize(votes, categories, picks);
  const yours = issues.filter((s) => s.pick);
  const others = issues.filter((s) => !s.pick && !s.category.is_axis);
  const name = displayName(legislator.name);

  return (
    <div className="wrap member">
      <header className="member__head">
        <Link href={`/${picksQuery(picks)}`} className="back-link">
          Back to the board
        </Link>
        <h1 className="member__plate">
          <span className="member__surname strip-type">{legislator.name.split(",")[0]}</span>
          <span className="member__given">{name}</span>
        </h1>
        <p className="member__seat">
          {PARTY_NAMES[legislator.party]} ·{" "}
          {legislator.chamber === "Senate"
            ? `U.S. senator from ${legislator.state}`
            : `U.S. House, ${legislator.district ? `${legislator.state}-${legislator.district}` : `${legislator.state} at-large`}`}
        </p>
        <p className="member__record">
          Cast {(tally.yea + tally.nay).toLocaleString()} yea or nay votes in the 118th Congress and missed or voted
          present on {tally.missed.toLocaleString()}. {votes.length} of those votes were on scored bills, and they are
          the ones behind every number below.
        </p>
      </header>

      {yours.length > 0 && (
        <section className="member__section" aria-labelledby="yours-title">
          <h2 id="yours-title" className="section-title">
            On your issues
          </h2>
          <IssueList issues={yours} />
        </section>
      )}

      {others.length > 0 && (
        <section className="member__section" aria-labelledby="others-title">
          <h2 id="others-title" className="section-title">
            {yours.length ? "On other issues" : "Issue by issue"}
          </h2>
          <IssueList issues={others} />
          <p className="member__note">
            Contested issues like guns, immigration, abortion and AI only show up here once you pick a side on the board.
          </p>
        </section>
      )}

      <section className="member__section" aria-labelledby="votes-title">
        <h2 id="votes-title" className="section-title">
          The votes behind it
        </h2>
        {votes.length ? (
          <ol className="vote-list">
            {votes.map((v) => (
              <li key={v.bill_id} className="vote-item">
                <span className={`vote-lamp vote-lamp--${v.vote}`} aria-hidden="true">
                  {v.vote === "yea" ? "Y" : "N"}
                </span>
                <div className="vote-item__body">
                  <p className="vote-item__line">
                    <span className="vote-item__verdict">Voted {v.vote}</span> on{" "}
                    <Link href={`/bill/${v.bill_id}${picksQuery(picks)}`}>
                      {billLabel(v.bill_id)}, {v.title}
                    </Link>
                  </p>
                  <p className="vote-item__meta">
                    {formatDate(v.date)} · {v.vote_question}
                  </p>
                  <div className="chips">
                    {v.scores.map((s: BillScore) => {
                      const slot = picks.findIndex((p) => p.slug === s.slug);
                      return (
                        <ScoreChip
                          key={s.slug}
                          score={s}
                          slot={slot >= 0 ? slot : undefined}
                          slotColor={slot >= 0 ? SLOT_COLORS[slot] : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">
            {name} didn’t cast a yea or nay on any scored bill yet. As more bills get scored, their votes will show up here.
          </p>
        )}
      </section>
    </div>
  );
}

function summarize(votes: LegislatorVote[], categories: Category[], picks: Pick[]): IssueSummary[] {
  const totals = new Map<string, IssueSummary>();
  for (const v of votes) {
    const sign = v.vote === "yea" ? 1 : -1;
    for (const s of v.scores) {
      if (s.score === 0) continue;
      const category = categories.find((c) => c.slug === s.slug)!;
      const slot = picks.findIndex((p) => p.slug === s.slug);
      const pick = slot >= 0 ? picks[slot] : undefined;
      const dir = pick?.dir ?? 1;
      const entry = totals.get(s.slug) ?? { category, pick, slot: pick ? slot : undefined, points: 0, possible: 0, votes: 0 };
      entry.points += s.score * dir * sign;
      entry.possible += Math.abs(s.score);
      entry.votes += 1;
      totals.set(s.slug, entry);
    }
  }
  return [...totals.values()].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99) || b.votes - a.votes);
}

function IssueList({ issues }: { issues: IssueSummary[] }) {
  return (
    <ul className="issue-list">
      {issues.map((issue) => {
        const value = percent(issue);
        const color = issue.slot !== undefined ? SLOT_COLORS[issue.slot] : "#b9c6be";
        return (
          <li key={issue.category.slug} className="issue" style={{ "--slot": color } as React.CSSProperties}>
            <div className="issue__label">
              <span className="issue__name">{issue.category.name}</span>
              {issue.category.is_axis && issue.pick && (
                <span className="issue__side">
                  Your side: {issue.pick.dir === 1 ? issue.category.positive_means : issue.category.negative_means}
                </span>
              )}
            </div>
            <div className="issue__meter" aria-hidden="true">
              <span className="issue__zero" />
              <span
                className="issue__fill"
                data-against={value !== null && value < 0 ? true : undefined}
                style={{ "--amount": `${Math.abs(value ?? 0) / 2}%` } as React.CSSProperties}
              />
            </div>
            <Lamp value={value} votes={issue.votes} color={color} label={issue.category.name} />
            <span className="issue__votes">
              {issue.votes} {issue.votes === 1 ? "vote" : "votes"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
