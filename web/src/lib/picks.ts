// A visitor's chosen interests, carried in the URL as ?i=environment_climate,immigration-,veterans
// A trailing "-" on an axis category means the visitor favors its negative direction.

export const MAX_PICKS = 5;

// One lamp color per pick slot, used on every screen so an interest keeps its color everywhere.
export const SLOT_COLORS = ["#4fd6ff", "#8aa4ff", "#c38bff", "#ff78d8", "#45e0c8"] as const;

export type Pick = { slug: string; dir: 1 | -1 };

export function parsePicks(raw: string | string[] | undefined, validSlugs: Set<string>, axisSlugs: Set<string>): Pick[] {
  const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const picks: Pick[] = [];
  for (const token of value.split(",")) {
    const negative = token.endsWith("-");
    const slug = negative ? token.slice(0, -1) : token;
    if (!validSlugs.has(slug) || picks.some((p) => p.slug === slug)) continue;
    picks.push({ slug, dir: negative && axisSlugs.has(slug) ? -1 : 1 });
    if (picks.length === MAX_PICKS) break;
  }
  return picks;
}

export function serializePicks(picks: Pick[]): string {
  return picks.map((p) => (p.dir === -1 ? `${p.slug}-` : p.slug)).join(",");
}

export function picksQuery(picks: Pick[]): string {
  return picks.length ? `?i=${serializePicks(picks)}` : "";
}
