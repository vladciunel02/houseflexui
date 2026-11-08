import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { House, type HoverKey } from './House';
import { AnchorProjector, SceneLabels, useLabelRefs } from './Labels';
import {
  CAM_AZIMUTH,
  CAM_DIST,
  CAM_POS,
  GARAGE,
  MAIN,
  TARGET,
  computeFraming,
  nightness,
  sunElevation,
  type Framing,
} from './geometry';
import { CLOUD_MINUTES, type House as HouseData, type Sim } from '../data/mockFleet';
import { timeStore, prefersReducedMotion } from '../state/time';
import { readToken } from '../styles/tokens';

interface Props {
  house: HouseData;
  sim: Sim;
  cloudStart: number | null;
}

/** Padding around the model's projected bounds inside the canvas (px). */
const FRAME_PAD_X = 48;
// Vertical padding also holds the label slots above the ridge (two-line labels), so it is 68 px.
const FRAME_PAD_Y = 68;

// House footprint (main volume + garage) for the contact shadow
const FOOT = {
  cx: (MAIN.x0 + GARAGE.x1) / 2,
  cz: (MAIN.z0 + MAIN.z1) / 2,
  w: GARAGE.x1 - MAIN.x0,
  d: MAIN.z1 - MAIN.z0,
};
// Shadow plane centred on the origin that still covers the 1.4x footprint (centred on FOOT)
const SHADOW_W = 2 * (Math.abs(FOOT.cx) + (FOOT.w * 1.4) / 2);
const SHADOW_D = 2 * (Math.abs(FOOT.cz) + (FOOT.d * 1.4) / 2);

/** One hemisphere light (sky white, ground roof grey) + one directional sun light; 35% dimmer at night. */
function Lights({ house, sim }: { house: HouseData; sim: Sim }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const skyWhite = useMemo(() => readToken('--color-surface'), []);
  const groundGrey = useMemo(() => readToken('--model-roof'), []);

  useFrame(() => {
    const m = timeStore.get();
    const h = m / 60;
    const idx = Math.min(95, Math.floor(m / 15));
    const elev = sunElevation(h);
    const clearSolar = house.solarClear[idx];
    const cloud = clearSolar > 0 ? Math.min(1, sim.solarClear[idx] / clearSolar) : 1;
    const nightDim = 1 - 0.35 * nightness(h); // lower intensity by 35% only after sunset

    // Sun angle follows simulated time across the sky
    const dayProg = Math.min(1, Math.max(0, (h - 6.5) / 13));
    const a = Math.PI * dayProg;
    if (sun.current) {
      const yPos = elev > 0 ? 5 + Math.sin(a) * 14 : 11;
      const xPos = elev > 0 ? -Math.cos(a) * 15 + 2 : -9;
      sun.current.position.set(xPos, yPos, 11 - Math.sin(a) * 3);
      sun.current.intensity = 1.45 * cloud * nightDim;
    }
    if (hemi.current) {
      hemi.current.intensity = 2.55 * (0.88 + 0.12 * cloud) * nightDim;
    }
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={[skyWhite, groundGrey, 2.55]} />
      <directionalLight ref={sun} color={skyWhite} position={[-8, 14, 10]} intensity={1.45} />
    </>
  );
}

/** Soft drifting cloud silhouette during the 45-minute simulated cloud dip. */
function Cloud({ cloudStart }: { cloudStart: number | null }) {
  const tex = useMemo(() => {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const puffs = [
      [64, 64, 52],
      [40, 70, 34],
      [88, 60, 38],
      [60, 48, 30],
    ];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let a = 0;
        for (const [cx, cy, r] of puffs) {
          const dx = (x - cx) / r;
          const dy = (y - cy) / r;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            const w = 1 - d2;
            a = Math.min(1, a + w * w * 0.5);
          }
        }
        const idx = (y * size + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(a * 255);
      }
    }
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, []);

  const cloudColor = useMemo(() => readToken('--model-trim'), []);
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (!ref.current || !mat.current) return;
    const m = timeStore.get();
    const p = cloudStart == null ? -1 : (m - cloudStart) / CLOUD_MINUTES;
    const active = p >= 0 && p <= 1;
    ref.current.visible = active;
    if (!active) return;
    ref.current.position.x = -10 + p * 26;
    mat.current.opacity = Math.sin(Math.PI * p) * 0.55;
  });

  return (
    <mesh ref={ref} position={[0, 7.2, 1]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <planeGeometry args={[11, 7]} />
      <meshBasicMaterial ref={mat} map={tex} transparent depthWrite={false} color={cloudColor} />
    </mesh>
  );
}

