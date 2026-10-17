import { signed } from "@/lib/format";

type Props = {
  value: number | null; // -100..100
  votes: number;
  label: string;
  color?: string; // a pick's slot color as hex; omitted for the overall lamp, which lights green or red
  overall?: boolean;
};

const YEA = "#3ddc84";
const NAY = "#ff5d4d";
const SUNK = "#070b09";
const DARK_TEXT = "#07100b";
const LIGHT_TEXT = "#e8eee9";

// A board lamp. Lit and brighter the more a member's votes moved the issue your way; hatched when they
// moved it against you. The signed number always carries the meaning, so color is never the only cue.
export function Lamp({ value, votes, label, color, overall }: Props) {
  const description =
    value === null ? `${label}: no scored votes` : `${label}: ${signed(value)} from ${votes} ${votes === 1 ? "vote" : "votes"}`;

  if (value === null) {
    return (
      <span className="lamp lamp--none" role="img" aria-label={description}>
        none
      </span>
    );
  }

  const hue = overall ? (value >= 0 ? YEA : NAY) : (color ?? YEA);

  if (value < 0 && !overall) {
    return (
      <span className="lamp lamp--against" role="img" aria-label={description} style={{ "--lamp-edge": hue } as React.CSSProperties}>
        {signed(value)}
      </span>
    );
  }

  const strength = Math.abs(value) / 100;
  const { background, text } = litColors(hue, 22 + 70 * strength);
  return (
    <span
      className="lamp lamp--lit"
      role="img"
      aria-label={description}
      style={{
        background,
        color: text,
        "--glow": `color-mix(in srgb, ${hue} ${Math.round(60 * strength)}%, transparent)`,
      } as React.CSSProperties}
    >
      {signed(value)}
    </span>
  );
}

// Mix the lamp color into the board, then pick dark or light text. Mid-brightness mixes can fail AA with
// both, so nudge the mix toward whichever end is closer until the number reads at 4.5:1.
function litColors(hue: string, mix: number) {
  let m = Math.round(mix);
  const step = m >= 55 ? 2 : -2;
  for (;;) {
    const background = blend(hue, SUNK, m / 100);
    const dark = contrast(background, DARK_TEXT);
    const light = contrast(background, LIGHT_TEXT);
    if (Math.max(dark, light) >= 4.5 || m <= 10 || m >= 100) {
      return { background, text: dark >= light ? DARK_TEXT : LIGHT_TEXT };
    }
    m += step;
  }
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const mixChannel = (x: number, y: number) => Math.round(x * t + y * (1 - t)).toString(16).padStart(2, "0");
  return `#${mixChannel(ar, br)}${mixChannel(ag, bg)}${mixChannel(ab, bb)}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
