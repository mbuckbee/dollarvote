import type { BillScore } from "@/lib/data";
import { signed } from "@/lib/format";

// One bill's effect on one issue. Axis issues stay neutral grey: the sign is a direction, not a verdict.
// When the issue is one of the visitor's picks, the chip wears that pick's slot color and number.
export function ScoreChip({ score, slot, slotColor }: { score: BillScore; slot?: number; slotColor?: string }) {
  const tone = score.is_axis ? "axis" : score.score > 0 ? "up" : score.score < 0 ? "down" : "mixed";
  return (
    <span
      className={`chip chip--${tone}`}
      title={score.rationale}
      data-picked={slotColor ? true : undefined}
      style={slotColor ? ({ "--slot": slotColor } as React.CSSProperties) : undefined}
    >
      <span className="chip__score">{signed(score.score)}</span>
      {score.name}
      {slot !== undefined && (
        <span className="chip__slot" aria-label={`your issue ${slot + 1}`}>
          {slot + 1}
        </span>
      )}
    </span>
  );
}
