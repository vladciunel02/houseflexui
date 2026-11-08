import {
  DT,
  INTERVALS,
  RESERVE,
  hhmm,
  simulate,
  type House,
  type Sim,
  type StrategyMode,
} from './mockFleet';

export interface PriceSegment {
  start: number; // hour (0..24)
  end: number; // hour (0..24)
  price: number; // lei/kWh
}

export type ClientBatteryAction =
  | 'încarcă din soare'
  | 'ține'
  | 'folosește în casă'
  | 'așteaptă';

export type ClientGridAction =
  | 'vinde surplusul'
  | 'trimite fără plată'
  | 'cumpără'
  | 'nimic';

export interface ClientSegment {
  start: number; // hour (0..24)
  end: number; // hour (0..24)
  battery: ClientBatteryAction;
  grid: ClientGridAction;
  kWh: number;
  price: number; // representative lei/kWh for this segment
  lei: number; // signed lei impact (+earned / avoided import, −spent, 0 unpaid/idle)
  socStart: number; // % (0..100)
  socEnd: number; // % (0..100)
  batteryKWh: number;
  gridKWh: number;
  batteryLei: number;
  gridLei: number;
}

export interface SavingsBreakdown {
  totalLei: number;
  dinVanzareaSurplusuluiDimineata: number;
  dinConsumulAcoperitSeara: number;
}

export type PlanStepState = 'trecut' | 'acum' | 'viitor';

/** One "Pe scurt" step. Always equals one "Bateria" bar of `planBatteryRow` on the same segments. */
export interface PlanStep {
  start: number; // hour (0..24), a "Bateria" bar boundary
  end: number; // hour (0..24), a "Bateria" bar boundary
  rangeLabel: string; // "11:00–14:10"
  action: ClientBatteryAction;
  sentence: string;
  state: PlanStepState;
  progress: number; // 0..1 inside "acum"; 1 for "trecut", 0 for "viitor"
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Merges consecutive intervals with the same electricity price into {start, end, price}. */
export function priceSegments(prices: number[]): PriceSegment[] {
  const out: PriceSegment[] = [];
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const start = i * DT;
    const end = (i + 1) * DT;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.price - p) < 1e-6) {
      prev.end = end;
    } else {
      out.push({ start, end, price: p });
    }
  }
  return out;
}

/**
 * Runs HomeFlex until `fromTime` (in minutes 0..1440), then switches to
 * ordinary "Fără HomeFlex" behaviour until 24:00.
 */
export function cancelledStrategy(
  day: House,
  fromTime: number,
  cloudStartMin: number | null = null,
): Sim {
  return simulate(day, 'homeflex', cloudStartMin, fromTime);
}

/**
 * Total lei gained vs "Fără HomeFlex", split into:
 * - "din vânzarea surplusului dimineața" (daytime surplus export difference, 00:00–15:00)
 * - "din consumul acoperit seara" (afternoon/evening import avoided difference, 15:00–24:00)
 */
export function savingsBreakdown(
  day: House,
  activeSim?: Sim,
  cloudStartMin: number | null = null,
): SavingsBreakdown {
  const withSim = activeSim ?? simulate(day, 'homeflex', cloudStartMin);
  const withoutSim = simulate(day, 'standard', cloudStartMin);

  let morningRaw = 0;
  let eveningRaw = 0;

  for (let i = 0; i < INTERVALS; i++) {
    const diff = withSim.netLei[i] - withoutSim.netLei[i];
    if (i * DT < 15) {
      morningRaw += diff;
    } else {
      eveningRaw += diff;
    }
  }

  const dinVanzareaSurplusuluiDimineata = round2(morningRaw);
  const dinConsumulAcoperitSeara = round2(eveningRaw);
  const totalLei = round2(dinVanzareaSurplusuluiDimineata + dinConsumulAcoperitSeara);

  return {
    totalLei,
    dinVanzareaSurplusuluiDimineata,
    dinConsumulAcoperitSeara,
  };
}

