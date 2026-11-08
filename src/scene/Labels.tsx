import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ANCHORS, HOUSE_BOX_POINTS } from './geometry';
import { snapshot, type House, type Sim } from '../data/mockFleet';
import { useMinute } from '../state/time';
import { Num, fmt } from '../ui/Num';
import type { HoverKey } from './House';

const TIP_AT: Record<Exclude<HoverKey, null>, THREE.Vector3> = {
  panels: ANCHORS.solar,
  battery: ANCHORS.batteryCenter,
  meter: ANCHORS.meter,
  house: ANCHORS.window,
  post: ANCHORS.postTop,
};

export interface LabelRefs {
  solar: React.RefObject<HTMLDivElement | null>;
  house: React.RefObject<HTMLDivElement | null>;
  battery: React.RefObject<HTMLDivElement | null>;
  grid: React.RefObject<HTMLDivElement | null>;
  tip: React.RefObject<HTMLDivElement | null>;
}

export function useLabelRefs(): LabelRefs {
  return {
    solar: useRef<HTMLDivElement>(null),
    house: useRef<HTMLDivElement>(null),
    battery: useRef<HTMLDivElement>(null),
    grid: useRef<HTMLDivElement>(null),
    tip: useRef<HTMLDivElement>(null),
  };
}

/** Gap between a label text and the house outline, another label text, or the canvas edge. */
const GAP = 8;
const EDGE = 4;

interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x < b.r + pad && a.r > b.x - pad && a.y < b.b + pad && a.b > b.y - pad;

/** Convex hull (monotone chain) of projected points. */
function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Highest and lowest screen y of the polygon over the column x0..x1 (null if it misses the column). */
function columnSpan(poly: Pt[], x0: number, x1: number): { top: number; bottom: number } | null {
  let top = Infinity;
  let bottom = -Infinity;
  const take = (y: number) => {
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a.x >= x0 && a.x <= x1) take(a.y);
    for (const x of [x0, x1]) {
      if ((a.x - x) * (b.x - x) < 0) take(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  }
  return top === Infinity ? null : { top, bottom };
}

interface LabelSlot {
  key: 'house' | 'solar' | 'grid' | 'battery';
  world: THREE.Vector3;
  /** Always sits above the house outline (the "Casă" top slot). */
  topSlot?: boolean;
}

// Placement order: earlier labels keep their x, later ones slide sideways to make room.
const SLOTS: LabelSlot[] = [
  { key: 'house', world: ANCHORS.house, topSlot: true },
  { key: 'solar', world: ANCHORS.solar },
  { key: 'grid', world: ANCHORS.grid },
  { key: 'battery', world: ANCHORS.battery },
];

/**
 * Projects 3D anchors onto the DOM label overlay every frame and lays the labels out so that
 * no label text overlaps the house outline (the convex hull of the house's projected 3D bounding
 * boxes) or another label's text. A label keeps its leader line on its anchor: the line grows to
 * push the text clear of the house, and tilts when the text has to slide sideways.
 */
export function AnchorProjector({ refs, hovered }: { refs: LabelRefs; hovered: HoverKey }) {
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera, size }) => {
    const project = (world: THREE.Vector3) => {
      v.current.copy(world).project(camera);
      return {
        x: (v.current.x * 0.5 + 0.5) * size.width,
        y: (-v.current.y * 0.5 + 0.5) * size.height,
        behind: v.current.z > 1,
      };
    };

    const outline = convexHull(HOUSE_BOX_POINTS.map(project).filter((p) => !p.behind));
    const leadScale = Math.min(1, Math.max(0.55, size.height / 480));
    const placed: Box[] = [];

    for (const slot of SLOTS) {
      const el = refs[slot.key].current;
      const label = el?.firstElementChild as HTMLElement | null;
      const lead = label?.querySelector<HTMLElement>('.lead') ?? null;
      const txt = label?.querySelector<HTMLElement>('.txt') ?? null;
      if (!el || !label || !lead || !txt) continue;

      const a = project(slot.world);
      const up = label.classList.contains('up');
      const w = label.offsetWidth;
      const h = txt.offsetHeight + GAP; // text block + its margin toward the leader
      const base = (Number(lead.dataset.lead) || 0) * leadScale;

      const textBox = (dx: number, len: number): Box => {
        const cx = a.x + dx;
        return up
          ? { x: cx - w / 2, y: a.y - len - h, r: cx + w / 2, b: a.y - len }
          : { x: cx - w / 2, y: a.y + len, r: cx + w / 2, b: a.y + len + h };
      };
      /** Leader length that keeps the text clear of the house outline at horizontal shift dx. */
      const clearLen = (dx: number) => {
        const span = columnSpan(outline, a.x + dx - w / 2 - GAP, a.x + dx + w / 2 + GAP);
        if (!span) return base;
        if (up) {
          const t = textBox(dx, base);
          const hits = t.b > span.top - GAP && t.y < span.bottom + GAP;
          return slot.topSlot || hits ? Math.max(base, a.y - (span.top - GAP)) : base;
        }
        const t = textBox(dx, base);
        const hits = t.y < span.bottom + GAP && t.b > span.top - GAP;
        return hits ? Math.max(base, span.bottom + GAP - a.y) : base;
      };
      const clampDx = (dx: number) =>
        Math.min(Math.max(dx, EDGE + w / 2 - a.x), size.width - EDGE - w / 2 - a.x);

      let dx = clampDx(0);
      let len = clearLen(dx);
      for (let i = 0; i < 4; i++) {
        const box = textBox(dx, len);
        const hit = placed.find((p) => overlaps(box, p, GAP));
        if (!hit) break;
        const left = clampDx(hit.x - GAP - w / 2 - a.x);
        const right = clampDx(hit.r + GAP + w / 2 - a.x);
        const leftOk = !overlaps(textBox(left, len), hit, GAP - 0.5);
        const rightOk = !overlaps(textBox(right, len), hit, GAP - 0.5);
        dx = leftOk && (!rightOk || Math.abs(left - dx) <= Math.abs(right - dx)) ? left : right;
        len = clearLen(dx);
      }
      placed.push(textBox(dx, len));

      // Leader: from the anchor to the text, tilted when the text slid sideways
      const tilt = Math.atan2(dx, len);
      const stretch = Math.hypot(dx, len) / Math.max(1, len);
      lead.style.maxHeight = 'none';
      lead.style.height = `${len.toFixed(1)}px`;
      lead.style.transformOrigin = up ? '50% 100%' : '50% 0';
      lead.style.transform = `rotate(${(up ? tilt : -tilt).toFixed(4)}rad) scaleY(${stretch.toFixed(4)})`;
      txt.style.transform = `translateX(${dx.toFixed(1)}px)`;
      el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
      el.style.visibility = a.behind ? 'hidden' : 'visible';
    }

    const tip = refs.tip.current;
    if (tip && hovered) {
      const t = project(TIP_AT[hovered]);
      const x = Math.min(Math.max(t.x, 48), Math.max(48, size.width - 48));
      tip.style.transform = `translate3d(${x.toFixed(1)}px, ${t.y.toFixed(1)}px, 0)`;
      tip.style.visibility = t.behind ? 'hidden' : 'visible';
    }
  });
  return null;
}

