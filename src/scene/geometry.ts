import * as THREE from 'three';

// World layout (metres-ish). Ground at y = 0. Main house front faces +z.
export const MAIN = { x0: -4, x1: 4, z0: -3, z1: 3, wall: 2.8, ridge: 4.6 };
export const GARAGE = { x0: 4, x1: 8.2, z0: -2.6, z1: 2.6, h: 2.6 };
export const ROOF_ANGLE = Math.atan((MAIN.ridge - MAIN.wall) / (MAIN.z1 - 0)); // ~31°

// Front wall openings (x centres). Frames: window 1.25 + 2 x 0.07, door 1.0 + 2 x 0.16.
export const DOOR_X = 0.2;
export const FRONT_WINDOWS_X = [-2.4, 1.95] as const;

// Service corner on the front wall, garage side (blank wall between the right window and the corner).
// Meter: >= 0.4 from the window frame (frame edge 2.635, meter edge 3.23).
// Battery: 0.29 in from the wall corner (x = 4), back face 0.05 off the wall.
export const METER = { pos: new THREE.Vector3(3.4, 1.85, MAIN.z1 + 0.08), size: [0.34, 0.46, 0.16] as const };
export const BATTERY = {
  pos: new THREE.Vector3(3.4, 0.8, MAIN.z1 + 0.05 + 0.09),
  size: [0.62, 1.1, 0.18] as const,
  wallGap: 0.05,
};
export const POST = { pos: new THREE.Vector3(9.6, 0, 3.6), height: 3.8 };

// Roof front slab frame
const slopeDown = new THREE.Vector3(0, -Math.sin(ROOF_ANGLE), Math.cos(ROOF_ANGLE));
const slopeNormal = new THREE.Vector3(0, Math.cos(ROOF_ANGLE), Math.sin(ROOF_ANGLE));
export const ROOF_SLAB = { length: 3.85, width: 8.7, thick: 0.14 };
export const FASCIA = { thick: 0.04 }; // board on the slab end and side faces, flush with top and bottom
export const FRONT_SLAB_CENTER = new THREE.Vector3(0, (MAIN.ridge + MAIN.wall) / 2, MAIN.z1 / 2)
  .addScaledVector(slopeDown, 0.175)
  .addScaledVector(slopeNormal, ROOF_SLAB.thick / 2);
export const PANEL_ORIGIN = FRONT_SLAB_CENTER.clone().addScaledVector(slopeNormal, ROOF_SLAB.thick / 2 + 0.05);
export const SLOPE_NORMAL = slopeNormal;
export const SLOPE_DOWN = slopeDown;

// Panel array: 2 rows x 6 columns, frame 1.23 x 1.58, pitch 1.27 x 1.62 (local x, down-slope)
export const PANELS = { cols: 6, rows: 2, pitchX: 1.27, pitchS: 1.62, offsetS: 0.05, w: 1.23, l: 1.58 };
const ARRAY_RIGHT_X = ((PANELS.cols - 1) / 2) * PANELS.pitchX + PANELS.w / 2; // 3.79
const ARRAY_LOW_S = ((PANELS.rows - 1) / 2) * PANELS.pitchS + PANELS.offsetS + PANELS.l / 2; // 1.65

/** Point on the front roof slab: x across, s down-slope from the slab centre, h along the slab normal from its mid-plane. */
export function roofPoint(x: number, s: number, h: number): THREE.Vector3 {
  return FRONT_SLAB_CENTER.clone()
    .add(new THREE.Vector3(x, 0, 0))
    .addScaledVector(slopeDown, s)
    .addScaledVector(slopeNormal, h);
}

// ---------- cables ----------
/** Tube radius (was 0.026). */
export const CABLE_R = 0.015;
/** Centre-line offset from the surface a cable is fixed to: radius + 2.5 mm. */
const OFF = CABLE_R + 0.0025;
/** Radius of the small rounded corners between straight cable runs. */
export const CABLE_CORNER_R = 0.04;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const WALL_Z = MAIN.z1 + OFF; // flush on the front wall
const meterTop = METER.pos.y + METER.size[1] / 2;
const meterLeft = METER.pos.x - METER.size[0] / 2;
const meterRight = METER.pos.x + METER.size[0] / 2;

// Solar: lowest corner of the array (bottom-right panel) -> along the frame edge to the eave ->
// over the fascia -> under the soffit to the wall -> down the front wall -> meter top.
const SOLAR_X = ARRAY_RIGHT_X + 0.04; // beside the frame edge, never over a panel
const SLAB_END = ROOF_SLAB.length / 2 + FASCIA.thick + OFF; // outside the eave fascia
const TOP_H = ROOF_SLAB.thick / 2 + OFF;
const BOTTOM_H = -(ROOF_SLAB.thick / 2 + OFF);
/** s at which the soffit run meets the wall plane z = WALL_Z. */
const SOFFIT_S = (WALL_Z - FRONT_SLAB_CENTER.z - slopeNormal.z * BOTTOM_H) / slopeDown.z;
export const SOLAR_JUNCTION = roofPoint(SOLAR_X + 0.015, ARRAY_LOW_S - 0.32, ROOF_SLAB.thick / 2 + 0.02);

// Service drop: house-side insulator on the post crossarm -> bracket under the front eave.
export const DROP_BRACKET = { x: 3.28, y: 2.3, out: 0.15 };
export const POST_INSULATOR = v(POST.pos.x - 0.55, POST.height - 0.17 + OFF, POST.pos.z);