interface RawIntervalSeg {
  start: number;
  end: number;
  battery: ClientBatteryAction;
  grid: ClientGridAction;
  socStartKwh: number;
  socEndKwh: number;
  chargeKWh: number;
  dischargeKWh: number;
  exportKWh: number;
  importKWh: number;
  gridLei: number;
  avoidedImportLei: number;
  priceWeightedSum: number;
  durSum: number;
}

function classifyInterval(day: House, sim: Sim, i: number): {
  battery: ClientBatteryAction;
  grid: ClientGridAction;
} {
  const ch = sim.charge[i];
  const dis = sim.discharge[i];
  const exp = sim.exp[i];
  const imp = sim.imp[i];
  const soc = sim.soc[i];
  const p = sim.prices[i];
  const h = i * DT;
  const minReserve = day.batteryKwh * RESERVE;

  let battery: ClientBatteryAction;
  if (ch > 0.02) {
    battery = 'încarcă din soare';
  } else if (dis > 0.02) {
    battery = 'folosește în casă';
  } else if (soc >= day.batteryKwh - 0.08) {
    battery = 'ține';
  } else if (soc > minReserve + 0.08 && (exp > 0.04 || (h >= 7.5 && h < 18))) {
    battery = 'ține';
  } else {
    battery = 'așteaptă';
  }

  let grid: ClientGridAction;
  if (exp > 0.04) {
    grid = p < 0 ? 'trimite fără plată' : 'vinde surplusul';
  } else if (imp > 0.04) {
    grid = 'cumpără';
  } else {
    grid = 'nimic';
  }

  return { battery, grid };
}

function mergeRaw(
  a: RawIntervalSeg,
  b: RawIntervalSeg,
  keepBattery: ClientBatteryAction,
  keepGrid: ClientGridAction,
): RawIntervalSeg {
  return {
    start: a.start,
    end: b.end,
    battery: keepBattery,
    grid: keepGrid,
    socStartKwh: a.socStartKwh,
    socEndKwh: b.socEndKwh,
    chargeKWh: a.chargeKWh + b.chargeKWh,
    dischargeKWh: a.dischargeKWh + b.dischargeKWh,
    exportKWh: a.exportKWh + b.exportKWh,
    importKWh: a.importKWh + b.importKWh,
    gridLei: a.gridLei + b.gridLei,
    avoidedImportLei: a.avoidedImportLei + b.avoidedImportLei,
    priceWeightedSum: a.priceWeightedSum + b.priceWeightedSum,
    durSum: a.durSum + b.durSum,
  };
}

function sameKey(a: RawIntervalSeg, b: RawIntervalSeg, mode: 'both' | 'battery' | 'grid'): boolean {
  if (mode === 'battery') return a.battery === b.battery;
  if (mode === 'grid') {
    if (a.grid !== b.grid) return false;
    if (a.grid === 'vinde surplusul' || a.grid === 'cumpără') {
      const pa = a.priceWeightedSum / a.durSum;
      const pb = b.priceWeightedSum / b.durSum;
      return Math.abs(pa - pb) < 1e-4;
    }
    return true;
  }
  if (a.battery !== b.battery || a.grid !== b.grid) return false;
  if (a.grid === 'vinde surplusul' || a.grid === 'cumpără') {
    const pa = a.priceWeightedSum / a.durSum;
    const pb = b.priceWeightedSum / b.durSum;
    return Math.abs(pa - pb) < 1e-4;
  }
  return true;
}

function collapseRaw(segs: RawIntervalSeg[], mode: 'both' | 'battery' | 'grid'): RawIntervalSeg[] {
  const out: RawIntervalSeg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && sameKey(prev, s, mode)) {
      out[out.length - 1] = mergeRaw(prev, s, prev.battery, prev.grid);
    } else {
      out.push(s);
    }
  }
  return out;
}

