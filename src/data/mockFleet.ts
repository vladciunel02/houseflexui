// Deterministic mock data for HomeFlex în myPPC (single client house RO-B-0412).
// Seeded RNG guarantees identical numbers on every reload.

export const INTERVALS = 96;
export const DT = 0.25; // hours per 15-min interval
export const RESERVE = 0.2; // 20 % minimum battery reserve

export type StrategyMode = 'standard' | 'homeflex';

export interface House {
  id: string;
  address: string;
  city: string;
  batteryKwh: number;
  kwp: number;
  startSoc: number; // kWh at 00:00
  pmaxKw: number; // max battery inverter kW
  hfChargeMaxKw: number; // paced HomeFlex charging rate during negative prices
  dayLoadKwh: number;
  prices: number[]; // lei/kWh, 96 intervals
  solarClear: number[]; // kW clear-sky solar, 96 intervals
  loadActual: number[]; // kW household consumption, 96 intervals
}

export interface Sim {
  strategy: StrategyMode;
  prices: number[];
  solar: number[];
  solarClear: number[];
  load: number[];
  charge: number[];
  discharge: number[];
  imp: number[];
  exp: number[];
  soc: number[]; // kWh at start of each interval, length INTERVALS + 1
  netLei: number[]; // net lei per interval (+export revenue - import cost; export at negative price pays 0 lei)
}

export interface PastDaySaving {
  dayOfMonth: number;
  isWeekend: boolean;
  savedLei: number;
}

// ---------- seeded RNG (mulberry32) ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261108);
const between = (a: number, b: number) => a + (b - a) * rand();
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round2 = (x: number) => Math.round(x * 100) / 100;

function smoothNoise(n: number, amp: number): number[] {
  const raw = Array.from({ length: n }, () => (rand() * 2 - 1) * amp);
  return raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        s += raw[j];
        c++;
      }
    }
    return s / c;
  });
}

// ---------- prices (lei/kWh) ----------
// Today ("Azi"): negative prices 11:00–15:00
export function priceTodayAtHour(h: number): number {
  if (h < 7) return 0.45;
  if (h < 11) return 0.3;
  if (h < 15) return -0.1;
  if (h < 18) return 0.4;
  if (h < 22) return 0.95;
  return 0.45;
}

// Tomorrow ("Mâine"): negative prices only 12:00–14:00
export function priceTomorrowAtHour(h: number): number {
  if (h < 7) return 0.44;
  if (h < 12) return 0.32;
  if (h < 14) return -0.08;
  if (h < 18) return 0.4;
  if (h < 22) return 0.94;
  return 0.44;
}

export const PRICE: number[] = Array.from({ length: INTERVALS }, (_, i) => priceTodayAtHour(i * DT));
export const PRICE_TOMORROW: number[] = Array.from({ length: INTERVALS }, (_, i) =>
  priceTomorrowAtHour(i * DT),
);

// ---------- solar & household consumption shapes ----------
function solarShape(h: number): number {
  if (h <= 7 || h >= 18.25) return 0;
  return Math.pow(Math.sin((Math.PI * (h - 7)) / 11.25), 0.82);
}

function gauss(h: number, mu: number, sigma: number): number {
  return Math.exp(-((h - mu) ** 2) / (2 * sigma * sigma));
}

function eveningPlateau(h: number): number {
  const up = 1 / (1 + Math.exp(-(h - 17.75) * 5));
  const down = 1 / (1 + Math.exp((h - 22.05) * 5));
  return up * down;
}

function familyLoadAtHour(h: number, base: number, evening: number): number {
  const morning = gauss(h, 7.4, 0.75);
  const lunch = gauss(h, 13.0, 1.4);
  const lateAfternoon = gauss(h, 16.9, 0.75); // cooking / arrival home before 18:00 peak
  return base + 0.55 * morning + 0.16 * lunch + 0.72 * lateAfternoon + (evening - base) * eveningPlateau(h);
}