// Meter -> house: enters the wall through a gland just left of the meter.
export const WALL_GLAND = v(2.98, 1.92, MAIN.z1);

/** Cable polylines (straight runs only). Point order = positive flow direction. */
export const CABLE_POINTS = {
  // panels -> meter
  solar: [
    roofPoint(SOLAR_X, ARRAY_LOW_S - 0.3, TOP_H),
    roofPoint(SOLAR_X, SLAB_END, TOP_H),
    roofPoint(SOLAR_X, SLAB_END, BOTTOM_H),
    roofPoint(SOLAR_X, SOFFIT_S, BOTTOM_H),
    v(SOLAR_X, 2.2, WALL_Z),
    v(3.5, 2.2, WALL_Z),
    v(3.5, meterTop - 0.02, WALL_Z),
  ],
  // meter -> battery (meter right side, along the wall, up into the battery bottom)
  battery: [
    v(meterRight - 0.02, 1.72, WALL_Z),
    v(3.88, 1.72, WALL_Z),
    v(3.88, 0.15, WALL_Z),
    v(3.55, 0.15, WALL_Z),
    v(3.55, 0.15, BATTERY.pos.z),
    v(3.55, BATTERY.pos.y - BATTERY.size[1] / 2 + 0.02, BATTERY.pos.z),
  ],
  // meter -> house (wall gland)
  house: [
    v(meterLeft + 0.02, WALL_GLAND.y, WALL_Z),
    v(WALL_GLAND.x, WALL_GLAND.y, WALL_Z),
    v(WALL_GLAND.x, WALL_GLAND.y, MAIN.z1 - 0.01),
  ],
  // meter -> utility post: up the wall to the eave bracket, then one straight overhead span
  grid: [
    v(DROP_BRACKET.x, meterTop - 0.02, WALL_Z),
    v(DROP_BRACKET.x, DROP_BRACKET.y, WALL_Z),
    v(DROP_BRACKET.x, DROP_BRACKET.y, MAIN.z1 + DROP_BRACKET.out),
    POST_INSULATOR.clone(),
  ],
};

export type FlowKey = keyof typeof CABLE_POINTS;

/**
 * Straight cable route: LineCurve3 runs joined by small rounded corners (a quadratic fillet
 * of CABLE_CORNER_R, shortened on short runs). No curve between vertices, so nothing sags.
 */
export function cablePath(points: THREE.Vector3[], cornerR = CABLE_CORNER_R): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let from = points[0].clone();
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!next) {
      path.add(new THREE.LineCurve3(from, p.clone()));
      break;
    }
    const inLen = p.distanceTo(points[i - 1]);
    const outLen = p.distanceTo(next);
    const r = Math.min(cornerR, inLen / 2, outLen / 2);
    const a = p.clone().addScaledVector(points[i - 1].clone().sub(p).normalize(), r);
    const b = p.clone().addScaledVector(next.clone().sub(p).normalize(), r);
    if (from.distanceTo(a) > 1e-5) path.add(new THREE.LineCurve3(from, a));
    path.add(new THREE.QuadraticBezierCurve3(a, p.clone(), b));
    from = b;
  }
  return path;
}

export const CABLES = Object.fromEntries(
  Object.entries(CABLE_POINTS).map(([k, pts]) => [k, cablePath(pts)]),
) as Record<FlowKey, THREE.CurvePath<THREE.Vector3>>;

// Label / tooltip anchors
export const ANCHORS = {
  solar: PANEL_ORIGIN.clone().add(new THREE.Vector3(-1.85, 0, 0)).addScaledVector(slopeDown, -0.35),
  // centre of the front wall, above the door
  house: new THREE.Vector3(DOOR_X, (2.33 + MAIN.wall) / 2, MAIN.z1 + 0.02),
  battery: BATTERY.pos.clone().add(new THREE.Vector3(0, -BATTERY.size[1] / 2 - 0.04, 0)),
  batteryCenter: BATTERY.pos.clone(),
  meter: METER.pos.clone().add(new THREE.Vector3(0, 0.3, 0.1)),
  grid: POST.pos.clone().add(new THREE.Vector3(0, 0.02, 0)),
  postTop: POST.pos.clone().add(new THREE.Vector3(0, POST.height, 0)),
  window: new THREE.Vector3(FRONT_WINDOWS_X[0], 1.55, MAIN.z1 + 0.06),
};

// Camera: 3/4 front-left view, ~25° elevation, fov 28
export const TARGET = new THREE.Vector3(2.4, 1.85, 0.7);
export const CAM_AZIMUTH = (-34 * Math.PI) / 180;
export const CAM_ELEV = (25 * Math.PI) / 180;
export const CAM_DIST = 25.5;
export const CAM_POS = TARGET.clone().add(
  new THREE.Vector3(
    Math.sin(CAM_AZIMUTH) * Math.cos(CAM_ELEV),
    Math.sin(CAM_ELEV),
    Math.cos(CAM_AZIMUTH) * Math.cos(CAM_ELEV),
  ).multiplyScalar(CAM_DIST),
);

// Time of day helpers (h = hour as float)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function nightness(h: number) {
  return Math.min(1, smooth(17.5, 19.5, h) + (1 - smooth(5.8, 7.4, h)));
}
export function sunElevation(h: number) {
  if (h <= 7 || h >= 19) return 0;
  return Math.sin((Math.PI * (h - 7)) / 12);
}