function mergeShortUnder30Min(
  initial: RawIntervalSeg[],
  mode: 'both' | 'battery' | 'grid',
): RawIntervalSeg[] {
  let segs = collapseRaw(initial, mode);
  while (segs.length > 1) {
    let shortIdx = -1;
    let shortDur = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const dur = segs[i].end - segs[i].start;
      if (dur < 0.5 - 1e-6 && dur < shortDur) {
        shortDur = dur;
        shortIdx = i;
      }
    }
    if (shortIdx === -1) break;

    const left = shortIdx > 0 ? segs[shortIdx - 1] : null;
    const right = shortIdx < segs.length - 1 ? segs[shortIdx + 1] : null;
    const curNeg = segs[shortIdx].priceWeightedSum < 0;
    const leftSameSign = left ? (left.priceWeightedSum < 0) === curNeg : false;
    const rightSameSign = right ? (right.priceWeightedSum < 0) === curNeg : false;
    const leftDur = left ? left.end - left.start : -1;
    const rightDur = right ? right.end - right.start : -1;

    const pickLeft =
      left &&
      (!right ||
        (leftSameSign && !rightSameSign) ||
        (leftSameSign === rightSameSign && leftDur >= rightDur));

    if (pickLeft && left) {
      segs[shortIdx - 1] = mergeRaw(left, segs[shortIdx], left.battery, left.grid);
      segs.splice(shortIdx, 1);
    } else if (right) {
      segs[shortIdx + 1] = mergeRaw(segs[shortIdx], right, right.battery, right.grid);
      segs.splice(shortIdx, 1);
    } else {
      break;
    }
    segs = collapseRaw(segs, mode);
  }
  return segs;
}

function rawFromSim(day: House, sim: Sim): RawIntervalSeg[] {
  const out: RawIntervalSeg[] = [];
  for (let i = 0; i < INTERVALS; i++) {
    const { battery, grid } = classifyInterval(day, sim, i);
    const p = sim.prices[i];
    const chKwh = sim.charge[i] * DT;
    const disKwh = sim.discharge[i] * DT;
    const expKwh = sim.exp[i] * DT;
    const impKwh = sim.imp[i] * DT;
    const gridLei = (p > 0 ? p * expKwh : 0) - Math.max(0, p) * impKwh;
    const avoidedImportLei = Math.max(0, p) * disKwh;

    out.push({
      start: i * DT,
      end: (i + 1) * DT,
      battery,
      grid,
      socStartKwh: sim.soc[i],
      socEndKwh: sim.soc[i + 1],
      chargeKWh: chKwh,
      dischargeKWh: disKwh,
      exportKWh: expKwh,
      importKWh: impKwh,
      gridLei,
      avoidedImportLei,
      priceWeightedSum: p * DT,
      durSum: DT,
    });
  }
  return out;
}

function finalizeSegs(day: House, segs: RawIntervalSeg[]): ClientSegment[] {
  return segs.map((s) => {
    const price = round2(s.priceWeightedSum / s.durSum);
    const batteryKWh =
      s.battery === 'încarcă din soare'
        ? s.chargeKWh
        : s.battery === 'folosește în casă'
          ? s.dischargeKWh
          : Math.abs(s.socEndKwh - s.socStartKwh);
    const gridKWh =
      s.grid === 'vinde surplusul' || s.grid === 'trimite fără plată'
        ? s.exportKWh
        : s.grid === 'cumpără'
          ? s.importKWh
          : 0;
    const kWh = round2(Math.max(batteryKWh, gridKWh));
    const batteryLei =
      s.battery === 'folosește în casă'
        ? round2(s.avoidedImportLei)
        : s.battery === 'ține' && s.grid === 'vinde surplusul'
          ? round2(s.gridLei)
          : 0;
    const gridLei = round2(s.gridLei);
    const lei = s.battery === 'folosește în casă' ? batteryLei : gridLei;

    return {
      start: s.start,
      end: s.end,
      battery: s.battery,
      grid: s.grid,
      kWh,
      price,
      lei,
      socStart: Math.round((s.socStartKwh / day.batteryKwh) * 100),
      socEnd: Math.round((s.socEndKwh / day.batteryKwh) * 100),
      batteryKWh: round2(batteryKWh),
      gridKWh: round2(gridKWh),
      batteryLei,
      gridLei,
    };
  });
}

