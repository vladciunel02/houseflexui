import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Outlines, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import {
  BATTERY,
  CABLES,
  CABLE_POINTS,
  CABLE_R,
  CABLE_R_ACTIVE,
  DOOR_X,
  GARAGE_BRACKET,
  FASCIA,
  FRONT_WINDOWS_X,
  GARAGE,
  MAIN,
  METER,
  PANEL_ORIGIN,
  PANELS,
  POST,
  ROOF_ANGLE,
  ROOF_SLAB,
  FRONT_SLAB_CENTER,
  SOLAR_JUNCTION,
  WALL_GLAND,
  cablePath,
  type FlowKey,
} from './geometry';
import { snapshot, type House as HouseData, type Sim, type Snapshot } from '../data/mockFleet';
import { timeStore, prefersReducedMotion } from '../state/time';
import { readToken, threeColor } from '../styles/tokens';

export type HoverKey = 'panels' | 'battery' | 'meter' | 'house' | 'post' | null;

interface Props {
  house: HouseData;
  sim: Sim;
  hovered: HoverKey;
  setHovered: (k: HoverKey) => void;
}

/** Procedural solar-cell texture on --model-panel. */
function useCellTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 320;
    const g = c.getContext('2d')!;
    g.fillStyle = readToken('--model-panel');
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = readToken('--model-panel-grid');
    g.lineWidth = 2;
    const cols = 6;
    const rows = 10;
    for (let i = 1; i < cols; i++) {
      const x = (i * c.width) / cols;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, c.height);
      g.stroke();
    }
    for (let j = 1; j < rows; j++) {
      const y = (j * c.height) / rows;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(c.width, y);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
}

function hoverHandlers(key: Exclude<HoverKey, null>, setHovered: Props['setHovered']) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(key);
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHovered(null);
    },
  };
}

