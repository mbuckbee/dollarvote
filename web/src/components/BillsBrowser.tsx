"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { BillRow, Category } from "@/lib/data";
import { billLabel, formatDate } from "@/lib/format";
import { SearchIcon } from "./Icons";
import { ScoreChip } from "./ScoreChip";

const PAGE = 60;

export function BillsBrowser({ bills, categories }: { bills: BillRow[]; categories: Category[] }) {
  const [search, setSearch] = useState("");
  const [issue, setIssue] = useState("");
  const [scoredOnly, setScoredOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const term = useDeferredValue(search.trim().toLowerCase());

  const filtered = useMemo(
    () =>
      bills.filter(
        (b) =>
          (!scoredOnly || b.scores.length > 0) &&
          (!issue || b.scores.some((s) => s.slug === issue)) &&
          (!term || b.title.toLowerCase().includes(term) || billLabel(b.bill_id).toLowerCase().replace(/\s/g, "").includes(term.replace(/\s/g, ""))),
      ),
    [bills, scoredOnly, issue, term],
  );
  const scoredCount = bills.filter((b) => b.scores.length).length;

  return (
    <div className="bills">
      <div className="bills__filters">
        <label className="search">
          <SearchIcon size={18} />
          <span className="visually-hidden">Search bills</span>
          <input
            type="search"
            placeholder="Search by title or number, like H.R. 82"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
        <label className="select">
          <span className="visually-hidden">Issue</span>
          <select
            value={issue}
            onChange={(e) => {
              setIssue(e.target.value);
              setLimit(PAGE);
            }}
          >
            <option value="">Any issue</option>
            {categories
              .filter((c) => c.scored_bills > 0)
              .map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name} ({c.scored_bills})
                </option>
              ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Scoring">
          <button type="button" aria-pressed={!scoredOnly} onClick={() => setScoredOnly(false)}>
            All {bills.length}
          </button>
          <button type="button" aria-pressed={scoredOnly} onClick={() => setScoredOnly(true)}>
            Scored {scoredCount}
          </button>
        </div>
      </div>

      <p className="bills__count" role="status" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "bill" : "bills"}
      </p>

      {filtered.length ? (
        <ol className="bill-list">
          {filtered.slice(0, limit).map((b) => (
            <li key={b.bill_id} className="bill-row" data-scored={b.scores.length > 0 || undefined}>
              <span className="bill-row__label strip-type">{billLabel(b.bill_id)}</span>
              <div className="bill-row__body">
                <Link href={`/bill/${b.bill_id}`} className="bill-row__title">
                  {b.title}
                </Link>
                <p className="bill-row__meta">
                  {b.law_number ? `Became Public Law ${b.law_number}` : "Did not become law"}
                  {b.latest_action_date && <> · last action {formatDate(b.latest_action_date)}</>}
                  {b.policy_area && <> · {b.policy_area}</>}
                </p>
                {b.scores.length > 0 ? (
                  <div className="chips">
                    {b.scores.map((s) => (
                      <ScoreChip key={s.slug} score={s} />
                    ))}
                  </div>
                ) : (
                  <p className="bill-row__unscored">Not scored yet</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">No bills match. Try a shorter search or a different issue.</p>
      )}

      {filtered.length > limit && (
        <div className="board__more">
          <button type="button" className="button" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - limit)} more
          </button>
        </div>
      )}
    </div>
  );
}