/**
 * The 15-min grid ends a "charge to 100 %" segment at the end of the interval in which the
 * battery fills up (e.g. 14:15), while the battery is actually full a few minutes earlier
 * (e.g. 14:10). Moves that one boundary to the real full minute so every consumer of
 * `clientSegments` (bars, steps, tooltips) shows the same time.
 *
 * The few minutes between the full minute and the old boundary become their own short
 * segment with the next battery action and the previous grid action, so the "Rețeaua" row
 * keeps its 15-min boundaries (no export is invented or removed).
 */
function snapChargeEndToFullMinute(day: House, sim: Sim, segs: ClientSegment[]): ClientSegment[] {
  const fullMin = estimatedFullMinute(day, sim);
  if (fullMin == null) return segs;
  const out: ClientSegment[] = [];
  for (let i = 0; i < segs.length; i++) {
    const cur = segs[i];
    const next = segs[i + 1];
    const endMin = Math.round(cur.end * 60);
    const startMin = Math.round(cur.start * 60);
    if (
      next &&
      cur.battery === 'încarcă din soare' &&
      next.battery !== 'încarcă din soare' &&
      cur.socEnd >= 99 &&
      fullMin > startMin &&
      fullMin < endMin &&
      endMin - fullMin < 15
    ) {
      out.push({ ...cur, end: fullMin / 60 });
      out.push({
        start: fullMin / 60,
        end: cur.end,
        battery: next.battery,
        grid: cur.grid,
        kWh: 0,
        price: cur.price,
        lei: 0,
        socStart: cur.socEnd,
        socEnd: cur.socEnd,
        batteryKWh: 0,
        gridKWh: 0,
        batteryLei: 0,
        gridLei: 0,
      });
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Merges 15-min intervals into {start, end, battery, grid, kWh, price, lei}.
 * Segments shorter than 30 min are merged into their longer neighbor; the end of a
 * "charge to 100 %" segment is then moved to the minute the battery is full.
 * This is the single source for the "Bateria" and "Rețeaua" rows and the "Pe scurt" steps.
 */
export function clientSegments(
  day: House,
  strategy: StrategyMode | Sim,
  cloudStartMin: number | null = null,
): ClientSegment[] {
  const sim = typeof strategy === 'string' ? simulate(day, strategy, cloudStartMin) : strategy;
  const raw = rawFromSim(day, sim);
  return snapChargeEndToFullMinute(day, sim, finalizeSegs(day, mergeShortUnder30Min(raw, 'both')));
}

/** Groups consecutive segments while `same(prev, cur)` holds. */
function groupConsecutive(
  segs: ClientSegment[],
  same: (a: ClientSegment, b: ClientSegment) => boolean,
): ClientSegment[][] {
  const groups: ClientSegment[][] = [];
  for (const s of segs) {
    const g = groups[groups.length - 1];
    if (g && same(g[g.length - 1], s)) g.push(s);
    else groups.push([s]);
  }
  return groups;
}

function mergeGroup(parts: ClientSegment[]): ClientSegment {
  const first = parts[0];
  const last = parts[parts.length - 1];
  const dur = parts.reduce((a, p) => a + (p.end - p.start), 0);
  const sum = (pick: (p: ClientSegment) => number) => round2(parts.reduce((a, p) => a + pick(p), 0));
  return {
    start: first.start,
    end: last.end,
    battery: first.battery,
    grid: first.grid,
    kWh: sum((p) => p.kWh),
    price: round2(parts.reduce((a, p) => a + p.price * (p.end - p.start), 0) / dur),
    lei: sum((p) => p.lei),
    socStart: first.socStart,
    socEnd: last.socEnd,
    batteryKWh: sum((p) => p.batteryKWh),
    gridKWh: sum((p) => p.gridKWh),
    batteryLei: sum((p) => p.batteryLei),
    gridLei: sum((p) => p.gridLei),
  };
}

const sameBattery = (a: ClientSegment, b: ClientSegment) => a.battery === b.battery;
const sameGrid = (a: ClientSegment, b: ClientSegment) =>
  a.grid === b.grid &&
  (a.grid === 'vinde surplusul' || a.grid === 'cumpără' ? Math.abs(a.price - b.price) < 1e-4 : true);

/** "Bateria" row bars: consecutive `clientSegments` with the same battery action, merged. */
export function planBatteryRow(segs: ClientSegment[]): ClientSegment[] {
  return groupConsecutive(segs, sameBattery).map(mergeGroup);
}

/** "Rețeaua" row bars: consecutive `clientSegments` with the same grid action (and price), merged. */
export function planGridRow(segs: ClientSegment[]): ClientSegment[] {
  return groupConsecutive(segs, sameGrid).map(mergeGroup);
}

/** Continuous bands for the "Bateria" row (segments < 30 min merged into longer neighbor). */
export function batteryRowBands(
  day: House,
  strategy: StrategyMode | Sim,
  cloudStartMin: number | null = null,
): ClientSegment[] {
  const sim = typeof strategy === 'string' ? simulate(day, strategy, cloudStartMin) : strategy;
  return finalizeSegs(day, mergeShortUnder30Min(rawFromSim(day, sim), 'battery'));
}

/** Continuous bands for the "Rețeaua" row (segments < 30 min merged into longer neighbor). */
export function gridRowBands(
  day: House,
  strategy: StrategyMode | Sim,
  cloudStartMin: number | null = null,
): ClientSegment[] {
  const sim = typeof strategy === 'string' ? simulate(day, strategy, cloudStartMin) : strategy;
  return finalizeSegs(day, mergeShortUnder30Min(rawFromSim(day, sim), 'grid'));
}

/** Estimated clock minute (rounded to 5 min) when the battery reaches 100 % today. */
export function estimatedFullMinute(day: House, sim: Sim): number | null {
  const target = day.batteryKwh - 0.02;
  for (let i = 0; i < INTERVALS; i++) {
    if (sim.soc[i] < target && sim.soc[i + 1] >= target) {
      const neededKwh = day.batteryKwh - sim.soc[i];
      // Use prior interval's steady charge rate if this final interval was room-clamped
      const prevRate = i > 0 && sim.charge[i - 1] > sim.charge[i] ? sim.charge[i - 1] : sim.charge[i];
      const rateKw = Math.max(0.2, prevRate);
      const exactMin = i * 15 + Math.min(15, (neededKwh / rateKw) * 60);
      return Math.round(exactMin / 5) * 5;
    }
  }
  if (sim.soc[0] >= target) return 0;
  return null;
}

const fmtComma = (v: number, digits = 2) => {
  const sign = v < -1e-9 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(digits).replace('.', ',')}`;
};


const rangeLabel = (start: number, end: number) => {
  const endMin = Math.round(end * 60);
  return `${hhmm(Math.round(start * 60))}–${endMin >= 1440 ? '24:00' : hhmm(endMin)}`;
};

/** Grid prices (lei/kWh) of the 15-min intervals that overlap [start, end). */
function pricesIn(day: House, start: number, end: number): number[] {
  const i0 = Math.max(0, Math.floor(start / DT + 1e-6));
  const i1 = Math.min(INTERVALS, Math.ceil(end / DT - 1e-6));
  return day.prices.slice(i0, Math.max(i0 + 1, i1));
}

/** Keeps units on the number's line when a sentence wraps ("30 %", "0,30 lei/kWh"). */
const keepUnits = (text: string) => text.replace(/ (%|lei\/kWh)/g, '\u00A0$1');

const partDur = (p: ClientSegment) => p.end - p.start;
const longestPart = (parts: ClientSegment[], pred: (p: ClientSegment) => boolean) =>
  parts.filter(pred).sort((a, b) => partDur(b) - partDur(a))[0];

/** Plain-language sentence for one battery bar, from the `clientSegments` it is made of. */
function stepSentence(day: House, bar: ClientSegment, parts: ClientSegment[]): string {
  switch (bar.battery) {
    case 'încarcă din soare':
      return pricesIn(day, bar.start, bar.end).some((p) => p < 0)
        ? 'Încarcă bateria din soare, în loc să trimită energia gratis în rețea.'
        : `Încarcă bateria din soare de la ${bar.socStart} % la ${bar.socEnd} %.`;
    case 'ține': {
      if (bar.socStart >= 95) {
        return parts.some((p) => p.grid === 'trimite fără plată' && partDur(p) > 0.2)
          ? 'Bateria e plină, iar surplusul de prânz pleacă în rețea fără plată.'
          : 'Ține bateria plină pentru seară.';
      }
      const sell = longestPart(parts, (p) => p.grid === 'vinde surplusul');
      return sell
        ? `Vinde surplusul la ${fmtComma(sell.price)} lei/kWh. Bateria ține ${bar.socEnd} %.`
        : `Bateria ține ${bar.socEnd} % pentru seară.`;
    }
    case 'folosește în casă':
      return `Folosește bateria în casă, în loc să cumpere la ${fmtComma(
        Math.max(...pricesIn(day, bar.start, bar.end)),
      )} lei/kWh.`;
    case 'așteaptă': {
      const buy = longestPart(parts, (p) => p.grid === 'cumpără');
      return buy
        ? `Bateria așteaptă la ${bar.socEnd} %, iar casa cumpără la ${fmtComma(buy.price)} lei/kWh.`
        : `Bateria așteaptă la ${bar.socEnd} %.`;
    }
  }
}

/**
 * "Pe scurt" steps. One step per "Bateria" bar (`planBatteryRow` of the same segments), so
 * every step starts and ends exactly on a bar boundary. Night "așteaptă" bars (starting
 * before 07:00 or ending after 22:00) are dropped unless they contain "acum".
 *
 * `strategy` may be the `clientSegments` array the bars were drawn from (preferred), or a
 * strategy / Sim from which `clientSegments` is computed.
 * `nowMinute` is the current minute on "Azi"; pass null for another day (all steps "viitor").
 */
export function planSteps(
  day: House,
  strategy: StrategyMode | Sim | ClientSegment[],
  nowMinute: number | null = null,
): PlanStep[] {
  const segs = Array.isArray(strategy) ? strategy : clientSegments(day, strategy);
  const nowH = nowMinute == null ? null : nowMinute / 60;
  const steps: PlanStep[] = [];

  for (const parts of groupConsecutive(segs, sameBattery)) {
    const bar = mergeGroup(parts);
    const isNow = nowH != null && nowH >= bar.start && nowH < bar.end;
    if (bar.battery === 'așteaptă' && (bar.start < 7 || bar.end > 22) && !isNow) continue;

    let state: PlanStepState = 'viitor';
    let progress = 0;
    if (isNow && nowH != null) {
      state = 'acum';
      progress = Math.min(1, Math.max(0, (nowH - bar.start) / (bar.end - bar.start)));
    } else if (nowH != null && bar.end <= nowH) {
      state = 'trecut';
      progress = 1;
    }

    steps.push({
      start: bar.start,
      end: bar.end,
      rangeLabel: rangeLabel(bar.start, bar.end),
      action: bar.battery,
      sentence: keepUnits(stepSentence(day, bar, parts)),
      state,
      progress,
    });
  }
  return steps;
}

/**
 * What the battery without HomeFlex does during `step`, only where it behaves differently.
 * `without` is `clientSegments(day, 'standard')`. Returns null when the behaviour is the same.
 * Never mentions money, only times, percentages and prices per kWh.
 */
export function comparisonLine(
  day: House,
  step: Pick<PlanStep, 'start' | 'end' | 'action'>,
  without: ClientSegment[],
): string | null {
  const text = comparisonText(day, step, without);
  return text == null ? null : keepUnits(text);
}

function comparisonText(
  day: House,
  step: Pick<PlanStep, 'start' | 'end' | 'action'>,
  without: ClientSegment[],
): string | null {
  const MIN_OVERLAP = DT - 1e-6; // ignore differences shorter than one 15-min interval
  const groups = groupConsecutive(without, sameBattery).map((parts) => ({
    bar: mergeGroup(parts),
    parts,
  }));
  const diff = groups
    .map((g) => ({ ...g, s: Math.max(g.bar.start, step.start), e: Math.min(g.bar.end, step.end) }))
    .find((g) => g.e - g.s >= MIN_OVERLAP && g.bar.battery !== step.action);
  if (!diff) return null;

  const at = (h: number) => hhmm(Math.round(h * 60));
  const priceAt = (h: number) => fmtComma(pricesIn(day, h, h + DT)[0]);
  const fromStepStart = diff.s <= step.start + 1e-6;

  switch (diff.bar.battery) {
    case 'încarcă din soare': {
      if (diff.bar.socEnd >= 99 && diff.bar.end <= step.end + 1e-6) {
        const unpaidLater = without.some(
          (p) => p.grid === 'trimite fără plată' && p.start >= diff.bar.end - 1e-6,
        );
        return unpaidLater
          ? `Fără HomeFlex: bateria se umplea până la ${at(diff.bar.end)}, iar la prânz nu mai avea loc pentru surplus.`
          : `Fără HomeFlex: bateria se umplea până la ${at(diff.bar.end)}.`;
      }
      return fromStepStart
        ? 'Fără HomeFlex: bateria se încărca din soare.'
        : `Fără HomeFlex: bateria se încărca din soare de la ${at(diff.s)}.`;
    }
    case 'ține': {
      if (diff.bar.socStart >= 95) {
        const unpaid = diff.parts.some(
          (p) =>
            p.grid === 'trimite fără plată' &&
            Math.min(p.end, step.end) - Math.max(p.start, step.start) >= MIN_OVERLAP,
        );
        return unpaid
          ? 'Fără HomeFlex: bateria era deja plină, iar surplusul pleca gratis în rețea.'
          : 'Fără HomeFlex: bateria era deja plină.';
      }
      return `Fără HomeFlex: bateria stătea la ${diff.bar.socEnd} %.`;
    }
    case 'folosește în casă':
      return fromStepStart
        ? `Fără HomeFlex: bateria se golea deja în casă, când energia costa ${priceAt(diff.s)} lei/kWh.`
        : `Fără HomeFlex: bateria începea să se golească de la ${at(diff.s)}, când energia costa ${priceAt(diff.s)} lei/kWh.`;
    case 'așteaptă': {
      const buy = diff.parts.some((p) => p.grid === 'cumpără');
      const tail = buy ? `, iar casa cumpăra la ${priceAt(diff.s)} lei/kWh` : '';
      return fromStepStart
        ? `Fără HomeFlex: bateria aștepta la ${diff.bar.socEnd} %${tail}.`
        : `Fără HomeFlex: bateria ajungea la ${diff.bar.socEnd} % la ${at(diff.s)}${tail}.`;
    }
  }
}
