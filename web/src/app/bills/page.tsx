import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { BillsBrowser } from "@/components/BillsBrowser";
import { getBills, getCategories } from "@/lib/data";

export const metadata: Metadata = {
  title: "Bills",
  description: "Every 118th Congress bill that got a recorded vote, with how each scored bill moves 24 voter issues.",
};

export default function BillsPage() {
  return (
    <div className="wrap">
      <header className="page-head">
        <h1>Every bill that reached a recorded vote</h1>
        <p>
          Scored bills come first. Each score is a judgment from −2 to +2 on one issue, with a one-line reason you can
          read on the bill’s page.
        </p>
      </header>
      <Suspense fallback={<div className="skeleton" style={{ height: "30rem" }} />}>
        <Bills />
      </Suspense>
    </div>
  );
}

async function Bills() {
  await connection();
  const [bills, categories] = await Promise.all([getBills(), getCategories()]);
  return <BillsBrowser bills={bills} categories={categories} />;
}
