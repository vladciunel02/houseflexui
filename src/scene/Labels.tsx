import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ANCHORS, MAIN } from './geometry';
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

/** Minimum distance between any label slot and the element in `avoidRef` ("Resetează vederea"). */
const AVOID_CLEARANCE = 24;
/** Shortest leader line a label may get when it is pulled away from `avoidRef`. */
const MIN_LEAD = 10;

interface Box {
  x: number;
  y: number;
  r: number;
  b: number;
}

const intersects = (a: Box, b: Box) => a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;

/** Gap kept between the texts of two labels. */
const LABEL_GAP = 8;

interface Placed {
  text: Box; // text block only (no leader line), as placed
  anchorY: number;
  w: number;
  textH: number;
  baseLead: number;
}

/**
 * Projects 3D anchor points onto the 2D DOM overlay refs at 60 fps.
 * Labels keep at least AVOID_CLEARANCE px from the `avoidRef` element (same coordinate space as
 * the canvas): first by shortening the label's leader line, then by lifting it.
 * The battery label hangs below its anchor unless its text would hit another label's text;
 * then it is shown above the anchor instead (`onBatteryUp`).
 */
export function AnchorProjector({
  refs,
  hovered,
  avoidRef,
  batteryUp = false,
  onBatteryUp,
}: {
  refs: LabelRefs;
  hovered: HoverKey;
  avoidRef?: React.RefObject<HTMLElement | null>;
  batteryUp?: boolean;
  onBatteryUp?: (up: boolean) => void;
}) {
  const v = useRef(new THREE.Vector3());
  useFrame(({ camera, size }) => {
    const avoidEl = avoidRef?.current ?? null;
    const zone: Box | null =
      avoidEl && avoidEl.offsetWidth > 0
        ? {
            x: avoidEl.offsetLeft - AVOID_CLEARANCE,
            y: avoidEl.offsetTop - AVOID_CLEARANCE,
            r: avoidEl.offsetLeft + avoidEl.offsetWidth + AVOID_CLEARANCE,
            b: avoidEl.offsetTop + avoidEl.offsetHeight + AVOID_CLEARANCE,
          }
        : null;

    /** `clearAboveY`: for an "up" label, extend its leader so the text ends above this screen y. */
    const place = (
      el: HTMLDivElement | null,
      world: THREE.Vector3 | null,
      padX = 48,
      clearAboveY: number | null = null,
    ): Placed | null => {
      if (!el || !world) return null;
      v.current.copy(world).project(camera);
      const label = el.firstElementChild as HTMLElement | null;
      const lead = label?.querySelector<HTMLElement>('.lead') ?? null;
      // Keep the whole label inside the stage, not only its anchor
      const pad = lead && label ? Math.max(padX, Math.ceil(label.offsetWidth / 2)) : padX;
      const rawX = (v.current.x * 0.5 + 0.5) * size.width;
      const x = Math.min(Math.max(rawX, pad), Math.max(pad, size.width - pad));
      const anchorY = (-v.current.y * 0.5 + 0.5) * size.height;
      let y = anchorY;
      let placed: Placed | null = null;
      if (label && lead) {
        const wantedLead = Number(lead.dataset.lead) || 0;
        // CSS cap on the leader (mobile); remembered while an inline override is active
        if (lead.style.maxHeight === '') lead.dataset.cap = getComputedStyle(lead).maxHeight;
        const maxLead = parseFloat(lead.dataset.cap ?? '');
        const baseLead = Number.isFinite(maxLead) ? Math.min(wantedLead, maxLead) : wantedLead;
        const curLead = lead.offsetHeight;
        const w = label.offsetWidth;
        const h = label.offsetHeight - curLead + baseLead;
        const down = label.classList.contains('down');
        const box: Box = down
          ? { x: x - w / 2, y, r: x + w / 2, b: y + h }
          : { x: x - w / 2, y: y - h, r: x + w / 2, b: y };

        let nextLead = baseLead;
        if (zone && intersects(box, zone) && down) {
          // Pull the text up toward its anchor by shortening the leader line
          nextLead = Math.max(Math.min(MIN_LEAD, baseLead), baseLead - (box.b - zone.y));
          box.b -= baseLead - nextLead;
        }
        if (zone && intersects(box, zone)) {
          // Still too close: lift the whole label by the remaining amount. The link sits at the
          // bottom edge, so lifting always clears it without pushing into neighbouring labels.
          y -= box.b - zone.y;
        }
        let longLead = false;
        if (!down && clearAboveY != null) {
          // Text above the house silhouette, on the open page background
          const needed = y - clearAboveY + LABEL_GAP;
          if (needed > nextLead) {
            nextLead = Math.min(needed, Math.max(baseLead, y - 4 - (label.offsetHeight - curLead)));
            longLead = nextLead > baseLead;
          }
        }
        const maxPx = longLead ? 'none' : '';
        if (lead.style.maxHeight !== maxPx) lead.style.maxHeight = maxPx;
        const leadPx = `${nextLead}px`;
        if (lead.style.height !== leadPx) lead.style.height = leadPx;
        const textH = label.offsetHeight - curLead;
        const text: Box = down
          ? { x: x - w / 2, y: y + nextLead, r: x + w / 2, b: y + nextLead + textH }
          : { x: x - w / 2, y: y - nextLead - textH, r: x + w / 2, b: y - nextLead };
        placed = { text, anchorY, w, textH, baseLead };
      }

      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.visibility = v.current.z > 1 ? 'hidden' : 'visible';
      return placed;
    };
    const others = [
      place(refs.solar.current, ANCHORS.solar),
      place(refs.house.current, ANCHORS.house),
      place(refs.grid.current, ANCHORS.grid),
    ].filter((p): p is Placed => p != null);
    // Screen y of the roof ridge above the battery: a flipped battery label clears it
    v.current.set(ANCHORS.battery.x, MAIN.ridge + 0.2, 0).project(camera);
    const ridgeY = (-v.current.y * 0.5 + 0.5) * size.height;
    const bat = place(refs.battery.current, ANCHORS.battery, 48, batteryUp ? ridgeY : null);
    place(refs.tip.current, hovered ? TIP_AT[hovered] : null);

    if (bat && onBatteryUp) {
      // Where the battery text would sit hanging below its anchor (its preferred slot)
      const cx = (bat.text.x + bat.text.r) / 2;
      const below: Box = {
        x: cx - bat.w / 2 - LABEL_GAP,
        y: bat.anchorY + bat.baseLead - LABEL_GAP,
        r: cx + bat.w / 2 + LABEL_GAP,
        b: bat.anchorY + bat.baseLead + bat.textH + LABEL_GAP,
      };
      const wantUp = others.some((o) => intersects(below, o.text));
      if (wantUp !== batteryUp) onBatteryUp(wantUp);
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

export function SceneLabels({
  refs,
  hovered,
  house,
  sim,
  batteryUp = false,
}: {
  refs: LabelRefs;
  hovered: HoverKey;
  house: House;
  sim: Sim;
  /** Show the battery label above its anchor (set by AnchorProjector when the slot below is taken). */
  batteryUp?: boolean;
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
        dir="down"
        lead={14}
        caption={<FlowCaption color="var(--color-text)">Casă</FlowCaption>}
      >
        <Num value={s.load} /> <small>kW</small>
      </LabelNode>
      <LabelNode
        elRef={refs.battery}
        dir={batteryUp ? 'up' : 'down'}
        lead={40}
        caption={<FlowCaption color="var(--color-blue)">Baterie</FlowCaption>}
      >
        {/* "▲ 2,2 kW · 63 %": blue arrow right before the kW value */}
        <span
          className="tri"
          style={{ margin: '0 var(--space-1) 0 0', opacity: Math.abs(s.battery) > 0.01 ? 1 : 0.35 }}
        >
          {s.battery < -0.01 ? '▼' : '▲'}
        </span>
        <Num value={s.battery} abs /> <small>kW</small> <small>·</small>{' '}
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
