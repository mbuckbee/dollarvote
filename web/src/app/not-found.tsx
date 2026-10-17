import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap lost">
      <p className="lost__board strip-type" aria-hidden="true">
        <span>Vote</span>
        <span className="lost__lamp" />
        <span>Not found</span>
      </p>
      <h1>This page never came to a vote.</h1>
      <p>The link may be old, or the member or bill isn’t part of the 118th Congress records here.</p>
      <div className="lost__actions">
        <Link href="/" className="button">
          Back to the board
        </Link>
        <Link href="/bills" className="button">
          Browse bills
        </Link>
      </div>
    </div>
  );
}
