import { hhmm } from '../data/mockFleet';
import { type PriceSegment } from '../data/derive';
import { fmt } from './Num';

export const START_H = 5;
export const END_H = 24;
export const SPAN_H = END_H - START_H; // 19 hours (05:00 .. 24:00)
export const X_TICKS = [6, 9, 12, 15, 18, 21, 24] as const;
export const PRICE_ROW_H = 32;
export const NOW_BADGE_H = 20;

export function hourToX(h: number, plotLeft: number, plotWidth: number): number {
  const clamped = Math.min(END_H, Math.max(START_H, h));
  return plotLeft + ((clamped - START_H) / SPAN_H) * plotWidth;
}

export function PriceRowSvg({
  y,
  plotLeft,
  plotWidth,
  segments,
  onHoverSeg,
  onLeaveSeg,
}: {
  y: number;
  plotLeft: number;
  plotWidth: number;
  segments: PriceSegment[];
  onHoverSeg?: (seg: PriceSegment, cx: number, topY: number) => void;
  onLeaveSeg?: () => void;
}) {
  const maxPrice = Math.max(...segments.map((s) => s.price));

  return (
    <g aria-label="Preț energie pe intervale">
      <text x={0} y={y + 20.5} className="row-left-label">
        Preț, lei/kWh
      </text>

      {segments.map((seg, idx) => {
        if (seg.end <= START_H || seg.start >= END_H) return null;
        const s0 = Math.max(START_H, seg.start);
        const s1 = Math.min(END_H, seg.end);
        const sx = hourToX(s0, plotLeft, plotWidth);
        const ex = hourToX(s1, plotLeft, plotWidth);
        const sw = Math.max(0, ex - sx);
        const isNeg = seg.price < 0;
        const isMax = Math.abs(seg.price - maxPrice) < 1e-6;

        return (
          <g
            key={`${seg.start}-${idx}`}
            onMouseEnter={() => onHoverSeg?.(seg, sx + sw / 2, y)}
            onMouseLeave={() => onLeaveSeg?.()}
          >
            <rect
              x={sx}
              y={y}
              width={sw}
              height={PRICE_ROW_H}
              fill={isNeg ? 'var(--color-negative-18)' : 'var(--color-page)'}
              stroke={isNeg ? 'none' : 'var(--color-hairline)'}
              strokeWidth={1}
            />
            {sw >= 36 && (
              <text
                x={sx + sw / 2}
                y={y + 20.5}
                textAnchor="middle"
                className={`price-seg-text tnum ${isNeg ? 'neg' : ''} ${isMax ? 'max' : ''}`}
              >
                {fmt(seg.price, 2)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function NowLineAndTicks({
  minute,
  showNowLine,
  plotLeft,
  plotWidth,
  badgeY,
  lineTopY,
  lineBottomY,
  ticksY,
  showTicks = true,
}: {
  minute: number;
  showNowLine: boolean;
  plotLeft: number;
  plotWidth: number;
  badgeY: number;
  lineTopY: number;
  lineBottomY: number;
  ticksY: number;
  showTicks?: boolean;
}) {
  const sx = hourToX(minute / 60, plotLeft, plotWidth);
  const pillW = 50;
  const pillX = Math.min(Math.max(sx - pillW / 2, plotLeft), plotLeft + plotWidth - pillW);

  return (
    <g pointerEvents="none">
      {showTicks && X_TICKS.map((h) => {
        const tx = hourToX(h, plotLeft, plotWidth);
        return (
          <text
            key={h}
            x={tx}
            y={ticksY}
            textAnchor={h === 24 ? 'end' : 'middle'}
            className="axis-label tnum"
          >
            {String(h).padStart(2, '0')}
          </text>
        );
      })}

      {showNowLine && (
        <>
          <line
            x1={sx}
            x2={sx}
            y1={lineTopY}
            y2={lineBottomY}
            stroke="var(--color-text)"
            strokeWidth={1.5}
          />
          <rect
            x={pillX}
            y={badgeY}
            width={pillW}
            height={NOW_BADGE_H}
            rx={4}
            ry={4}
            fill="var(--color-dark-block)"
          />
          <text
            x={pillX + pillW / 2}
            y={badgeY + 14.5}
            textAnchor="middle"
            className="scrub-time tnum"
          >
            {hhmm(minute)}
          </text>
        </>
      )}
    </g>
  );
}