function buildClientDay(prices: number[], sunFactor: number): House {
  const kwp = 5.2;
  const batteryKwh = 10;
  const startSoc = 3.0; // 30 %
  const pmaxKw = 3.5;
  const hfChargeMaxKw = 2.21;
  const peak = kwp * 0.865 * sunFactor;
  const noise = smoothNoise(INTERVALS, 0.09);

  const solarClear: number[] = [];
  const loadActual: number[] = [];
  for (let i = 0; i < INTERVALS; i++) {
    const h = i * DT + DT / 2;
    solarClear.push(round3(peak * solarShape(h)));
    const l = familyLoadAtHour(h, 0.42, 2.38);
    loadActual.push(round3(Math.max(0.16, l * (1 + noise[i]))));
  }

  return {
    id: 'RO-B-0412',
    address: 'Str. Fabricii 12, București',
    city: 'București',
    batteryKwh,
    kwp,
    startSoc,
    pmaxKw,
    hfChargeMaxKw,
    dayLoadKwh: round3(loadActual.reduce((a, b) => a + b * DT, 0)),
    prices,
    solarClear,
    loadActual,
  };
}

export const CLIENT_TODAY: House = buildClientDay(PRICE, 1.0);
export const CLIENT_TOMORROW: House = buildClientDay(PRICE_TOMORROW, 0.97);

// ---------- deterministic past savings for the current month ----------
// 24 past days (0,40 .. 3,20 lei, higher on sunny weekend days); day 24 is "Ieri"
export const MONTH_SAVINGS: PastDaySaving[] = Array.from({ length: 24 }, (_, idx) => {
  const dayOfMonth = idx + 1;
  const dow = (dayOfMonth + 1) % 7; // 5 = Saturday, 6 = Sunday
  const isWeekend = dow === 5 || dow === 6;
  const raw = isWeekend ? between(2.15, 3.2) : between(0.4, 2.25);
  return {
    dayOfMonth,
    isWeekend,
    savedLei: round2(Math.min(3.2, Math.max(0.4, raw))),
  };
});

export const YESTERDAY_SAVED_LEI: number = MONTH_SAVINGS[MONTH_SAVINGS.length - 1].savedLei;
export const PAST_MONTH_SAVED_LEI: number = round2(
  MONTH_SAVINGS.reduce((acc, d) => acc + d.savedLei, 0),
);

// ---------- cloud: solar drops ~40% for 45 minutes from a given minute ----------
export const CLOUD_FACTOR = 0.6;
export const CLOUD_MINUTES = 45;
export function cloudIntervals(cloudStartMin: number | null): Set<number> {
  const s = new Set<number>();
  if (cloudStartMin == null) return s;
  const first = Math.floor(cloudStartMin / 15);
  for (let k = 0; k < CLOUD_MINUTES / 15; k++) if (first + k < INTERVALS) s.add(first + k);
  return s;
}

/**
 * Simulates a client day while strictly preserving the energy balance in every interval:
 * solar + imp + discharge = load + charge + exp
 * If `cancelFromMin` is provided with `'homeflex'`, runs HomeFlex until `cancelFromMin`,
 * then switches to ordinary battery behaviour (`'standard'`) until 24:00.
 */