/** Label name with the same 8px square in the label's flow colour. */
function FlowCaption({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="solar-caption">
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <rect x="0" y="0" width="8" height="8" fill={color} />
      </svg>
      {children}
    </span>
  );
}

function LabelNode({
  elRef,
  dir,
  lead,
  caption,
  valClass = '',
  children,
}: {
  elRef: React.RefObject<HTMLDivElement | null>;
  dir: 'up' | 'down';
  lead: number;
  caption: React.ReactNode;
  valClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div ref={elRef} className="s-anchor" style={{ visibility: 'hidden' }}>
      <div className={`s-label ${dir}`}>
        {dir === 'down' && <div className="lead" data-lead={lead} style={{ height: lead }} />}
        <div className="txt">
          {dir === 'up' && <div className={`val ${valClass}`}>{children}</div>}
          {dir === 'up' && <div className="scene-caption">{caption}</div>}
          {dir === 'down' && <div className="scene-caption">{caption}</div>}
          {dir === 'down' && <div className={`val ${valClass}`}>{children}</div>}
        </div>
        {dir === 'up' && <div className="lead" data-lead={lead} style={{ height: lead }} />}
      </div>
    </div>
  );
}

/** The battery arrow shows only from this |power| (kW); below it the label reads "0,0 kW". */
const BATTERY_ARROW_KW = 0.05;

