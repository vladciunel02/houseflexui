import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { hhmm, simulate, type House, type Sim } from '../data/mockFleet';
import {
  clientSegments,
  comparisonLine,
  planBatteryRow,
  planGridRow,
  planSteps,
  priceSegments,
  type ClientBatteryAction,
  type ClientGridAction,
  type ClientSegment,
  type PlanStep,
  type PriceSegment,
} from '../data/derive';
import { useMinute } from '../state/time';
import { fmt } from './Num';
import {
  NOW_BADGE_H,
  PRICE_ROW_H,
  PriceRowSvg,
  START_H,
  END_H,
  NowLineAndTicks,
  hourToX,
} from './PriceRow';

interface Props {
  today: House;
  tomorrow: House;
  activeTodaySim: Sim;
  cloudStart: number | null;
}

const PLOT_LEFT = 148;
const BAT_H = 44;
const GRID_H = 40;

// "Fără HomeFlex" block (its own SVG so it can open and close with a height transition)
const CMP_CAPTION_Y = 22;
const CMP_BAT_Y = CMP_CAPTION_Y + 8;
const CMP_GRID_Y = CMP_BAT_Y + BAT_H + 8;
const CMP_H = CMP_GRID_Y + GRID_H;

// Hour ticks under all rows
const TICKS_Y = 20;
const TICKS_H = TICKS_Y + 8;

interface TooltipState {
  cx: number;
  top: number;
  interval: string;
  whatHappens: string;
  meta: string;
}