export function simulate(
  house: House,
  strategy: StrategyMode,
  cloudStartMin: number | null = null,
  cancelFromMin: number | null = null,
): Sim {
  const cloudy = cloudIntervals(cloudStartMin);
  const cap = house.batteryKwh;
  const reserve = cap * RESERVE;
  const pmax = house.pmaxKw;
  const prices = house.prices;
  const solarClear = house.solarClear.map((s, i) => (cloudy.has(i) ? round3(s * CLOUD_FACTOR) : s));
  const load = house.loadActual;

  // Negative-price window start & duration for pacing HomeFlex charging
  let firstNegIdx = -1;
  let negCount = 0;
  for (let i = 0; i < INTERVALS; i++) {
    if (prices[i] < 0) {
      if (firstNegIdx === -1) firstNegIdx = i;
      negCount++;
    }
  }
  const firstNegH = firstNegIdx >= 0 ? firstNegIdx * DT : 11;
  const negDurationH = negCount * DT;
  // For a 4h negative window (today), pace at hfChargeMaxKw (~2.21 kW -> full at ~14:10);
  // for a shorter 2h window (tomorrow), allow up to pmax (3.5 kW -> full by 14:00).
  const negChargeCapKw = negDurationH <= 2.25 ? pmax : house.hfChargeMaxKw;

  const solar: number[] = [];
  const charge: number[] = [];
  const discharge: number[] = [];
  const imp: number[] = [];
  const exp: number[] = [];
  const soc: number[] = [house.startSoc];
  const netLei: number[] = [];

  for (let i = 0; i < INTERVALS; i++) {
    const h = i * DT;
    const minuteStart = i * 15;
    const cancelBucketMin = cancelFromMin != null ? Math.floor(cancelFromMin / 15) * 15 : null;
    const stepMode: StrategyMode =
      strategy === 'homeflex' && cancelBucketMin != null && minuteStart >= cancelBucketMin
        ? 'standard'
        : strategy;

    const s = soc[i];
    const room = Math.max(0, (cap - s) / DT);
    const avail = Math.max(0, (s - reserve) / DT);
    const rawSol = solarClear[i];
    const ld = load[i];
    const surplus = rawSol - ld;

    let ch = 0;
    let dis = 0;
    let sol = rawSol;

    if (stepMode === 'homeflex') {
      if (surplus > 0 && h >= firstNegH && h < 17) {
        const rateLimit = prices[i] < 0 ? negChargeCapKw : pmax;
        ch = Math.min(surplus, rateLimit, room);
      } else if (surplus < 0 && h >= 18 && h < 22) {
        dis = Math.min(-surplus, pmax, avail);
      }
      // During negative prices, inverter limits PV generation to household load + battery charging (0 export)
      if (prices[i] < 0) {
        sol = round3(Math.min(rawSol, ld + ch));
      }
    } else {
      // Standard battery behaviour ("Fără HomeFlex"): charges as soon as surplus appears,
      // discharges whenever load > solar after sunrise, and does not curtail negative-price export.
      if (surplus > 0) {
        ch = Math.min(surplus, pmax, room);
      } else if (surplus < 0 && h >= 7 && h < 23) {
        dis = Math.min(-surplus, pmax, avail);
      }
    }

    const grid = sol - ld - ch + dis;
    const e = round3(Math.max(0, grid));
    const im = round3(Math.max(0, -grid));
    ch = round3(ch);
    dis = round3(dis);

    // Export at negative price is paid 0 lei ("trimite fără plată")
    const earn = (prices[i] > 0 ? prices[i] * e : 0) * DT;
    const spend = Math.max(0, prices[i]) * im * DT;

    solar.push(sol);
    charge.push(ch);
    discharge.push(dis);
    exp.push(e);
    imp.push(im);
    soc.push(round3(s + (ch - dis) * DT));
    netLei.push(earn - spend);
  }

  return {
    strategy,
    prices,
    solar,
    solarClear,
    load,
    charge,
    discharge,
    imp,
    exp,
    soc,
    netLei,
  };
}

// ---------- snapshot at a simulated minute ----------
export interface Snapshot {
  idx: number;
  solar: number;
  load: number;
  charge: number;
  discharge: number;
  imp: number;
  exp: number;
  battery: number; // + charging, − discharging (kW)
  socKwh: number;
  socPct: number;
  price: number;
}

export function snapshot(house: House, sim: Sim, minute: number): Snapshot {
  const m = Math.min(Math.max(minute, 0), 1440 - 1e-6);
  const idx = Math.floor(m / 15);
  const frac = (m - idx * 15) / 15;
  const socKwh = sim.soc[idx] + (sim.soc[idx + 1] - sim.soc[idx]) * frac;
  return {
    idx,
    solar: sim.solar[idx],
    load: sim.load[idx],
    charge: sim.charge[idx],
    discharge: sim.discharge[idx],
    imp: sim.imp[idx],
    exp: sim.exp[idx],
    battery: sim.charge[idx] - sim.discharge[idx],
    socKwh,
    socPct: (socKwh / house.batteryKwh) * 100,
    price: sim.prices[idx],
  };
}

export const hhmm = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
