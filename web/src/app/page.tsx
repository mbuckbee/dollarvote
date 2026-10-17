import { Suspense } from "react";
import { connection } from "next/server";
import { Explorer } from "@/components/Explorer";
import { getBoard, getCategories, getCoverage } from "@/lib/data";
import { parsePicks } from "@/lib/picks";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<BoardFallback />}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

async function Board({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const [{ i }, categories, coverage] = await Promise.all([searchParams, getCategories(), getCoverage()]);
  const picks = parsePicks(
    i,
    new Set(categories.map((c) => c.slug)),
    new Set(categories.filter((c) => c.is_axis).map((c) => c.slug)),
  );
  const rows = await getBoard(picks, categories);
  return <Explorer categories={categories} coverage={coverage} initialPicks={picks} initialRows={rows} />;
}

function BoardFallback() {
  return (
    <div className="wrap explorer" aria-busy="true">
      <section className="intro">
        <p className="intro__title">Pick 5 issues. See who voted for them.</p>
        <p className="intro__lede">Loading the board…</p>
      </section>
      <div className="keypad">
        {Array.from({ length: 24 }, (_, n) => (
          <div key={n} className="key skeleton" style={{ minHeight: "4.5rem" }} />
        ))}
      </div>
    </div>
  );
}