export function House({ house, sim, hovered, setHovered }: Props) {
  const cellTex = useCellTexture();
  const colors = useMemo(
    () => ({
      wall: readToken('--model-wall'),
      roof: readToken('--model-roof'),
      fascia: readToken('--model-fascia'),
      trim: readToken('--model-trim'),
      shadow: readToken('--color-text'),
      battery: readToken('--color-surface'),
      rim: readToken('--color-blue'),
      white: readToken('--color-surface'),
    }),
    [],
  );

  const rimProps = useMemo(
    () => ({ thickness: 0.03, color: colors.rim, opacity: 0.65, transparent: true }),
    [colors.rim],
  );

  // 12 roof panel transforms (2 rows x 6 columns)
  const panelTransforms = useMemo(() => {
    const out: { framePos: [number, number, number]; cellPos: [number, number, number] }[] = [];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ROOF_ANGLE, 0, 0));
    const cellOffset = new THREE.Vector3(0, 0.022, 0).applyQuaternion(q);
    for (let r = 0; r < PANELS.rows; r++) {
      for (let c = 0; c < PANELS.cols; c++) {
        const local = new THREE.Vector3(
          (c - (PANELS.cols - 1) / 2) * PANELS.pitchX,
          0,
          (r - (PANELS.rows - 1) / 2) * PANELS.pitchS + PANELS.offsetS,
        ).applyQuaternion(q);
        const fp = PANEL_ORIGIN.clone().add(local);
        const cp = fp.clone().add(cellOffset);
        out.push({
          framePos: [fp.x, fp.y, fp.z],
          cellPos: [cp.x, cp.y, cp.z],
        });
      }
    }
    return out;
  }, []);

  const panelFrameGeo = useMemo(() => new THREE.BoxGeometry(1.23, 0.035, 1.58), []);
  const panelCellGeo = useMemo(() => new THREE.BoxGeometry(1.17, 0.014, 1.52), []);
  const panelFrameMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: threeColor('--model-trim'), roughness: 0.88, metalness: 0 }),
    [],
  );
  const panelCellMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.4, metalness: 0.06 }),
    [cellTex],
  );

  const gableShape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(MAIN.z0, 0);
    s.lineTo(MAIN.z1, 0);
    s.lineTo(0, MAIN.ridge - MAIN.wall);
    s.closePath();
    return s;
  }, []);

  // Straight polyline tubes; enough segments for the small rounded corners to stay round.
  const tubeFor = (path: THREE.CurvePath<THREE.Vector3>, r: number) =>
    new THREE.TubeGeometry(path, Math.ceil(path.getLength() * 90) + path.curves.length * 6, r, 12, false);
  // Built at the active radius; the cable shader shrinks it to the idle radius. (Any pass that skips
  // the shader, e.g. the contact-shadow depth pass, still sees a realistic 0.03 tube.)
  const tubes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(CABLES).map(([k, c]) => [k, tubeFor(c, CABLE_R_ACTIVE)]),
      ) as Record<FlowKey, THREE.TubeGeometry>,
    [],
  );
  // Battery cable contact shadow: same route nudged toward the wall and down-right.
  const batteryShadowGeo = useMemo(() => {
    const nudge = new THREE.Vector3(0.012, -0.014, -0.012);
    return tubeFor(cablePath(CABLE_POINTS.battery.map((p) => p.clone().add(nudge))), CABLE_R * 1.15);
  }, []);
  const roofMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: colors.roof, roughness: 0.88, metalness: 0 }),
    [colors.roof],
  );
  const fasciaMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: colors.fascia, roughness: 0.88, metalness: 0 }),
    [colors.fascia],
  );

  const houseHover = hovered === 'house';
  const panelsHover = hovered === 'panels';
  const mw = MAIN.x1 - MAIN.x0;
  const md = MAIN.z1 - MAIN.z0;
  const gw = GARAGE.x1 - GARAGE.x0;
  const gd = GARAGE.z1 - GARAGE.z0;
  const gcx = (GARAGE.x0 + GARAGE.x1) / 2;
  const gDoorH = GARAGE.h - 0.44;
  const gDoorW = gw - 0.68;

  return (
    <group>
      {/* ---------- main architectural volume ---------- */}
      <group {...hoverHandlers('house', setHovered)}>
        <mesh position={[0, MAIN.wall / 2, 0]}>
          <boxGeometry args={[mw, MAIN.wall, md]} />
          <meshStandardMaterial color={colors.wall} roughness={0.9} metalness={0} />
          {houseHover && <Outlines {...rimProps} />}
        </mesh>
        {[MAIN.x0, MAIN.x1].map((x) => (
          <mesh key={x} position={[x, MAIN.wall, 0]} rotation={[0, Math.PI / 2, 0]}>
            <shapeGeometry args={[gableShape]} />
            <meshStandardMaterial color={colors.wall} roughness={0.9} metalness={0} side={THREE.DoubleSide} />
          </mesh>
        ))}

        {/* gabled roof slabs (--model-roof) with fascia boards on eave and rake edges */}
        <RoofSlab
          position={FRONT_SLAB_CENTER}
          rotation={ROOF_ANGLE}
          eaveSign={1}
          roofMat={roofMat}
          fasciaMat={fasciaMat}
          outline={houseHover ? rimProps : null}
        />
        <RoofSlab
          position={new THREE.Vector3(FRONT_SLAB_CENTER.x, FRONT_SLAB_CENTER.y, -FRONT_SLAB_CENTER.z)}
          rotation={-ROOF_ANGLE}
          eaveSign={-1}
          roofMat={roofMat}
          fasciaMat={fasciaMat}
          outline={houseHover ? rimProps : null}
        />
        <mesh position={[0, MAIN.ridge + 0.1, 0]} material={fasciaMat}>
          <boxGeometry args={[ROOF_SLAB.width + 2 * FASCIA.thick, 0.08, 0.22]} />
        </mesh>

        {/* front entrance door (matte architectural relief) */}
        <group position={[DOOR_X, 0, MAIN.z1]}>
          <mesh position={[0, 1.05, 0.01]}>
            <planeGeometry args={[1.0, 2.1]} />
            <meshStandardMaterial color={colors.roof} roughness={0.9} metalness={0} />
          </mesh>
          {[-0.58, 0.58].map((x) => (
            <mesh key={x} position={[x, 1.1, 0.1]} material={fasciaMat}>
              <boxGeometry args={[0.16, 2.2, 0.2]} />
            </mesh>
          ))}
          <mesh position={[0, 2.26, 0.1]} material={fasciaMat}>
            <boxGeometry args={[1.32, 0.14, 0.2]} />
          </mesh>
          <mesh position={[0, 0.05, 0.42]}>
            <boxGeometry args={[1.6, 0.1, 0.68]} />
            <meshStandardMaterial color={colors.trim} roughness={0.9} metalness={0} />
          </mesh>
        </group>

        {/* matte windows (no glow day or night) */}
        {[
          { p: [FRONT_WINDOWS_X[0], 1.55, MAIN.z1] as const, r: 0 },
          { p: [FRONT_WINDOWS_X[1], 1.55, MAIN.z1] as const, r: 0 },
          { p: [MAIN.x0, 1.55, -1.5] as const, r: -Math.PI / 2 },
        ].map(({ p, r }, i) => (
          <group key={i} position={p} rotation={[0, r, 0]}>
            <mesh position={[0, 0, 0.008]}>
              <planeGeometry args={[1.25, 1.35]} />
              <meshStandardMaterial color={colors.roof} roughness={0.88} metalness={0} />
            </mesh>
            {[
              [0, 0.71, 1.37, 0.07],
              [0, -0.71, 1.37, 0.07],
              [-0.65, 0, 0.07, 1.42],
              [0.65, 0, 0.07, 1.42],
              [0, 0, 0.04, 1.35],
            ].map(([x, y, w, h], k) => (
              <mesh key={k} position={[x, y, 0.04]} material={fasciaMat}>
                <boxGeometry args={[w, h, 0.08]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      {/* ---------- dark solar panels (roughness 0.4, only dark element) ---------- */}
      <group {...hoverHandlers('panels', setHovered)}>
        {panelTransforms.map((pt, idx) => (
          <group key={idx}>
            <mesh position={pt.framePos} rotation={[ROOF_ANGLE, 0, 0]} geometry={panelFrameGeo} material={panelFrameMat}>
              {panelsHover && idx === 0 && <Outlines {...rimProps} />}
            </mesh>
            <mesh position={pt.cellPos} rotation={[ROOF_ANGLE, 0, 0]} geometry={panelCellGeo} material={panelCellMat}>
              {panelsHover && <Outlines {...rimProps} />}
            </mesh>
          </group>
        ))}
      </group>

      {/* ---------- attached garage with CLOSED door ---------- */}
      <group {...hoverHandlers('house', setHovered)}>
        <mesh position={[gcx, GARAGE.h + 0.07, (GARAGE.z0 + GARAGE.z1) / 2 + 0.05]} material={roofMat}>
          <boxGeometry args={[gw + 0.2, 0.14, gd + 0.2]} />
          {houseHover && <Outlines {...rimProps} />}
        </mesh>
        {/* garage fascia: front and side edges of the flat roof */}
        <mesh position={[gcx, GARAGE.h + 0.07, (GARAGE.z0 + GARAGE.z1) / 2 + 0.05 + gd / 2 + 0.1 + FASCIA.thick / 2]} material={fasciaMat}>
          <boxGeometry args={[gw + 0.2 + 2 * FASCIA.thick, 0.14, FASCIA.thick]} />
        </mesh>
        <mesh position={[GARAGE.x1 + 0.1 + FASCIA.thick / 2, GARAGE.h + 0.07, (GARAGE.z0 + GARAGE.z1) / 2 + 0.05]} material={fasciaMat}>
          <boxGeometry args={[FASCIA.thick, 0.14, gd + 0.2]} />
        </mesh>
        <mesh position={[gcx, GARAGE.h / 2, 0]}>
          <boxGeometry args={[gw, GARAGE.h, gd]} />
          <meshStandardMaterial color={colors.wall} roughness={0.9} metalness={0} />
          {houseHover && <Outlines {...rimProps} />}
        </mesh>
        {/* recessed closed sectional garage door */}
        <mesh position={[gcx, gDoorH / 2, GARAGE.z1 + 0.008]}>
          <planeGeometry args={[gDoorW, gDoorH]} />
          <meshStandardMaterial color={colors.roof} roughness={0.88} metalness={0} />
        </mesh>
        {/* garage door frame surround */}
        <mesh position={[gcx, gDoorH + 0.04, GARAGE.z1 + 0.03]} material={fasciaMat}>
          <boxGeometry args={[gDoorW + 0.16, 0.08, 0.06]} />
        </mesh>
        {[-gDoorW / 2 - 0.04, gDoorW / 2 + 0.04].map((dx) => (
          <mesh key={dx} position={[gcx + dx, gDoorH / 2, GARAGE.z1 + 0.03]} material={fasciaMat}>
            <boxGeometry args={[0.08, gDoorH, 0.06]} />
          </mesh>
        ))}
        {/* horizontal architectural door panel seams */}
        {[0.25, 0.5, 0.75].map((f) => (
          <mesh key={f} position={[gcx, gDoorH * f, GARAGE.z1 + 0.02]} material={fasciaMat}>
            <boxGeometry args={[gDoorW - 0.04, 0.03, 0.03]} />
          </mesh>
        ))}
      </group>

      {/* ---------- white battery on the front wall, 0.05 off the wall on two brackets ---------- */}
      <group position={BATTERY.pos} {...hoverHandlers('battery', setHovered)}>
        <RoundedBox args={BATTERY.size as unknown as [number, number, number]} radius={0.05} smoothness={4}>
          <meshStandardMaterial color={colors.battery} roughness={0.86} metalness={0} />
          {hovered === 'battery' && <Outlines {...rimProps} />}
        </RoundedBox>
        {[-0.32, 0.32].map((dy) => (
          <mesh
            key={dy}
            position={[0, dy, -BATTERY.size[2] / 2 - BATTERY.wallGap / 2]}
            material={fasciaMat}
          >
            <boxGeometry args={[BATTERY.size[0] * 0.7, 0.05, BATTERY.wallGap]} />
          </mesh>
        ))}
        <BatteryLed house={house} sim={sim} />
      </group>
      {/* soft contact shadow of the battery on the wall behind it */}
      <mesh position={[BATTERY.pos.x + 0.03, BATTERY.pos.y - 0.04, MAIN.z1 + 0.002]}>
        <planeGeometry args={[BATTERY.size[0] + 0.04, BATTERY.size[1] + 0.02]} />
        <meshBasicMaterial color={colors.shadow} transparent opacity={0.07} depthWrite={false} />
      </mesh>

      {/* ---------- meter (--model-trim), flush on the front wall ---------- */}
      <group position={METER.pos} {...hoverHandlers('meter', setHovered)}>
        <RoundedBox args={METER.size as unknown as [number, number, number]} radius={0.02} smoothness={2}>
          <meshStandardMaterial color={colors.trim} roughness={0.88} metalness={0} />
          {hovered === 'meter' && <Outlines {...rimProps} />}
        </RoundedBox>
      </group>

      {/* ---------- cable hardware ---------- */}
      {/* wall gland where the meter -> house cable enters the wall */}
      <mesh position={[WALL_GLAND.x, WALL_GLAND.y, MAIN.z1 + 0.012]} rotation={[Math.PI / 2, 0, 0]} material={fasciaMat}>
        <cylinderGeometry args={[0.032, 0.036, 0.024, 16]} />
      </mesh>
      {/* service drop bracket under the garage eave, with a small insulator at its tip */}
      <mesh position={[GARAGE_BRACKET.x, GARAGE_BRACKET.y, GARAGE.z1 + GARAGE_BRACKET.out / 2]} material={fasciaMat}>
        <boxGeometry args={[0.04, 0.04, GARAGE_BRACKET.out]} />
      </mesh>
      <mesh position={[GARAGE_BRACKET.x, GARAGE_BRACKET.y, GARAGE.z1 + GARAGE_BRACKET.out]} material={fasciaMat}>
        <sphereGeometry args={[0.035, 12, 8]} />
      </mesh>
      {/* junction box at the lowest panel corner, where the solar cable starts */}
      <mesh position={SOLAR_JUNCTION} rotation={[ROOF_ANGLE, 0, 0]} material={fasciaMat}>
        <boxGeometry args={[0.07, 0.03, 0.09]} />
      </mesh>
      {/* battery cable contact shadow on the wall */}
      <mesh geometry={batteryShadowGeo}>
        <meshBasicMaterial color={colors.shadow} transparent opacity={0.16} depthWrite={false} />
      </mesh>

      {/* ---------- utility post (--model-trim) ---------- */}
      <group position={POST.pos} {...hoverHandlers('post', setHovered)}>
        <mesh position={[0, POST.height / 2, 0]}>
          <cylinderGeometry args={[0.07, 0.1, POST.height, 12]} />
          <meshStandardMaterial color={colors.trim} roughness={0.88} metalness={0} />
          {hovered === 'post' && <Outlines {...rimProps} />}
        </mesh>
        <mesh position={[0, POST.height - 0.35, 0]}>
          <boxGeometry args={[1.4, 0.08, 0.1]} />
          <meshStandardMaterial color={colors.trim} roughness={0.88} metalness={0} />
          {hovered === 'post' && <Outlines {...rimProps} />}
        </mesh>
        {[-0.55, 0, 0.55].map((x) => (
          <mesh key={x} position={[x, POST.height - 0.24, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.14, 8]} />
            <meshStandardMaterial color={colors.roof} roughness={0.88} metalness={0} />
          </mesh>
        ))}
      </group>

      {/* ---------- cables: idle thin grey, active thick in the flow colour with a moving segment ---------- */}
      {(Object.keys(tubes) as FlowKey[]).map((k) => (
        <FlowCable key={k} geometry={tubes[k]} kind={k} house={house} sim={sim} />
      ))}
    </group>
  );
}

/** Power on each cable (kW, sign = direction along the cable's points) and its flow colour. */
function cableFlow(
  kind: FlowKey,
  s: Snapshot,
  pal: { solar: THREE.Color; battery: THREE.Color; grid: THREE.Color; neg: THREE.Color },
): { kw: number; color: THREE.Color } {
  switch (kind) {
    case 'solar':
      return { kw: s.solar, color: pal.solar };
    case 'battery':
      return { kw: s.charge - s.discharge, color: pal.battery };
    case 'house': {
      // coloured by the source that covers most of the load right now
      const fromSolar = Math.max(0, s.load - s.discharge - s.imp);
      const color =
        s.discharge >= s.imp && s.discharge >= fromSolar ? pal.battery : s.imp >= fromSolar ? pal.grid : pal.solar;
      return { kw: s.load, color };
    }
    case 'grid':
      return s.exp > 0.005
        ? { kw: s.exp, color: s.price < 0 ? pal.neg : pal.grid }
        : { kw: -s.imp, color: pal.grid };
  }
}

/** Below this |power| a cable is idle. */
const ACTIVE_KW = 0.05;
/** Idle <-> active transition time (s). */
const TRANSITION_S = 0.3;
/** Length of the moving lighter segment, as a share of the cable length. */
const SEGMENT_SHARE = 0.2;
/** Power at which the segment reaches its top speed (kW). */
const FULL_SPEED_KW = 3.5;

/**
 * Cable with a readable energy direction. Idle: thin (0.012) in --model-cable. Active: thick (0.03)
 * solid flow colour, plus one lighter segment (20 % of the path, flow colour 50 % toward white)
 * travelling along the energy direction at 0.25-1.0 path lengths per second, scaled with power.
 * Flat shading only: no glow, bloom, emissive halo or particles.
 */
function FlowCable({
  geometry,
  kind,
  house,
  sim,
}: {
  geometry: THREE.TubeGeometry;
  kind: FlowKey;
  house: HouseData;
  sim: Sim;
}) {
  const pal = useMemo(
    () => ({
      solar: threeColor('--color-yellow'),
      battery: threeColor('--color-blue'),
      grid: threeColor('--color-inactive'),
      neg: threeColor('--color-negative'),
    }),
    [],
  );
  const idleColor = useMemo(() => threeColor('--model-cable'), []);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        toneMapped: false,
        uniforms: {
          uRadius: { value: CABLE_R },
          uBuiltRadius: { value: CABLE_R_ACTIVE },
          uColor: { value: idleColor.clone() },
          uSegColor: { value: idleColor.clone() },
          uSegAmount: { value: 0 },
          uHead: { value: 0 },
          uDir: { value: 1 },
          uSegLen: { value: SEGMENT_SHARE },
        },
        vertexShader: /* glsl */ `
          uniform float uRadius;
          uniform float uBuiltRadius;
          varying vec2 vUv;
          varying vec3 vNormalW;
          void main() {
            vUv = uv;
            vNormalW = normalize(mat3(modelMatrix) * normal);
            // The tube is built at uBuiltRadius around the centre line; move each vertex to uRadius.
            vec3 p = position + normal * (uRadius - uBuiltRadius);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform vec3 uSegColor;
          uniform float uSegAmount;
          uniform float uHead;
          uniform float uDir;
          uniform float uSegLen;
          varying vec2 vUv;
          varying vec3 vNormalW;
          void main() {
            float diff = 0.84 + 0.16 * clamp(dot(vNormalW, normalize(vec3(-0.3, 0.9, 0.4))), 0.0, 1.0);
            // Distance behind the segment's leading edge, measured against the flow direction.
            float d = fract((uHead - vUv.x) * uDir);
            float seg = smoothstep(0.0, 0.01, d) * (1.0 - smoothstep(uSegLen - 0.01, uSegLen, d));
            vec3 col = mix(uColor, uSegColor, seg * uSegAmount) * diff;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    [idleColor],
  );

  const active = useRef(0); // 0 idle .. 1 active, linear over TRANSITION_S
  const flowColor = useRef(new THREE.Color().copy(idleColor));
  const head = useRef(0);
  const dir = useRef(1);
  const tmp = useMemo(() => ({ seg: new THREE.Color(), white: new THREE.Color(1, 1, 1) }), []);

  useFrame((_, dt) => {
    const s = snapshot(house, sim, timeStore.get());
    const f = cableFlow(kind, s, pal);
    const mag = Math.abs(f.kw);
    const target = mag >= ACTIVE_KW ? 1 : 0;
    const step = Math.min(1, dt / TRANSITION_S);
    const gap = target - active.current;
    active.current += Math.sign(gap) * Math.min(Math.abs(gap), step);
    if (target === 1) {
      // snap the colour when starting from idle, otherwise blend over the same 300 ms
      flowColor.current.lerp(f.color, active.current <= step + 1e-6 ? 1 : step);
      dir.current = f.kw >= 0 ? 1 : -1;
    }
    const a = active.current;

    // Speed: 0.25 .. 1.0 path lengths per second, scaled with power
    const speed = 0.25 + 0.75 * Math.min(1, mag / FULL_SPEED_KW);
    if (!prefersReducedMotion()) head.current = (head.current + dir.current * speed * dt + 1) % 1;

    // Lighter segment: flow colour mixed 50 % toward white (in sRGB, as seen)
    tmp.seg.copy(flowColor.current).convertLinearToSRGB().lerp(tmp.white, 0.5).convertSRGBToLinear();

    mat.uniforms.uRadius.value = CABLE_R + (CABLE_R_ACTIVE - CABLE_R) * a;
    mat.uniforms.uColor.value.copy(idleColor).lerp(flowColor.current, a);
    mat.uniforms.uSegColor.value.copy(tmp.seg);
    mat.uniforms.uSegAmount.value = a;
    mat.uniforms.uHead.value = head.current;
    mat.uniforms.uDir.value = dir.current;
  });

  return <mesh geometry={geometry} material={mat} />;
}

/** Steady blue LED strip showing only the current charge level (%). */
function BatteryLed({ house, sim }: { house: HouseData; sim: Sim }) {
  const stripH = BATTERY.size[1] - 0.16;
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        toneMapped: false,
        uniforms: {
          uLevel: { value: 0.5 },
          uHeight: { value: stripH },
          uColor: { value: threeColor('--color-blue') },
          uOff: { value: threeColor('--model-trim') },
        },
        vertexShader: /* glsl */ `
          uniform float uHeight;
          varying float vH;
          void main() {
            vH = clamp(position.y / uHeight + 0.5, 0.0, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uLevel;
          uniform vec3 uColor;
          uniform vec3 uOff;
          varying float vH;
          void main() {
            float lit = 1.0 - smoothstep(uLevel - 0.008, uLevel + 0.008, vH);
            vec3 col = mix(uOff, uColor, lit);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    [stripH],
  );
  const level = useRef(0.5);
  useFrame((_, dt) => {
    const s = snapshot(house, sim, timeStore.get());
    const k = 1 - Math.exp(-dt * 8);
    level.current += (s.socPct / 100 - level.current) * k;
    mat.uniforms.uLevel.value = level.current;
  });

  return (
    <mesh position={[-BATTERY.size[0] / 2 + 0.12, 0, BATTERY.size[2] / 2 - 0.012]} material={mat}>
      <boxGeometry args={[0.042, stripH, 0.042]} />
    </mesh>
  );
}

/** Roof slab (--model-roof) with fascia boards (--model-fascia) on the eave and both rake edges. */
function RoofSlab({
  position,
  rotation,
  eaveSign,
  roofMat,
  fasciaMat,
  outline,
}: {
  position: THREE.Vector3;
  rotation: number;
  eaveSign: 1 | -1; // local z side of the eave
  roofMat: THREE.Material;
  fasciaMat: THREE.Material;
  outline: React.ComponentProps<typeof Outlines> | null;
}) {
  const { width, length, thick } = ROOF_SLAB;
  const f = FASCIA.thick;
  return (
    <group position={position} rotation={[rotation, 0, 0]}>
      <mesh material={roofMat}>
        <boxGeometry args={[width, thick, length]} />
        {outline && <Outlines {...outline} />}
      </mesh>
      <mesh position={[0, 0, eaveSign * (length / 2 + f / 2)]} material={fasciaMat}>
        <boxGeometry args={[width + 2 * f, thick, f]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 + f / 2), 0, 0]} material={fasciaMat}>
          <boxGeometry args={[f, thick, length]} />
        </mesh>
      ))}
    </group>
  );
}