function Controls({ resetSignal }: { resetSignal: number }) {
  const ref = useRef<OrbitControlsImpl>(null);
  const resetting = useRef(false);
  const { camera } = useThree();
  useEffect(() => {
    if (resetSignal > 0) resetting.current = true;
  }, [resetSignal]);
  useFrame((_, dt) => {
    if (!resetting.current || !ref.current) return;
    const k = prefersReducedMotion() ? 1 : 1 - Math.exp(-dt * 6);
    camera.position.lerp(CAM_POS, k);
    ref.current.target.lerp(TARGET, k);
    ref.current.update();
    if (camera.position.distanceTo(CAM_POS) < 0.01) resetting.current = false;
  });
  const range = Math.PI / 6;
  return (
    <OrbitControls
      ref={ref}
      target={TARGET}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minAzimuthAngle={CAM_AZIMUTH - range}
      maxAzimuthAngle={CAM_AZIMUTH + range}
      minPolarAngle={(55 * Math.PI) / 180}
      maxPolarAngle={(75 * Math.PI) / 180}
      minDistance={CAM_DIST / 1.15}
      maxDistance={CAM_DIST / 0.85}
      onStart={() => (resetting.current = false)}
    />
  );
}

/** Applies the canvas framing: fov and a view offset that centres the model (camera pose unchanged). */
function FrameCamera({ framing }: { framing: Framing }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = framing.fov;
    camera.setViewOffset(size.width, size.height, framing.offsetX, framing.offsetY, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, framing, size.width, size.height]);
  return null;
}

export const HouseScene = memo(function HouseScene({ house, sim, cloudStart }: Props) {
  const [hovered, setHovered] = useState<HoverKey>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const refs = useLabelRefs();
  const shadowColor = useMemo(() => readToken('--color-text'), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const [framing, setFraming] = useState<Framing>(() => computeFraming(800, FRAME_PAD_X, FRAME_PAD_Y));

  // Canvas height = the model's projected height + padding, recomputed when the stage width changes
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      if (w > 0) setFraming((f) => (f.width === w ? f : computeFraming(w, FRAME_PAD_X, FRAME_PAD_Y)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => void (document.body.style.cursor = ''), []);

  return (
    <>
      <div className="scene-canvas-host" ref={hostRef} style={{ height: framing.height }}>
        <Canvas
          dpr={[1, 2]}
          camera={{ fov: framing.fov, position: CAM_POS.toArray(), near: 1, far: 140 }}
          gl={{
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.NoToneMapping,
          }}
          onCreated={({ gl }) => {
            // Transparent canvas (clear alpha 0, nothing drawn behind the model): the page shows through
            gl.setClearColor(readToken('--color-page'), 0);
          }}
          onPointerMissed={() => setHovered(null)}
        >
          <FrameCamera framing={framing} />
          <Lights house={house} sim={sim} />
          <House house={house} sim={sim} hovered={hovered} setHovered={setHovered} />
          {/* Contact shadow, 0.001 below the house base, covering 1.4x the house footprint. Placed at
              the world origin: away from x = z = 0 drei's ContactShadows draws its shadow shifted by its
              offset (it showed as a dark patch beside the house), so the plane is widened instead. */}
          <ContactShadows
            frames={1}
            position={[0, -0.001, 0]}
            scale={[SHADOW_W, SHADOW_D]}
            opacity={0.3}
            blur={2}
            far={4}
            resolution={1024}
            color={shadowColor}
          />
          <Cloud cloudStart={cloudStart} />
          <AnchorProjector refs={refs} hovered={hovered} />
          <Controls resetSignal={resetSignal} />
        </Canvas>
        <SceneLabels refs={refs} hovered={hovered} house={house} sim={sim} />
      </div>
      {/* 16px under the canvas, bottom-left */}
      <div className="scene-bottom">
        <button type="button" className="btn-tertiary" onClick={() => setResetSignal((n) => n + 1)}>
          Resetează vederea
        </button>
      </div>
    </>
  );
});