/** Hovered time span, and whether it came from a step or from a bar. */
interface Focus {
  start: number;
  end: number;
  from: 'step' | 'bar';
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-6;

const rangeOf = (start: number, end: number) => {
  const e = Math.round(end * 60);
  return `${hhmm(Math.round(start * 60))}–${e >= 1440 ? '24:00' : hhmm(e)}`;
};

function fmtPriceTag(v: number): string {
  return v > 0 ? `+${fmt(v, 2)}` : fmt(v, 2);
}

const ACTION_CLASS: Record<ClientBatteryAction, string> = {
  'încarcă din soare': 'act-charge',
  'folosește în casă': 'act-use',
  ține: 'act-hold',
  așteaptă: 'act-wait',
};

function batteryBandStyle(action: ClientBatteryAction): {
  fill: string;
  stroke: string;
  textFill: string;
} {
  switch (action) {
    case 'încarcă din soare':
      return { fill: 'var(--color-blue)', stroke: 'none', textFill: 'var(--color-on-dark)' };
    case 'folosește în casă':
      return { fill: 'var(--color-blue-tint)', stroke: 'none', textFill: 'var(--color-text)' };
    case 'ține':
      return { fill: 'var(--color-hairline)', stroke: 'none', textFill: 'var(--color-text)' };
    case 'așteaptă':
      return {
        fill: 'none',
        stroke: 'var(--color-hairline)',
        textFill: 'var(--color-text-secondary)',
      };
  }
}

function batteryBandLabel(seg: ClientSegment, bw: number): string | null {
  if (bw < 72) return null;
  switch (seg.battery) {
    case 'încarcă din soare':
      return bw >= 150 ? `Încarcă · ${seg.socStart} → ${seg.socEnd} %` : 'Încarcă';
    case 'folosește în casă':
      if (bw >= 176) return `Folosește · ${seg.socStart} → ${seg.socEnd} %`;
      return 'Folosește';
    case 'ține':
      return bw >= 114 ? `Ține · ${seg.socEnd} %` : 'Ține';
    case 'așteaptă':
      return 'Așteaptă';
  }
}

function gridBandStyle(action: ClientGridAction): {
  fill: string;
  stroke: string;
  textFill: string;
} | null {
  switch (action) {
    case 'vinde surplusul':
      return { fill: 'var(--color-grid-sell)', stroke: 'none', textFill: 'var(--color-text)' };
    case 'trimite fără plată':
      return {
        fill: 'var(--color-negative-18)',
        stroke: 'none',
        textFill: 'var(--negative-price-text)',
      };
    case 'cumpără':
      return {
        fill: 'none',
        stroke: 'var(--color-hairline)',
        textFill: 'var(--color-text-secondary)',
      };
    case 'nimic':
      return null;
  }
}

function gridBandLabel(seg: ClientSegment, bw: number): string | null {
  if (bw < 72) return null;
  switch (seg.grid) {
    case 'vinde surplusul':
      return bw >= 116 ? `Vinde · ${fmtPriceTag(seg.price)}` : fmtPriceTag(seg.price);
    case 'trimite fără plată':
      return bw >= 130 ? 'Trimite fără plată' : 'Fără plată';
    case 'cumpără':
      return bw >= 122 ? `Cumpără · ${fmt(seg.price, 2)}` : fmt(seg.price, 2);
    case 'nimic':
      return null;
  }
}

function describeBatteryTooltip(seg: ClientSegment): string {
  switch (seg.battery) {
    case 'încarcă din soare':
      return `Bateria se încarcă din soare (${seg.socStart} → ${seg.socEnd} %)`;
    case 'folosește în casă':
      return `Bateria acoperă consumul casei (${seg.socStart} → ${seg.socEnd} %)`;
    case 'ține':
      return `Bateria păstrează nivelul de ${seg.socEnd} %`;
    case 'așteaptă':
      return `Bateria așteaptă la ${seg.socEnd} %`;
  }
}

function describeGridTooltip(seg: ClientSegment): string {
  switch (seg.grid) {
    case 'vinde surplusul':
      return `Casa vinde surplusul la ${fmtPriceTag(seg.price)} lei/kWh`;
    case 'trimite fără plată':
      return `Surplus trimis fără plată (${fmt(seg.price, 2)} lei/kWh)`;
    case 'cumpără':
      return `Casa cumpără din rețea la ${fmt(seg.price, 2)} lei/kWh`;
    case 'nimic':
      return 'Fără schimb cu rețeaua';
  }
}

export function DaySchedule({ today, tomorrow, activeTodaySim, cloudStart }: Props) {
  const minute = useMinute();
  const [tab, setTab] = useState<'azi' | 'maine'>('azi');
  const [compare, setCompare] = useState(false);
  const [hover, setHover] = useState<TooltipState | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1120);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setW(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  // Clear tooltip and linking when switching tab or toggling comparison
  useEffect(() => {
    setHover(null);
    setFocus(null);
  }, [tab, compare]);

  const tomorrowLocked = tab === 'maine' && minute < 14 * 60;
  const day = tab === 'azi' ? today : tomorrow;
  const cloudForTab = tab === 'azi' ? cloudStart : null;

  const activeSim = useMemo(
    () => (tab === 'azi' ? activeTodaySim : simulate(tomorrow, 'homeflex', null)),
    [tab, activeTodaySim, tomorrow],
  );
  const standardSim = useMemo(
    () => simulate(day, 'standard', cloudForTab),
    [day, cloudForTab],
  );

  // Single source: bars, steps and comparison lines all come from these clientSegments outputs.
  const segs = useMemo(() => clientSegments(day, activeSim), [day, activeSim]);
  const stdSegs = useMemo(() => clientSegments(day, standardSim), [day, standardSim]);

  const pSegs = useMemo(() => priceSegments(day.prices), [day.prices]);
  const batBands = useMemo(() => planBatteryRow(segs), [segs]);
  const grdBands = useMemo(() => planGridRow(segs), [segs]);
  const stdBatBands = useMemo(() => planBatteryRow(stdSegs), [stdSegs]);
  const stdGrdBands = useMemo(() => planGridRow(stdSegs), [stdSegs]);

  const nowForSteps = tab === 'azi' ? minute : null;
  const steps = useMemo(() => planSteps(day, segs, nowForSteps), [day, segs, nowForSteps]);
  const cmpLines = useMemo(
    () => steps.map((st) => comparisonLine(day, st, stdSegs)),
    [day, steps, stdSegs],
  );

  const plotWidth = Math.max(280, w - PLOT_LEFT);
  const showNowLine = tab === 'azi';
  const badgeY = 0;
  const priceY = showNowLine ? NOW_BADGE_H + 6 : 4;
  const batY = priceY + PRICE_ROW_H + 10;
  const gridY = batY + BAT_H + 8;
  const mainH = gridY + GRID_H;
  const lineTopY = showNowLine ? badgeY + NOW_BADGE_H : priceY;
  const nowX = hourToX(minute / 60, PLOT_LEFT, plotWidth);

  const barDimmed = (seg: ClientSegment) =>
    focus != null && focus.from === 'step' && !overlaps(seg, focus);
  const stepDimmed = (st: PlanStep) =>
    focus != null && focus.from === 'bar' && !overlaps(st, focus);

  const clearHover = () => {
    setHover(null);
    setFocus(null);
  };

  const handlePriceHover = (seg: PriceSegment, cx: number, topY: number) => {
    setHover({
      cx,
      top: topY,
      interval: rangeOf(seg.start, seg.end),
      whatHappens:
        seg.price < 0
          ? `Preț negativ în rețea (${fmt(seg.price, 2)} lei/kWh)`
          : `Preț rețea ${fmt(seg.price, 2)} lei/kWh`,
      meta: '',
    });
  };

  /** `topOffset`: y of this SVG inside the timeline wrapper, for tooltip placement. */
  const renderBatteryRow = (
    bands: ClientSegment[],
    rowY: number,
    keyPrefix: string,
    linked: boolean,
    topOffset: number,
  ) => (
    <g>
      <text x={0} y={rowY + 26.5} className="row-left-title primary">
        Bateria
      </text>
      {bands.map((seg, idx) => {
        if (seg.end <= START_H || seg.start >= END_H) return null;
        const s0 = Math.max(START_H, seg.start);
        const s1 = Math.min(END_H, seg.end);
        const bx = hourToX(s0, PLOT_LEFT, plotWidth);
        const ex = hourToX(s1, PLOT_LEFT, plotWidth);
        const bw = Math.max(0, ex - bx);
        const st = batteryBandStyle(seg.battery);
        const label = batteryBandLabel(seg, bw);

        return (
          <g
            key={`${keyPrefix}-bat-${seg.start}-${idx}`}
            className={`plan-band ${linked && barDimmed(seg) ? 'is-dim' : ''}`}
            onMouseEnter={() => {
              setHover({
                cx: bx + bw / 2,
                top: topOffset + rowY,
                interval: rangeOf(seg.start, seg.end),
                whatHappens: describeBatteryTooltip(seg),
                meta: seg.batteryKWh >= 0.05 ? `${fmt(seg.batteryKWh, 1)} kWh` : '',
              });
              if (linked) setFocus({ start: seg.start, end: seg.end, from: 'bar' });
            }}
            onMouseLeave={clearHover}
          >
            <rect
              x={bx}
              y={rowY}
              width={bw}
              height={BAT_H}
              fill={st.fill === 'none' ? 'var(--color-page)' : st.fill}
              stroke={st.stroke}
              strokeWidth={1}
            />
            {label && (
              <text
                x={bx + bw / 2}
                y={rowY + 26.5}
                textAnchor="middle"
                fill={st.textFill}
                className="band-text tnum"
                pointerEvents="none"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );

  const renderGridRow = (
    bands: ClientSegment[],
    rowY: number,
    keyPrefix: string,
    linked: boolean,
    topOffset: number,
  ) => (
    <g>
      <text x={0} y={rowY + 24.5} className="row-left-title primary">
        Rețeaua
      </text>
      <line
        x1={PLOT_LEFT}
        x2={PLOT_LEFT + plotWidth}
        y1={rowY + GRID_H}
        y2={rowY + GRID_H}
        stroke="var(--color-hairline)"
        strokeWidth={1}
      />
      {bands.map((seg, idx) => {
        if (seg.end <= START_H || seg.start >= END_H) return null;
        const st = gridBandStyle(seg.grid);
        if (!st) return null; // "nimic" stays empty
        const s0 = Math.max(START_H, seg.start);
        const s1 = Math.min(END_H, seg.end);
        const bx = hourToX(s0, PLOT_LEFT, plotWidth);
        const ex = hourToX(s1, PLOT_LEFT, plotWidth);
        const bw = Math.max(0, ex - bx);
        const label = gridBandLabel(seg, bw);

        return (
          <g
            key={`${keyPrefix}-grd-${seg.start}-${idx}`}
            className={`plan-band ${linked && barDimmed(seg) ? 'is-dim' : ''}`}
            onMouseEnter={() => {
              setHover({
                cx: bx + bw / 2,
                top: topOffset + rowY,
                interval: rangeOf(seg.start, seg.end),
                whatHappens: describeGridTooltip(seg),
                meta: seg.gridKWh >= 0.05 ? `${fmt(seg.gridKWh, 1)} kWh` : '',
              });
              if (linked) setFocus({ start: seg.start, end: seg.end, from: 'bar' });
            }}
            onMouseLeave={clearHover}
          >
            <rect
              x={bx}
              y={rowY}
              width={bw}
              height={GRID_H}
              fill={st.fill === 'none' ? 'var(--color-page)' : st.fill}
              stroke={st.stroke}
              strokeWidth={1}
            />
            {label && (
              <text
                x={bx + bw / 2}
                y={rowY + 24.5}
                textAnchor="middle"
                fill={st.textFill}
                className="band-text tnum"
                pointerEvents="none"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );

  return (
    <section className="plan-section" aria-label="Planul bateriei">
      <div className="plan-header">
        <h2 className="section-title plan-title">Planul bateriei</h2>
        <div className="plan-tabs" role="tablist" aria-label="Ziua planului">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'azi'}
            className={`plan-tab ${tab === 'azi' ? 'active' : ''}`}
            onClick={() => setTab('azi')}
          >
            Azi
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'maine'}
            className={`plan-tab ${tab === 'maine' ? 'active' : ''}`}
            onClick={() => setTab('maine')}
          >
            Mâine
          </button>
        </div>
        {!tomorrowLocked && (
          <button
            type="button"
            className={`btn-secondary plan-compare-btn ${compare ? 'is-on' : ''}`}
            aria-expanded={compare}
            onClick={() => setCompare((c) => !c)}
          >
            {compare ? 'Ascunde comparația' : 'Compară cu bateria fără HomeFlex'}
          </button>
        )}
      </div>

      {tomorrowLocked ? (
        <p className="tomorrow-locked tnum">
          Planul pentru mâine apare la 14:00, după ce se publică prețurile.
        </p>
      ) : (
        <>
          {/* ---------- Desktop timeline (05:00–24:00) ---------- */}
          <div className="desktop-timeline" ref={wrapRef} onMouseLeave={clearHover}>
            <svg className="plan-svg" viewBox={`0 0 ${w} ${mainH}`}>
              <PriceRowSvg
                y={priceY}
                plotLeft={PLOT_LEFT}
                plotWidth={plotWidth}
                segments={pSegs}
                onHoverSeg={handlePriceHover}
                onLeaveSeg={() => setHover(null)}
              />
              {renderBatteryRow(batBands, batY, 'hf', true, 0)}
              {renderGridRow(grdBands, gridY, 'hf', true, 0)}
              <NowLineAndTicks
                minute={minute}
                showNowLine={showNowLine}
                showTicks={false}
                plotLeft={PLOT_LEFT}
                plotWidth={plotWidth}
                badgeY={badgeY}
                lineTopY={lineTopY}
                lineBottomY={mainH}
                ticksY={0}
              />
            </svg>

            <div className={`plan-collapse ${compare ? 'is-open' : ''}`} aria-hidden={!compare}>
              <div className="plan-collapse-inner">
                <svg className="plan-svg" viewBox={`0 0 ${w} ${CMP_H}`}>
                  <text x={0} y={CMP_CAPTION_Y} className="row-left-label">
                    Fără HomeFlex
                  </text>
                  <g opacity={0.55}>
                    {renderBatteryRow(stdBatBands, CMP_BAT_Y, 'std', false, mainH)}
                    {renderGridRow(stdGrdBands, CMP_GRID_Y, 'std', false, mainH)}
                  </g>
                  {showNowLine && (
                    <line
                      x1={nowX}
                      x2={nowX}
                      y1={0}
                      y2={CMP_H}
                      stroke="var(--color-text)"
                      strokeWidth={1.5}
                      pointerEvents="none"
                    />
                  )}
                </svg>
              </div>
            </div>

            <svg className="plan-svg" viewBox={`0 0 ${w} ${TICKS_H}`} aria-hidden="true">
              <NowLineAndTicks
                minute={minute}
                showNowLine={false}
                plotLeft={PLOT_LEFT}
                plotWidth={plotWidth}
                badgeY={0}
                lineTopY={0}
                lineBottomY={0}
                ticksY={TICKS_Y}
              />
            </svg>

            {hover && (
              <div
                className="schedule-tooltip"
                style={{
                  left: `${Math.min(Math.max(hover.cx, PLOT_LEFT + 130), w - 150)}px`,
                  top: `${Math.max(0, hover.top - 8)}px`,
                }}
                role="status"
              >
                <div className="schedule-tip-head tnum">
                  <strong>{hover.interval}</strong> · {hover.whatHappens}
                </div>
                {hover.meta && <div className="schedule-tip-meta tnum">{hover.meta}</div>}
              </div>
            )}
          </div>

          {/* ---------- "Pe scurt": vertical step timeline (the whole plan on mobile) ---------- */}
          <div className="steps-block">
            <h3 className="section-title">Pe scurt</h3>
            <ol className="steps">
              {steps.map((st, i) => {
                const cmp = cmpLines[i];
                const isLast = i === steps.length - 1;
                return (
                  <li
                    key={`${st.start}-${st.action}`}
                    className={[
                      'step',
                      `is-${st.state}`,
                      ACTION_CLASS[st.action],
                      stepDimmed(st) ? 'is-dim' : '',
                    ].join(' ')}
                    style={{ '--step-progress': st.progress } as CSSProperties}
                    aria-current={st.state === 'acum' ? 'step' : undefined}
                    onMouseEnter={() => setFocus({ start: st.start, end: st.end, from: 'step' })}
                    onMouseLeave={() => setFocus(null)}
                  >
                    {!isLast && (
                      <span className="step-rail" aria-hidden="true">
                        <span className="step-rail-fill" />
                      </span>
                    )}
                    <span className="step-node" aria-hidden="true" />
                    <span className="step-time tnum">{st.rangeLabel}</span>
                    <div className="step-body">
                      <p className="step-sentence">{st.sentence}</p>
                      {cmp && (
                        <div className={`step-cmp ${compare ? 'is-open' : ''}`} aria-hidden={!compare}>
                          <div className="step-cmp-inner">
                            <p className="step-cmp-text tnum">{cmp}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