export function SceneLabels({
  refs,
  hovered,
  house,
  sim,
}: {
  refs: LabelRefs;
  hovered: HoverKey;
  house: House;
  sim: Sim;
}) {
  const minute = useMinute();
  const s = snapshot(house, sim, minute);
  const exporting = s.exp > 0.005;
  const neg = s.price < 0;

  let tipTitle = '';
  let tipBody = '';
  if (hovered) {
    switch (hovered) {
      case 'panels':
        tipTitle = 'Panouri solare';
        tipBody = s.solar > 0.02 ? `Produc acum ${fmt(s.solar)} kW din soare` : 'Fără producție solară acum';
        break;
      case 'battery':
        tipTitle = 'Baterie';
        tipBody =
          s.charge > 0.01
            ? `Încarcă din soare · ${fmt(s.socPct, 0)} % (${fmt(s.socKwh, 1)} din ${house.batteryKwh} kWh)`
            : s.discharge > 0.01
              ? `Folosită în casă · ${fmt(s.socPct, 0)} % (${fmt(s.socKwh, 1)} din ${house.batteryKwh} kWh)`
              : `Stă la ${fmt(s.socPct, 0)} % (${fmt(s.socKwh, 1)} din ${house.batteryKwh} kWh)`;
        break;
      case 'meter':
        tipTitle = 'Contor';
        tipBody =
          s.exp > 0.005
            ? neg
              ? `Trimite în rețea fără plată (${fmt(s.price, 2)} lei/kWh)`
              : `Vinde surplusul la ${fmt(s.price, 2)} lei/kWh`
            : s.imp > 0.005
              ? `Cumpără din rețea la ${fmt(s.price, 2)} lei/kWh`
              : 'Fără schimb cu rețeaua acum';
        break;
      case 'house':
        tipTitle = 'Casă';
        tipBody =
          s.discharge > 0.01
            ? 'Consum acoperit din baterie'
            : s.solar > 0.02
              ? 'Consum acoperit din soare'
              : `Preț rețea: ${fmt(s.price, 2)} lei/kWh`;
        break;
      case 'post':
        tipTitle = 'Rețea';
        tipBody =
          s.exp > 0.005
            ? neg
              ? `Surplus trimis fără plată (${fmt(s.price, 2)} lei/kWh)`
              : `Vinde la +${fmt(s.price, 2)} lei/kWh`
            : `Preț acum: ${fmt(s.price, 2)} lei/kWh`;
        break;
    }
  }

  const gridCaption = exporting
    ? neg
      ? 'Rețea · fără plată'
      : 'Rețea · vinde'
    : s.imp > 0.005
      ? 'Rețea · cumpără'
      : 'Rețea';

  return (
    <div className="s-overlay" aria-hidden="false">
      <LabelNode
        elRef={refs.solar}
        dir="up"
        lead={50}
        valClass="val-solar"
        caption={<FlowCaption color="var(--color-yellow)">Solar</FlowCaption>}
      >
        <Num value={s.solar} /> <small>kW</small>
      </LabelNode>
      <LabelNode
        elRef={refs.house}
        dir="up"
        lead={38}
        caption={<FlowCaption color="var(--color-text)">Casă</FlowCaption>}
      >
        <Num value={s.load} /> <small>kW</small>
      </LabelNode>
      <LabelNode
        elRef={refs.battery}
        dir="down"
        lead={40}
        caption={<FlowCaption color="var(--color-blue)">Baterie</FlowCaption>}
      >
        {/* "▲ 2,2 kW · 63 %" while charging/discharging; "0,0 kW · 100 %" (no arrow) when idle */}
        {Math.abs(s.battery) >= BATTERY_ARROW_KW && (
          <span className="tri" style={{ margin: '0 var(--space-1) 0 0' }}>
            {s.battery < 0 ? '▼' : '▲'}
          </span>
        )}
        <Num value={Math.abs(s.battery) >= BATTERY_ARROW_KW ? s.battery : 0} abs /> <small>kW</small>{' '}
        <small>·</small>{' '}
        <Num value={s.socPct} digits={0} /> <small>%</small>
      </LabelNode>
      <LabelNode
        elRef={refs.grid}
        dir="down"
        lead={30}
        caption={
          <FlowCaption color={exporting && neg ? 'var(--color-negative)' : 'var(--color-inactive)'}>
            {gridCaption}
          </FlowCaption>
        }
      >
        <Num value={exporting ? s.exp : s.imp} /> <small>kW</small>
        <div className={`price tnum ${neg ? 'neg' : ''}`}>{fmt(s.price, 2)} lei/kWh</div>
      </LabelNode>
      <div ref={refs.tip} className="s-anchor" style={{ zIndex: 20, visibility: hovered ? 'visible' : 'hidden' }}>
        {hovered && (
          <div className="s-tip tnum">
            <strong>{tipTitle}</strong>
            <br />
            <span>{tipBody}</span>
          </div>
        )}
      </div>
    </div>
  );
}
