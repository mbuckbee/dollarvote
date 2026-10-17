"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import type { BoardRow, Category, Coverage } from "@/lib/data";
import { MAX_PICKS, SLOT_COLORS, picksQuery, type Pick } from "@/lib/picks";
import { SHORT_NAMES, displayName, percent, rankKey, seat, surname } from "@/lib/format";
import { AxisIcon, CloseIcon, DownIcon, UpIcon } from "./Icons";
import { Lamp } from "./Lamp";

gsap.registerPlugin(Flip);

const PAGE = 50;
type Chamber = "both" | "House" | "Senate";

type Props = { categories: Category[]; coverage: Coverage; initialPicks: Pick[]; initialRows: BoardRow[] };

export function Explorer({ categories, coverage, initialPicks, initialRows }: Props) {
  const [picks, setPicks] = useState(initialPicks);
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [chamber, setChamber] = useState<Chamber>("both");
  const [state, setState] = useState("");
  const [showAll, setShowAll] = useState(false);

  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories]);
  const boardRef = useRef<HTMLOListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const previousRanks = useRef<Map<string, number>>(new Map());
  const [moves, setMoves] = useState<Map<string, number>>(new Map());
  const sideRef = useRef<HTMLButtonElement>(null);
  const requestId = useRef(0);

  const states = useMemo(() => [...new Set(initialRows.map((r) => r.state))].sort(), [initialRows]);

  const ranked = useMemo(() => {
    const visible = rows.filter((r) => (chamber === "both" || r.chamber === chamber) && (!state || r.state === state));
    if (!picks.length) return visible;
    return [...visible].sort((a, b) => rankKey(b.overall) - rankKey(a.overall) || a.name.localeCompare(b.name));
  }, [rows, chamber, state, picks.length]);

  const shown = showAll ? ranked : ranked.slice(0, PAGE);

  async function commit(next: Pick[]) {
    setPicks(next);
    setNotice("");
    window.history.replaceState(null, "", `/${picksQuery(next)}`);
    const id = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/board${picksQuery(next)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data: { rows: BoardRow[] } = await response.json();
      if (id !== requestId.current) return;
      previousRanks.current = rankMap(ranked);
      if (boardRef.current) flipState.current = Flip.getState(boardRef.current.querySelectorAll(".row"));
      setRows(data.rows);
    } catch {
      if (id === requestId.current) setNotice("The board didn't load. Check your connection and pick again.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function press(category: Category) {
    setNotice("");
    if (picks.some((p) => p.slug === category.slug)) {
      commit(picks.filter((p) => p.slug !== category.slug));
      return;
    }
    if (picks.length >= MAX_PICKS) {
      setNotice(`All ${MAX_PICKS} slots are full. Remove one to add ${category.name}.`);
      return;
    }
    if (category.is_axis) {
      setPending(category.slug);
      return;
    }
    setPending(null);
    commit([...picks, { slug: category.slug, dir: 1 }]);
  }

  function chooseSide(dir: 1 | -1) {
    if (!pending) return;
    const next = [...picks, { slug: pending, dir }];
    setPending(null);
    commit(next);
  }

  useEffect(() => {
    if (pending) sideRef.current?.focus();
  }, [pending]);

  // Re-sort in place: each row slides from its old slot, lamps light in a short cascade.
  useLayoutEffect(() => {
    const state = flipState.current;
    if (!state || !boardRef.current) return;
    flipState.current = null;
    const nextRanks = rankMap(ranked);
    const moved = new Map<string, number>();
    nextRanks.forEach((rank, key) => {
      const before = previousRanks.current.get(key);
      if (before !== undefined && before !== rank) moved.set(key, before - rank);
    });
    setMoves(moved);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    Flip.from(state, {
      targets: boardRef.current.querySelectorAll(".row"),
      duration: 0.75,
      ease: "expo.out",
      stagger: { amount: 0.25, from: "start" },
      onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.4 }),
    });
    gsap.fromTo(
      boardRef.current.querySelectorAll(".row:nth-child(-n+30) .lamp"),
      { opacity: 0.15 },
      { opacity: 1, duration: 0.35, ease: "power2.out", stagger: 0.012 },
    );
    // `ranked` changes with every rows update; only rerun when a Flip state is waiting.
  }, [ranked]);

  const pendingCategory = pending ? bySlug.get(pending) : undefined;
  const pickedCount = picks.length;

  return (
    <div className="wrap explorer">
      <section className="intro" aria-labelledby="intro-title">
        <h1 id="intro-title" className="intro__title">
          Pick 5 issues. See who voted for them.
        </h1>
        <p className="intro__lede">
          Every bill below got a recorded vote in the 118th Congress and is scored for how it moves each issue. Light up
          the issues you care about and the board ranks all {initialRows.length} members by how they voted.
        </p>
        <p className="intro__coverage">
          <span className="intro__coverage-lamp" aria-hidden="true" />
          {coverage.scored} of {coverage.scorable} voted bills are scored so far.{" "}
          <Link href="/method">How scoring works</Link>
        </p>
      </section>

      <section className="picker" aria-labelledby="picker-title">
        <h2 id="picker-title" className="visually-hidden">
          Choose up to {MAX_PICKS} issues
        </h2>
        <div className="keypad" role="group" aria-label="Issues">
          {categories.map((category) => {
            const slot = picks.findIndex((p) => p.slug === category.slug);
            const selected = slot >= 0;
            const unscored = category.scored_bills === 0;
            return (
              <button
                key={category.slug}
                type="button"
                className="key"
                data-selected={selected || undefined}
                data-pending={pending === category.slug || undefined}
                aria-pressed={selected}
                disabled={unscored && !selected}
                onClick={() => press(category)}
                style={selected ? ({ "--slot": SLOT_COLORS[slot] } as React.CSSProperties) : undefined}
              >
                <span className="key__name">{category.name}</span>
                <span className="key__meta">
                  {category.is_axis && <AxisIcon size={14} />}
                  {unscored
                    ? "No scored bills yet"
                    : selected && category.is_axis
                      ? sideLabel(category, picks[slot].dir)
                      : `${category.scored_bills} scored ${category.scored_bills === 1 ? "bill" : "bills"}`}
                </span>
                {selected && (
                  <span className="key__slot" aria-hidden="true">
                    {slot + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {pendingCategory && (
          <div className="side-picker" role="group" aria-labelledby="side-title">
            <p id="side-title" className="side-picker__title">
              <AxisIcon size={18} />
              {pendingCategory.name} has no right answer built in. Which way do you want policy to move?
            </p>
            <div className="side-picker__options">
              <button ref={sideRef} type="button" className="button side-picker__option" onClick={() => chooseSide(1)}>
                {pendingCategory.positive_means}
              </button>
              <button type="button" className="button side-picker__option" onClick={() => chooseSide(-1)}>
                {pendingCategory.negative_means}
              </button>
              <button type="button" className="side-picker__cancel" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <p className="picker__notice" role="status" aria-live="polite">
          {notice}
        </p>
      </section>

      <section className="board" aria-labelledby="board-title" aria-busy={loading}>
        <div className="rail" role="list" aria-label="Your issues">
          {Array.from({ length: MAX_PICKS }, (_, n) => {
            const pick = picks[n];
            const category = pick && bySlug.get(pick.slug);
            return (
              <div
                key={n}
                role="listitem"
                className="rail__slot"
                data-filled={category ? true : undefined}
                style={{ "--slot": SLOT_COLORS[n] } as React.CSSProperties}
              >
                {category ? (
                  <>
                    <span className="rail__name">{category.name}</span>
                    {category.is_axis && <span className="rail__side">{sideLabel(category, pick.dir)}</span>}
                    <button
                      type="button"
                      className="rail__remove"
                      aria-label={`Remove ${category.name}`}
                      onClick={() => commit(picks.filter((p) => p.slug !== pick.slug))}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </>
                ) : (
                  <span className="rail__empty">Slot {n + 1} open</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="board__bar">
          <h2 id="board-title" className="board__title">
            {pickedCount ? "Who voted for your issues" : "The full board"}
            <span className="board__count">
              {ranked.length} {ranked.length === 1 ? "member" : "members"}
            </span>
          </h2>
          <div className="board__filters">
            <div className="segmented" role="group" aria-label="Chamber">
              {(["both", "House", "Senate"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={chamber === value} onClick={() => setChamber(value)}>
                  {value === "both" ? "Both" : value}
                </button>
              ))}
            </div>
            <label className="select">
              <span className="visually-hidden">State</span>
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {pickedCount > 0 && (
              <button type="button" className="board__clear" onClick={() => commit([])}>
                Clear issues
              </button>
            )}
          </div>
        </div>

        {!pickedCount && (
          <p className="board__hint">Pick an issue above to light the board. Until then, members are listed A to Z.</p>
        )}

        <div className="board__head" aria-hidden="true" style={{ "--picks": Math.max(pickedCount, 1) } as React.CSSProperties}>
          <span>#</span>
          <span>Member</span>
          <span className="board__head-picks">
            {picks.map((p, n) => (
              <span key={p.slug} style={{ color: SLOT_COLORS[n] }}>
                {SHORT_NAMES[p.slug] ?? bySlug.get(p.slug)?.name}
              </span>
            ))}
          </span>
          <span>Your way</span>
        </div>

        <ol ref={boardRef} className="board__rows" style={{ "--picks": Math.max(pickedCount, 1) } as React.CSSProperties}>
          {shown.map((row, index) => {
            const key = `${row.chamber}:${row.icpsr}`;
            const move = moves.get(key);
            const overall = percent(row.overall);
            return (
              <li
                key={key}
                className="row"
                data-flip-id={key}
                data-tier={pickedCount && row.overall && row.overall.points > 0 ? (index < 10 ? "lead" : index < 50 ? "field" : "tail") : "tail"}
              >
                <span className="row__rank">{pickedCount && row.overall ? index + 1 : ""}</span>
                <span className="row__member">
                  <Link href={`/legislator/${row.bioguide_id}${picksQuery(picks)}`} className="row__name strip-type">
                    {surname(row.name)}
                    <span className="visually-hidden">, {displayName(row.name)}</span>
                  </Link>
                  <span className="row__seat">
                    {displayName(row.name).split(" ")[0]} · {seat(row)}
                  </span>
                </span>
                <span className="row__picks">
                  {picks.map((p, n) => (
                    <Lamp
                      key={p.slug}
                      value={percent(row.byPick[n])}
                      votes={row.byPick[n]?.votes ?? 0}
                      color={SLOT_COLORS[n]}
                      label={bySlug.get(p.slug)!.name}
                    />
                  ))}
                </span>
                <span className="row__overall">
                  {pickedCount > 0 && (
                    <>
                      <Lamp value={overall} votes={row.overall?.votes ?? 0} overall label="All your issues" />
                      <span className="row__votes">
                        {row.overall ? `${row.overall.votes} ${row.overall.votes === 1 ? "vote" : "votes"}` : "no scored votes"}
                      </span>
                    </>
                  )}
                  {move ? (
                    <span className="row__move" data-dir={move > 0 ? "up" : "down"}>
                      {move > 0 ? <UpIcon size={14} /> : <DownIcon size={14} />}
                      <span className="visually-hidden">{move > 0 ? "up" : "down"}</span>
                      {Math.abs(move)}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>

        {ranked.length > PAGE && (
          <div className="board__more">
            <button type="button" className="button" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `Show the top ${PAGE}` : `Show all ${ranked.length} members`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function sideLabel(category: Category, dir: 1 | -1): string {
  return dir === 1 ? category.positive_means : category.negative_means;
}

function rankMap(rows: BoardRow[]): Map<string, number> {
  return new Map(rows.map((r, n) => [`${r.chamber}:${r.icpsr}`, n]));
}
