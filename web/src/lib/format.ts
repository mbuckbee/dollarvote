import type { Alignment, Legislator } from "./data";

// Voteview names read "LAST, First Middle"; the board strip shows the surname, pages show the full name.
export function surname(name: string): string {
  return name.split(",")[0].trim();
}

export function displayName(name: string): string {
  const [last, rest] = name.split(",").map((part) => part.trim());
  if (!rest) return titleCase(last);
  const first = rest.replace(/\(([^)]+)\)/, "").split(/\s+/).filter(Boolean);
  const nickname = rest.match(/\(([^)]+)\)/)?.[1];
  return `${nickname ?? first[0]} ${titleCase(last)}`.replace(/\s+/g, " ").trim();
}

function titleCase(word: string): string {
  return word.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase()).replace(/^Mc(\p{L})/u, (_, ch) => `Mc${ch.toUpperCase()}`);
}

export function seat(l: Pick<Legislator, "chamber" | "state" | "district" | "party">): string {
  const where = l.chamber === "Senate" ? `${l.state} senator` : l.district ? `${l.state}-${l.district}` : `${l.state} at-large`;
  return `${l.party} · ${where}`;
}

export const PARTY_NAMES = { D: "Democrat", R: "Republican", I: "Independent" } as const;

// -100..100, rounded.
export function percent(a: Alignment | null): number | null {
  return a && a.possible > 0 ? Math.round((100 * a.points) / a.possible) : null;
}

// Ranking shrinks thin records toward zero so a short record can't top the board: 16 points ≈ eight strong votes.
export const SHRINK = 16;
export function rankKey(a: Alignment | null): number {
  return a ? a.points / (a.possible + SHRINK) : -Infinity;
}

export function signed(n: number): string {
  const abs = Math.abs(n);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : "0";
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function billLabel(billId: string): string {
  const match = billId.match(/^([A-Z]+)(\d+)$/);
  if (!match) return billId;
  const names: Record<string, string> = {
    HR: "H.R.", S: "S.", HJRES: "H.J.Res.", SJRES: "S.J.Res.", HCONRES: "H.Con.Res.", SCONRES: "S.Con.Res.", HRES: "H.Res.", SRES: "S.Res.",
  };
  return `${names[match[1]] ?? match[1]} ${match[2]}`;
}

// Column headers on the board, where full category names don't fit.
export const SHORT_NAMES: Record<string, string> = {
  cost_of_living: "Costs", personal_taxes: "Taxes", workers_wages: "Workers", small_business: "Small biz",
  health_care: "Health", seniors_retirement: "Seniors", education: "Schools", housing: "Housing",
  public_safety: "Safety", firearms: "Guns", immigration: "Immigration", reproductive_health: "Abortion",
  environment_climate: "Environment", national_security: "Defense", veterans: "Veterans",
  privacy_civil_liberties: "Privacy", civil_rights: "Civil rights", deficit_spending: "Deficit",
  rural_agriculture: "Rural", elections_accountability: "Elections", energy: "Energy",
  infrastructure: "Transport", consumer_protection: "Consumers", ai_tech: "AI & tech",
};
