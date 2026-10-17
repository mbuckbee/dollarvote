import type { Metadata } from "next";
import { Public_Sans, Sofia_Sans_Extra_Condensed } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { Nav, NavLinks } from "@/components/Nav";
import "./globals.css";
import "./explorer.css";
import "./pages.css";

const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"], display: "swap" });
const stripFace = Sofia_Sans_Extra_Condensed({
  variable: "--font-strip-face",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: "dollarvote: who voted for what you care about", template: "%s · dollarvote" },
  description:
    "Pick the 5 issues you care about most and see which members of the 118th Congress voted to advance them, bill by bill.",
  openGraph: { siteName: "dollarvote", type: "website" },
};

const CONTRACT = `
THESIS: Every legislator is a lamp on the chamber tally board; your 5 interests decide which lamps light. Refuses the civic-dashboard default of checkbox filters, party-colored pills and a sortable table.
OWN-WORLD: Dark board face (#0b120e), backlit name strips in condensed caps (Sofia Sans Extra Condensed), Public Sans for reading, lamps that mean something: green votes your way, red against, amber present; each pick owns one slot color everywhere.
STORY: A voter marks up to 5 interests, picks a side on contested ones, watches the board re-sort, and opens a legislator or bill to see the votes behind every number.
FIRST VIEWPORT: Headline left, 24 selector keys filling the right two thirds; the 5-slot rail across the top of the board; ranked rows begin above the fold.
FORM: The Tally Board, assigned candidate 3 of 7, seed c8751d3b.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} ${stripFace.variable}`}>
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${CONTRACT}-->` }} />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="masthead">
          <div className="wrap masthead__inner">
            <Link href="/" className="wordmark" aria-label="dollarvote home">
              <span className="wordmark__lamps" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              dollarvote
            </Link>
            <Suspense fallback={<NavLinks pathname={null} />}>
              <Nav />
            </Suspense>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <div className="wrap footer__inner">
            <p>
              Covers the 118th Congress, January 2023 to January 2025: every bill that got a recorded vote, and how each
              member voted on it.
            </p>
            <p>
              Votes from <a href="https://voteview.com">Voteview</a>, bill records from{" "}
              <a href="https://www.govinfo.gov/bulkdata/BILLSTATUS">GovInfo</a>, member IDs from{" "}
              <a href="https://github.com/unitedstates/congress-legislators">congress-legislators</a>.
            </p>
            <p>
              Interest scores are judgments, each with a written reason. <Link href="/method">How scoring works</Link>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
