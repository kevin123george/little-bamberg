import * as THREE from "three";
import * as CANNON from "cannon-es";
import { Sky } from "./vendor/Sky.js"; // vendored copy with a lowered sun-intensity constant -- see that file's comment
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import bambergData from "./bamberg-map-data.json";
import muenchenData from "./maps/muenchen.json";
import nuernbergData from "./maps/nuernberg.json";
import wuerzburgData from "./maps/wuerzburg.json";
import regensburgData from "./maps/regensburg.json";
import erlangenData from "./maps/erlangen.json";
import augsburgData from "./maps/augsburg.json";
import bayernData from "./maps/bayern.json";
import bavariaOutline from "./bavaria.json";

// ================= Which city (Little Bavaria) =================
// Bamberg keeps its hand-built landmarks; every other city comes from scripts/build_cities.py (OpenStreetMap) with
// a "meta" block (names, landmark texts, kinds, points, river width, hills), so it needs no code of its own.
// The city is chosen with ?city=<id> (the travel map sets it); the last one played is remembered.
type CityMeta = {
  id: string; name_en: string; name_ml: string; latlon: number[]; river_half_width: number;
  hills: { cx: number; cz: number; r: number; h: number }[];
  landmarks: { id: string; kind: string; points: number; label_en: string; flavor_en: string; label_ml: string; flavor_ml: string }[];
  // the Bavaria overview ("road trip") only:
  overview?: boolean; m_per_unit?: number; outline?: number[][]; rivers?: number[][][];
  lakes?: { cx: number; cz: number; rx: number; rz: number }[]; portals?: { id: string; x: number; z: number }[];
};
const CITY_MAPS: Record<string, any> = {
  bamberg: bambergData, muenchen: muenchenData, nuernberg: nuernbergData, wuerzburg: wuerzburgData,
  regensburg: regensburgData, erlangen: erlangenData, augsburg: augsburgData, bayern: bayernData,
};
const BAMBERG_META: CityMeta = { id: "bamberg", name_en: "Bamberg", name_ml: "ബാംബെർഗ്", latlon: [49.8918, 10.8869], river_half_width: 6, hills: [], landmarks: [] };
const CITY_ID: string = (() => {
  let id = new URLSearchParams(location.search).get("city") || "";
  if (!CITY_MAPS[id]) { try { id = localStorage.getItem("littleBamberg.city") || ""; } catch (e) {} }
  if (!CITY_MAPS[id]) id = "bamberg";
  try { localStorage.setItem("littleBamberg.city", id); } catch (e) {}
  return id;
})();
const IS_BAMBERG = CITY_ID === "bamberg";
const mapData = CITY_MAPS[CITY_ID];
const CITY: CityMeta = mapData.meta ?? BAMBERG_META;
const IS_OVERVIEW = !!CITY.overview;
const ALL_CITIES: CityMeta[] = Object.keys(CITY_MAPS).map((k) => CITY_MAPS[k].meta ?? BAMBERG_META).filter((c) => !c.overview);

// Real modeled assets (CC0, Kenney.nl -- "Car Kit" and "Blocky Characters")
// instead of hand-built box primitives. Fetches start immediately here so
// they run in parallel with the (CPU-only, no-network) map/building
// generation below; they're only actually awaited right before the kart and
// avatar meshes are built, further down this file.
const gltfLoader = new GLTFLoader();
const CHARACTER_VARIANTS = ["a", "b", "c", "d", "e", "f"];
const kartGltfPromise = gltfLoader.loadAsync("./models/kart/kart-oobi.glb");
const characterGltfPromises = CHARACTER_VARIANTS.map((v) => gltfLoader.loadAsync(`./models/characters/character-${v}.glb`));

// The 3D town keeps ONE palette whatever the page theme is (dark mode used to swap in muddy
// grass, a dark river and cream "timber"); day vs night is the lighting's job, not the colours'.
const WORLD_PALETTE: Record<string, string> = {
  "--sandstone": "#e6cda6", "--sandstone-deep": "#cfae7e", "--regnitz": "#3d8a90", "--regnitz-deep": "#23585c",
  "--roof": "#b8573f", "--timber": "#4a3526", "--grass": "#8aa75e", "--grass-deep": "#6f8c47",
  "--facade-yellow": "#ecc973", "--facade-pink": "#e3a3a9", "--facade-blue": "#a6c2d2", "--facade-cream": "#f4e9cf",
  "--facade-teal": "#8cb3a0", "--gold": "#c9922f", "--gold-bright": "#e2ae45", "--fog": "#d8cdb4",
};
function cssVar(name: string): string {
  return WORLD_PALETTE[name] ?? getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Footprint = number[][]; // each entry is [x, z]; matches the shape JSON imports infer

// ================= Real Bamberg geometry (from OpenStreetMap) =================
// Coordinates are local meters, compressed from real OSM data (see
// scale_note in bamberg-map-data.json), origin = the Altes Rathaus's own
// centroid. Building footprints, the Regnitz's real course, and every
// landmark's real relative position all come from this data -- nothing
// here is invented, only the extruded heights and decorative details are.
const MAP = mapData as {
  landmarks: Record<string, { footprint?: Footprint; center: number[] }>;
  river_polyline: Footprint;
  scatter_buildings: { footprint: Footprint }[];
  roads: { line: Footprint; width: number }[];
};

const HALF = IS_OVERVIEW ? 600 : 290; // map half-extent, x/z in [-HALF, HALF] -- sized to the real old-town spread (all of Bavaria in the overview)

function hillBump(x: number, z: number, cx: number, cz: number, radius: number, height: number): number {
  const d = Math.hypot(x - cx, z - cz);
  if (d > radius) return 0;
  let t = 1 - d / radius;
  t = t * t * (3 - 2 * t);
  return height * t;
}
// Domberg centered on the real Dom; Michaelsberg centered on the real
// Michaelsberger Garten -- both hillBump()'d the same stylized way as
// before, just anchored to their real positions now instead of invented ones.
const DOMBERG = IS_BAMBERG ? { cx: MAP.landmarks.dom!.center[0]!, cz: MAP.landmarks.dom!.center[1]!, r: 100, h: 17 } : { cx: 0, cz: 0, r: 1, h: 0 };
const MICHAELSBERG = { cx: -264, cz: -138, r: 90, h: 14 };
const CITY_HILLS = IS_BAMBERG ? [DOMBERG, MICHAELSBERG] : CITY.hills;
function terrainHeight(x: number, z: number): number {
  let y = 0;
  for (const hl of CITY_HILLS) y += hillBump(x, z, hl.cx, hl.cz, hl.r, hl.h);
  return y;
}

const RIVER_HALF_W = IS_BAMBERG ? 6 : (CITY.river_half_width || 6); // half-width of the extruded river ribbon, in scaled meters

// A spot near (x0, z0) that isn't inside a building, a landmark or the river (spiral search), for spawns.
function pointInPoly(x: number, z: number, f: Footprint): boolean {
  let inside = false;
  for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
    const [xi, zi] = f[i] as [number, number], [xj, zj] = f[j] as [number, number];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function freeSpot(x0: number, z0: number): { x: number; z: number } {
  // prefer a point on a real street near (x0, z0): courtyards are "free" too, but you can't see or leave them
  const polysAll: Footprint[] = [...MAP.scatter_buildings.map((b) => b.footprint), ...Object.values(MAP.landmarks).map((l) => l.footprint || []).filter((f) => f.length >= 3)];
  const clear = (x: number, z: number) => distToRiver(x, z) >= RIVER_HALF_W + 4 &&
    !polysAll.some((f) => pointInPoly(x, z, f) || pointInPoly(x + 3, z, f) || pointInPoly(x - 3, z, f) || pointInPoly(x, z + 3, f) || pointInPoly(x, z - 3, f));
  const roadPts = MAP.roads.flatMap((r) => r.line).map((p) => ({ x: p[0]!, z: p[1]!, d: Math.hypot(p[0]! - x0, p[1]! - z0) }))
    .filter((p) => p.d < 120).sort((a, b) => a.d - b.d);
  for (const p of roadPts) if (clear(p.x, p.z)) return { x: p.x, z: p.z };
  const polys: Footprint[] = [...MAP.scatter_buildings.map((b) => b.footprint), ...Object.values(MAP.landmarks).map((l) => l.footprint || []).filter((f) => f.length >= 3)];
  for (let r = 0; r < 160; r += 2) {
    for (let a = 0; a < 16; a++) {
      const x = x0 + Math.cos((a / 16) * Math.PI * 2) * r, z = z0 + Math.sin((a / 16) * Math.PI * 2) * r;
      if (distToRiver(x, z) < RIVER_HALF_W + 4) continue;
      if (!polys.some((f) => pointInPoly(x, z, f) || pointInPoly(x + 3, z, f) || pointInPoly(x - 3, z, f) || pointInPoly(x, z + 3, f) || pointInPoly(x, z - 3, f))) return { x, z };
    }
  }
  return { x: x0, z: z0 };
}

// Nearest distance from (x,z) to the real river polyline -- used to keep
// trees and scatter buildings from sprouting out of the water.
const RIVER_LINES: Footprint[] = [MAP.river_polyline, ...(CITY.rivers || [])].filter((l) => l.length >= 2);
function distToRiver(x: number, z: number): number {
  let best = Infinity;
  for (const line of RIVER_LINES)
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]!, [bx, bz] = line[i + 1]!;
    const abx = bx - ax, abz = bz - az;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((x - ax) * abx + (z - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + abx * t, pz = az + abz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

// Build a THREE.Shape from a real footprint. ShapeGeometry/ExtrudeGeometry
// work in the shape's local XY, and the rotateX(-PI/2) used throughout this
// file maps local Y to world Z NEGATED -- negate z here once, centrally,
// rather than at every call site (same trick as the river ribbon).
function footprintShape(footprint: Footprint): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(footprint[0]![0], -footprint[0]![1]);
  for (let i = 1; i < footprint.length; i++) shape.lineTo(footprint[i]![0], -footprint[i]![1]);
  shape.closePath();
  return shape;
}

// A procedural window-grid texture (canvas-drawn, no asset file) applied to
// every building wall -- solid flat colors were the same "made of boxes"
// problem the kart had, just for buildings. Windows are drawn dark on a
// white ground so the material's own `color` still tints the wall; the
// window cells stay dark regardless of that tint.
// Both the wall color map and its emissive night-glow counterpart share the
// same window rectangle, just inverted: dark-on-white for the day map (lets
// `material.color` tint the wall), bright-on-black for the emissive map
// (emissiveMap multiplies the emissive color per-texel, so only the window
// texels should be non-black or the whole wall glows).
function createWindowTextures(): { day: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  // One tile = 4x4 windows, so a building's windows don't all light up together at night.
  const cell = 64, n = 4, size = cell * n;
  const w = cell * 0.42, h = cell * 0.56;
  const dayCanvas = document.createElement("canvas");
  dayCanvas.width = size; dayCanvas.height = size;
  const d = dayCanvas.getContext("2d")!;
  d.fillStyle = "#ffffff"; d.fillRect(0, 0, size, size);
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = size; glowCanvas.height = size;
  const g = glowCanvas.getContext("2d")!;
  g.fillStyle = "#000000"; g.fillRect(0, 0, size, size);
  const warm = ["#ffd88a", "#ffe3a8", "#ffc873", "#fff0cf", "#ffcf96"];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = c * cell + (cell - w) / 2, y = r * cell + (cell - h) / 2;
    d.fillStyle = "#d9d2c4"; d.fillRect(x - 3, y - 3, w + 6, h + 6);           // light frame
    d.fillStyle = "#6f8397"; d.fillRect(x, y, w, h);                            // glass, sky-tinted
    d.fillStyle = "#8ea2b4"; d.fillRect(x, y, w, h * 0.35);                     // reflection
    d.fillStyle = "#d9d2c4"; d.fillRect(x + w / 2 - 1.5, y, 3, h); d.fillRect(x, y + h * 0.5 - 1.5, w, 3);
    d.fillStyle = "#b9ad98"; d.fillRect(x - 5, y + h + 3, w + 10, 4);           // sill
    if (rnd() < 0.62) {                                                          // lit at night
      g.fillStyle = warm[Math.floor(rnd() * warm.length)]!;
      g.globalAlpha = 0.55 + rnd() * 0.45;
      g.fillRect(x, y, w, h);
      g.globalAlpha = 1;
      g.fillStyle = "#000000"; g.fillRect(x + w / 2 - 1.5, y, 3, h); g.fillRect(x, y + h * 0.5 - 1.5, w, 3);
    }
  }
  const mk = (canvas: HTMLCanvasElement) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  return { day: mk(dayCanvas), glow: mk(glowCanvas) };
}
const { day: windowTexture, glow: windowGlowTexture } = createWindowTextures();
// three.js's default ExtrudeGeometry UV generator (WorldUVGenerator,
// confirmed by reading its source) maps side-wall UVs to the shape's RAW
// LOCAL COORDINATES directly, in world units -- not normalized to [0,1]
// across the perimeter the way most UV generators work. That means a
// texture's `repeat` is a per-world-unit density, the same for every
// building regardless of its size, rather than something to be computed
// per-building from perimeter/height (which is what produced wildly
// stretched or aliased-into-hatching windows on different-sized buildings).
const WINDOW_TILE_SIZE = 2.3; // world units per window (the texture holds 4x4 windows); wider spacing so walls read as walls
windowTexture.repeat.set(1 / (WINDOW_TILE_SIZE * 4), 1 / (WINDOW_TILE_SIZE * 4));
windowGlowTexture.repeat.set(1 / (WINDOW_TILE_SIZE * 4), 1 / (WINDOW_TILE_SIZE * 4));

// Same fix, for the ground: a flat solid green plane is the same problem as
// a flat solid-color wall. Mottled noise instead of a pattern, since grass
// has no grid structure to draw.
function createGrassTexture(): THREE.CanvasTexture {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) { // big soft patches (drawn wrapped so the tile edges don't show)
    const px = Math.random() * size, py = Math.random() * size, pr = 18 + Math.random() * 40;
    const shade = 0.8 + Math.random() * 0.35;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const grad = ctx.createRadialGradient(px + ox!, py + oy!, 0, px + ox!, py + oy!, pr);
      const c = Math.round(shade * 255);
      grad.addColorStop(0, `rgba(${Math.min(255, c)},${Math.min(255, c + 6)},${Math.min(255, c - 8)},0.35)`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(px + ox! - pr, py + oy! - pr, pr * 2, pr * 2);
    }
  }
  for (let i = 0; i < 2200; i++) {
    const shade = 0.72 + Math.random() * 0.56; // multiplies the material's own grass color, so stays theme-aware
    ctx.fillStyle = `rgba(${Math.round(shade * 255)},${Math.round(shade * 255)},${Math.round(shade * 255)},0.5)`;
    const r = 1 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const tileSize = 3.2; // world units per texture tile -- denser than the first pass
  tex.repeat.set((HALF * 2.3) / tileSize, (HALF * 2.3) / tileSize);
  return tex;
}
// A pyramid/hip roof fanned from every footprint edge up to one apex over
// the centroid -- looks right for star-convex footprints (most real house
// outlines are), which is the tradeoff for not implementing a full
// straight-skeleton hip-roof solver for arbitrary polygons. Built directly
// in the same final world-oriented (x, y-up, z) space the wall extrusion
// ends up in after its rotateX(-90deg) (see footprintShape's own comment for
// why that isn't a double negation), so no rotation is applied here.
// Shingle-course banding. The roof's own per-wedge UVs (v=0 at eave, v=1 at
// apex, see pyramidRoofGeometry below) always span the full 0-1 range no
// matter the wedge's real width, so this doesn't need repeat/tiling -- one
// static banded gradient reads as courses regardless of building size.
function createRoofTexture(): THREE.CanvasTexture {
  const w = 32, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const rows = 12;
  for (let r = 0; r < rows; r++) {
    const y = Math.round((r / rows) * h);
    const rowH = Math.max(1, Math.ceil(h / rows) - 2);
    ctx.fillStyle = r % 2 === 0 ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(0, y, w, rowH);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const roofTexture = createRoofTexture();

function pyramidRoofGeometry(footprint: Footprint, roofHeight: number): THREE.BufferGeometry {
  const n = footprint.length;
  const apexX = footprint.reduce((s, p) => s + p[0], 0) / n;
  const apexZ = footprint.reduce((s, p) => s + p[1], 0) / n;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = footprint[i]!;
    const [x2, z2] = footprint[(i + 1) % n]!;
    positions.push(x1, 0, z1, x2, 0, z2, apexX, roofHeight, apexZ);
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

// A door-sized dark plane flush against the building's longest wall,
// oriented outward from the centroid using the same atan2(x,z) "rotY"
// convention the player/kart use elsewhere in this file (rotY=0 faces +z).
function addDoor(g: THREE.Group, footprint: Footprint, height: number) {
  const n = footprint.length;
  let bestLen = -1, bestI = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = footprint[i]!;
    const [x2, z2] = footprint[(i + 1) % n]!;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len > bestLen) { bestLen = len; bestI = i; }
  }
  const [x1, z1] = footprint[bestI]!;
  const [x2, z2] = footprint[(bestI + 1) % n]!;
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const edgeLen = Math.hypot(x2 - x1, z2 - z1) || 1;
  let nx = -(z2 - z1) / edgeLen, nz = (x2 - x1) / edgeLen; // perpendicular to the edge
  if (mx * nx + mz * nz < 0) { nx = -nx; nz = -nz; } // point away from the (already-recentered, ~origin) centroid
  const doorH = Math.min(2.0, height * 0.5);
  const doorW = Math.min(1.0, edgeLen * 0.3);
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(doorW, doorH),
    new THREE.MeshStandardMaterial({ color: "#3c2a1e", roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
  );
  door.rotation.y = Math.atan2(nx, nz);
  door.position.set(mx + nx * 0.05, doorH / 2, mz + nz * 0.05);
  g.add(door);
}

// Extrude a real footprint into a building: walls up to `height`, a thin
// overhanging cornice, then either a flat roof-colored cap (landmarks, whose
// distinctive shapes -- towers, spires -- are added separately by their own
// build functions) or a pitched pyramid roof plus a door (scatter houses,
// where "flat colored box" was reading as too plain). Works for any
// polygon, not just rectangles.
// Footprint coordinates are absolute map positions, but the returned group
// is meant to be placed with g.position.set(cx, y, cz) at the footprint's
// own centroid (matching MAP.landmarks[id].center) -- so every point is
// recentered on that centroid here first, once, rather than requiring every
// caller to remember to do it.
// Tracked so updateBuildingNightLights() (near the sun/day-night code) can
// fade every building's window glow with nightFactor; `lit` is a one-time
// coin flip per building so not every house has every window lit at once.
const buildingWallMaterials: { mat: THREE.MeshStandardMaterial; lit: boolean }[] = [];
function updateBuildingNightLights() {
  for (const { mat, lit } of buildingWallMaterials) mat.emissiveIntensity = lit ? nightFactor * 1.9 : 0;
  if (scene.fog) (scene.fog as THREE.Fog).color.copy(FOG_DAY).lerp(FOG_NIGHT, nightFactor);
}

function buildingFromFootprint(footprint: Footprint, height: number, wallColor: string, roofColor: string, roofStyle: "flat" | "hip" = "flat"): THREE.Group {
  const cx = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
  const cz = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
  const local: Footprint = footprint.map(([x, z]) => [x - cx, z - cz]);

  const g = new THREE.Group();
  // windowTexture's repeat is a fixed per-world-unit density (see its
  // definition), so it's shared across every building unmodified -- no
  // per-building clone or size-based scaling needed. emissiveMap reuses the
  // same window layout (inverted) so windows glow warm at night; intensity
  // starts at 0 and is driven by nightFactor (see updateBuildingNightLights).
  // Each building samples the shared window pattern at its own offset, so neighbours light different windows.
  const off = new THREE.Vector2(Math.floor(Math.random() * 4) / 4, Math.floor(Math.random() * 4) / 4);
  const glow = windowGlowTexture.clone(); glow.offset.copy(off);
  const day = windowTexture.clone(); day.offset.copy(off);
  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor, map: day, flatShading: true, roughness: 0.85, metalness: 0,
    emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0,
  });
  buildingWallMaterials.push({ mat: wallMat, lit: Math.random() < 0.85 });
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footprintShape(local), { depth: height, bevelEnabled: false }),
    wallMat
  );
  body.rotateX(-Math.PI / 2);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  const expanded: Footprint = local.map(([x, z]) => {
    const len = Math.hypot(x, z) || 1;
    return [x + (x / len) * 1.1, z + (z / len) * 1.1];
  });
  const cap = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footprintShape(expanded), { depth: 0.6, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: roofColor, flatShading: true, roughness: 0.8, metalness: 0 })
  );
  cap.rotateX(-Math.PI / 2);
  cap.position.y = height;
  cap.castShadow = true;
  g.add(cap);

  if (roofStyle === "hip") {
    const roofHeight = Math.min(2.6, height * 0.45);
    const roof = new THREE.Mesh(
      pyramidRoofGeometry(local, roofHeight),
      new THREE.MeshStandardMaterial({ color: roofColor, map: roofTexture, flatShading: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide })
    );
    roof.position.y = height + 0.6; // sits on top of the cornice
    roof.castShadow = true;
    roof.receiveShadow = true;
    g.add(roof);
    addDoor(g, local, height);
  }
  return g;
}

// ================= Landmarks (collectible) =================
interface Landmark {
  id: string;
  kind?: string;
  label: string;
  points: number;
  x: number;
  z: number;
  flavor: string;
  y?: number;
  mesh?: THREE.Object3D;
}
// x/z below are the real OSM-derived positions (MAP.landmarks[id].center) --
// see bamberg-map-data.json. Only label/points/flavor are hand-written.
const LANDMARKS: Landmark[] = IS_BAMBERG ? [
  { id: "rathaus", label: "ആൽട്ടെസ് റാത്ത്ഹൗസ്", points: 20, x: MAP.landmarks.rathaus!.center[0], z: MAP.landmarks.rathaus!.center[1], flavor: "പാലത്തിന് നടുവിൽ നിൽക്കുന്ന നഗരസഭാ മന്ദിരം!" },
  { id: "dom", label: "ബാംബെർഗ് ഡോം", points: 25, x: MAP.landmarks.dom!.center[0], z: MAP.landmarks.dom!.center[1], flavor: "നാല് ഗോപുരങ്ങളുള്ള പുരാതന കത്തീഡ്രൽ." },
  { id: "venedig", label: "ക്ലൈൻ വെനെഡിഗ്", points: 20, x: MAP.landmarks.venedig!.center[0], z: MAP.landmarks.venedig!.center[1], flavor: "നദിക്കരയിലെ ചെറിയ വെനീസ്!" },
  { id: "schlenkerla", label: "ഷ്ലെങ്കർല", points: 15, x: MAP.landmarks.schlenkerla!.center[0], z: MAP.landmarks.schlenkerla!.center[1], flavor: "പുകയൂറും ബിയറിന്റെ പഴയ ബാർ." },
  { id: "rosengarten", label: "റോസൻഗാർട്ടൻ", points: 15, x: MAP.landmarks.rosengarten!.center[0], z: MAP.landmarks.rosengarten!.center[1], flavor: "കുന്നിൻ മുകളിലെ പനിനീർ ഉദ്യാനം." },
  { id: "concordia", label: "കോൺകോർഡിയ", points: 15, x: MAP.landmarks.concordia!.center[0], z: MAP.landmarks.concordia!.center[1], flavor: "നദിക്കരയിലെ പഴയ മാളിക." },
  { id: "maxplatz", label: "മാക്സ്പ്ലാറ്റ്സ്", points: 15, x: MAP.landmarks.maxplatz!.center[0], z: MAP.landmarks.maxplatz!.center[1], flavor: "നീരുറവയുള്ള പഴയ ചന്തസ്ഥലം." },
] : CITY.landmarks.map((l) => ({
  id: l.id, kind: l.kind, label: l.label_ml, flavor: l.flavor_ml, points: l.points,
  x: MAP.landmarks[l.id]!.center[0]!, z: MAP.landmarks[l.id]!.center[1]!,
}));
/** How a landmark is stored in the player's collected list: Bamberg keeps its old ids, other cities are prefixed. */
function lmKey(l: Landmark): string { return IS_BAMBERG ? l.id : CITY_ID + ":" + l.id; }
function isCollected(l: Landmark): boolean { return state.collected.indexOf(lmKey(l)) !== -1; }
function cityScore(): number { return LANDMARKS.filter(isCollected).reduce((a, l) => a + l.points, 0); }
const TOTAL_POSSIBLE = LANDMARKS.reduce((s, l) => s + l.points, 0);
LANDMARKS.forEach((l) => { l.y = terrainHeight(l.x, l.z); });

// ================= Language =================
// LANDMARKS above stays the single source of gameplay data (id/points/x/z);
// its `label`/`flavor` fields are the Malayalam text. This table holds only
// the English override for the same ids, looked up through tl() everywhere
// a landmark's text is displayed, so both languages read from one place.
const LANDMARK_EN: Record<string, { label: string; flavor: string }> = {
  rathaus: { label: "Altes Rathaus", flavor: "The town hall standing right in the middle of the bridge!" },
  dom: { label: "Bamberg Cathedral", flavor: "An old cathedral with four towers." },
  venedig: { label: "Little Venice", flavor: "A tiny Venice on the riverbank!" },
  schlenkerla: { label: "Schlenkerla", flavor: "The old smoked-beer tavern." },
  rosengarten: { label: "Rosengarten", flavor: "A rose garden on top of the hill." },
  concordia: { label: "Concordia", flavor: "An old villa on the riverbank." },
  maxplatz: { label: "Maxplatz", flavor: "The old market square with a fountain." },
};
if (!IS_BAMBERG) CITY.landmarks.forEach((l) => { LANDMARK_EN[l.id] = { label: l.label_en, flavor: l.flavor_en }; });
function tl(l: Landmark): { label: string; flavor: string } {
  if (lang === "en" && LANDMARK_EN[l.id]) return LANDMARK_EN[l.id]!;
  return { label: l.label, flavor: l.flavor };
}

type Lang = "ml" | "en";
let lang: Lang = "ml";
try { lang = (localStorage.getItem("littleBamberg.lang") as Lang) || "ml"; } catch (e) {}

const UI_TEXT: Record<Lang, Record<string, string>> = {
  ml: {
    title: "ലിറ്റിൽ " + CITY.name_ml,
    loading: CITY.name_ml + " ഉണ്ടാക്കുന്നു…",
    eyebrow: "ജർമനിയിലെ മലയാളികൾക്കായി",
    tagline: CITY.name_ml + " ചുറ്റി നടന്ന് പോയിന്റ് ശേഖരിക്കൂ. മറ്റുള്ളവർ അതേ സമയം അവിടെ നടക്കുന്നുണ്ടാവും.",
    nameLabel: "നിങ്ങളുടെ പേര്",
    namePlaceholder: "ഉദാ: അനു",
    joinCta: "കളി തുടങ്ങൂ →",
    joining: "…",
    footnote: "അക്കൗണ്ട് വേണ്ട. പേര് മതി.",
    scoreLabel: "സ്കോർ",
    boardToggle: "ലീഡർബോർഡ്",
    boardTitle: "ലീഡർബോർഡ്",
    boardEmpty: "ഇതുവരെ ആരും ഇല്ല. നീയാവാം ആദ്യം!",
    hint: "നീങ്ങാൻ അമ്പടയാളങ്ങൾ ഉപയോഗിക്കൂ, ക്ലിക്ക് ചെയ്ത് നടക്കൂ",
    cameraHint: "ക്യാമറ തിരിക്കാൻ വലിക്കൂ",
    carPrompt: "കാറിൽ കയറാൻ E അമർത്തൂ",
    youSuffix: "(നീ)",
    collectedPrefix: "ശേഖരിച്ചു: ",
    completeLabel: CITY.name_ml + " പൂർത്തിയായി",
    travel: "യാത്ര",
    travelTitle: "ബവേറിയയിൽ എവിടേക്ക്?",
    travelNote: "ഓരോ നഗരത്തിലും 125 പോയിന്റ്. എല്ലാ നഗരങ്ങളിലെയും പോയിന്റുകൾ ലീഡർബോർഡിൽ ഒന്നിച്ച്.",
    travelHere: "നിങ്ങൾ ഇവിടെ",
    travelClose: "അടയ്ക്കുക",
    travelling: "യാത്ര ചെയ്യുന്നു…",
    roadTrip: "🚗 ബവേറിയ മുഴുവൻ ഓടിക്കൂ",
    completeFlavor: "എല്ലാ സ്ഥലങ്ങളും കണ്ടു. കൊള്ളാം!",
    langChip: "English",
    sunAuto: "തത്സമയം",
    sunDay: "പകൽ",
    sunNight: "രാത്രി",
    weatherClear: "തെളിഞ്ഞ ആകാശം",
    weatherCloudy: "മേഘാവൃതം",
    weatherRain: "മഴ",
    weatherSnow: "മഞ്ഞ്",
  },
  en: {
    title: "Little " + CITY.name_en,
    loading: "Building " + CITY.name_en + "…",
    eyebrow: "For German Malayalis",
    tagline: "Walk around " + CITY.name_en + " and collect points. Others are probably walking around at the same time.",
    nameLabel: "Your name",
    namePlaceholder: "e.g. Anu",
    joinCta: "Start playing →",
    joining: "…",
    footnote: "No account needed. Just a name.",
    scoreLabel: "Score",
    boardToggle: "Leaderboard",
    boardTitle: "Leaderboard",
    boardEmpty: "No one yet. Be the first!",
    hint: "Use the arrow keys to move, or click to walk there",
    cameraHint: "Drag to rotate the camera",
    carPrompt: "Press E to get in the car",
    youSuffix: "(you)",
    collectedPrefix: "Collected: ",
    completeLabel: CITY.name_en + " complete",
    travel: "Travel",
    travelTitle: "Where to in Bavaria?",
    travelNote: "125 points in every city. Points from all cities add up on the leaderboard.",
    travelHere: "You are here",
    travelClose: "Close",
    travelling: "Travelling…",
    roadTrip: "🚗 Drive across Bavaria",
    completeFlavor: "You've seen every sight. Well done!",
    langChip: "മലയാളം",
    sunAuto: "Live",
    sunDay: "Day",
    sunNight: "Night",
    weatherClear: "Clear",
    weatherCloudy: "Cloudy",
    weatherRain: "Rain",
    weatherSnow: "Snow",
  },
};
function tr(key: string): string {
  return UI_TEXT[lang][key] ?? key;
}

// ================= Renderer / scene / camera =================
const container = document.getElementById("world")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // was 0.5 -- that was a global brightness cut meant to fix an overexposed sky, but it dimmed every material in the scene (buildings, characters, kart) along with it. The sky's own brightness is tuned independently below instead.
container.innerHTML = ""; // defensive: never end up with two canvases stacked
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 900);

// A soft, warm glow on the brightest things (sun disc, lit windows, street
// lamps) instead of them being flat bright pixels -- the "Sky: Children of
// the Light" feel-good reference is largely this: gentle bloom on light
// sources, not a harsh effect. Threshold is high on purpose so ordinary lit
// surfaces (walls, roofs, grass) never bloom, only genuine light sources.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1), 0.55, 0.55, 0.82);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

let hemi: THREE.HemisphereLight;
let ground: THREE.Mesh;
let riverMesh: THREE.Mesh | undefined;

const FOG_DAY = new THREE.Color("#d8cdb4"), FOG_NIGHT = new THREE.Color("#1c2233");
function applyThemeColors() {
  scene.fog = new THREE.Fog(FOG_DAY.clone().lerp(FOG_NIGHT, nightFactor).getHex(), 160, 650);
  if (ground) (ground.material as THREE.MeshStandardMaterial).color.set(IS_BAMBERG ? cssVar("--grass") : IS_OVERVIEW ? "#9ea58f" : "#cfc4ac");
  if (riverMesh) (riverMesh.material as THREE.MeshStandardMaterial).color.set(cssVar("--regnitz"));
}

// A real atmospheric sky (Preetham model, the same one three.js's own Sky
// example uses) instead of a flat background color -- it scatters light
// through a physical model so the horizon, zenith and sun glow all come from
// one consistent physics instead of hand-picked gradient stops, and drifting
// procedural clouds. The DirectionalLight below is aimed along the same sun
// vector so cast shadows agree with where the sky says the sun is.
const sky = new Sky();
sky.scale.setScalar(3000);
sky.frustumCulled = false; // the box is centered on the world, not the camera -- never cull it
scene.add(sky);
const skyUniforms = (sky.material as THREE.ShaderMaterial).uniforms;
skyUniforms.turbidity.value = 3;
skyUniforms.rayleigh.value = 1.2;
skyUniforms.mieCoefficient.value = 0.005;
skyUniforms.mieDirectionalG.value = 0.8;
skyUniforms.cloudCoverage.value = 0.22;
skyUniforms.cloudDensity.value = 0.3;
// The same sky, rendered into an environment map now and then (it changes slowly), so PBR materials pick up
// sky-coloured light and the river actually reflects the sky instead of being a flat teal sheet.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(1000);
envSky.material = sky.material;
envScene.add(envSky);
let envTarget: THREE.WebGLRenderTarget | null = null;
function updateEnvironment(dayFactor: number) {
  const next = pmrem.fromScene(envScene, 0.04);
  scene.environment = next.texture;
  scene.environmentIntensity = 0.12 + 0.5 * dayFactor;
  envTarget?.dispose();
  envTarget = next;
}

const HEMI_BASE_INTENSITY = 0.75, SUN_BASE_INTENSITY = 1.6;
let nightFactor = 0; // 0 = full day, 1 = full night -- drives star/moon opacity and dims the ambient/sun together so the ground doesn't stay daylight-bright under a night sky

const sunDir = new THREE.Vector3();
const lightDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize(); // where the shadow-casting light comes from (sun by day, moon by night)
const MOON_LIGHT_DIR = new THREE.Vector3(-0.35, 0.85, 0.4).normalize();
const SUN_COLOR_DAY = new THREE.Color(0xfff2d9), MOON_COLOR = new THREE.Color(0x9fb3ff);
const HEMI_SKY_DAY = new THREE.Color(0xcfe6ee), HEMI_SKY_NIGHT = new THREE.Color(0x6f82b4);
const HEMI_GROUND_DAY = new THREE.Color(0x7a6a4c), HEMI_GROUND_NIGHT = new THREE.Color(0x262833);
// theta is in this game's own ground-plane convention: the OSM projection
// (see the top of this file) made real east -> +x and real north -> -z, so
// theta=0 points -z (north) and increases toward +x (east) as it grows --
// i.e. theta = 180 - (real compass azimuth, measured from north, clockwise).
function setSunAngle(elevationDeg: number, thetaDeg: number) {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(thetaDeg);
  sunDir.setFromSphericalCoords(1, phi, theta);
  skyUniforms.sunPosition.value.copy(sunDir).multiplyScalar(400000);
  // (sun.position/target follow the player every frame -- see the loop -- so shadows stay sharp)

  const dayFactor = THREE.MathUtils.clamp((elevationDeg + 6) / 16, 0, 1); // ramps through civil twilight instead of snapping at the horizon
  nightFactor = 1 - dayFactor;
  // A real night sky still needs a playable ground -- this is a casual game
  // people open at any hour, not a realism demo, so night keeps a much
  // higher light floor than physically accurate (moonlit-street brightness,
  // not actual darkness).
  hemi.intensity = HEMI_BASE_INTENSITY * (0.7 + 0.3 * dayFactor);
  hemi.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, nightFactor);
  hemi.groundColor.copy(HEMI_GROUND_DAY).lerp(HEMI_GROUND_NIGHT, nightFactor);
  // the shadow-casting light turns into moonlight: from high up, cool blue, dimmer
  lightDir.copy(sunDir).lerp(MOON_LIGHT_DIR, nightFactor).normalize();
  if (lightDir.y < 0.25) { lightDir.y = 0.25; lightDir.normalize(); }
  sun.color.copy(SUN_COLOR_DAY).lerp(MOON_COLOR, nightFactor);
  sun.intensity = SUN_BASE_INTENSITY * (0.3 + 0.7 * dayFactor);
  renderer.toneMappingExposure = 1.0 + 0.1 * nightFactor;
  updateEnvironment(dayFactor);
  skyUniforms.showSunDisc.value = dayFactor > 0.02 ? 1 : 0;
  starMat.opacity = nightFactor * 0.9;
  // NOTE: does NOT call the building-window/street-lamp night-light updates
  // here, even though this is otherwise "the" place nightFactor changes --
  // this function runs once very early (before those materials/meshes are
  // built further down the file) and again on every periodic resync. Wiring
  // it in here would throw on that first early call. Instead loop() calls
  // both updateBuildingNightLights() and updateStreetLamps() itself
  // alongside each updateSunFromRealTime() resync, and applyLanguage()'s
  // call site at the bottom of the file covers the initial paint.
}

// A simplified stand-in for the moon -- not real lunar ephemeris (phase and
// orbital motion are a much bigger calculation than a game needs), just the
// same solar-position math evaluated half a day off, so it rises as the sun
// sets and sits high around local midnight.
const moonDir = new THREE.Vector3();
function updateMoon(date: Date) {
  const shifted = new Date(date.getTime() - 12.42 * 3600 * 1000);
  const { elevationDeg, azimuthDeg } = solarPosition(shifted, BAMBERG_LAT, BAMBERG_LON);
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(180 - azimuthDeg);
  moonDir.setFromSphericalCoords(1, phi, theta);
  moon.position.copy(moonDir).multiplyScalar(2500);
  const moonUp = THREE.MathUtils.clamp((elevationDeg + 2) / 10, 0, 1);
  moonMat.opacity = moonUp * nightFactor * 0.95;
}

// ---- Real solar position for Bamberg, so the sun is wherever it actually
// is right now (and moves as real time passes while you play), instead of a
// fixed demo angle. Low-precision solar ephemeris (accurate to a fraction of
// a degree, which is all a game needs) -- see e.g. the Astronomical Almanac's
// low-precision formulas for solar coordinates.
const BAMBERG_LAT = 49.8919, BAMBERG_LON = 10.8917;
const DEG = Math.PI / 180;
function solarPosition(date: Date, latDeg: number, lonDeg: number): { elevationDeg: number; azimuthDeg: number } {
  const julianDate = date.getTime() / 86400000 + 2440587.5;
  const n = julianDate - 2451545.0; // days since J2000.0

  const meanLongitude = (280.46 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = 23.439 * DEG;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscensionDeg = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) / DEG;

  const gmstDeg = (280.46061837 + 360.98564736629 * n) % 360;
  const lstDeg = ((gmstDeg + lonDeg) % 360 + 360) % 360;
  const hourAngleDeg = (((lstDeg - rightAscensionDeg + 180) % 360 + 360) % 360) - 180; // [-180, 180]
  const hourAngle = hourAngleDeg * DEG;
  const lat = latDeg * DEG;

  const sinElevation = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

  const cosElevation = Math.cos(elevation);
  let azimuth = 0;
  if (Math.abs(cosElevation) > 1e-6) {
    const cosAz = (Math.sin(declination) - Math.sin(lat) * sinElevation) / (Math.cos(lat) * cosElevation);
    azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (hourAngleDeg > 0) azimuth = 2 * Math.PI - azimuth; // afternoon: sun has swung into the western half
  }
  return { elevationDeg: elevation / DEG, azimuthDeg: azimuth / DEG };
}
function updateSunFromRealTime() {
  const now = new Date();
  const { elevationDeg, azimuthDeg } = solarPosition(now, BAMBERG_LAT, BAMBERG_LON);
  setSunAngle(elevationDeg, 180 - azimuthDeg);
  updateMoon(now);
}

hemi = new THREE.HemisphereLight(0xbfe0e8, 0x6b563a, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 10, far: 420 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.35;
sun.shadow.radius = 2.5;
scene.add(sun);
scene.add(sun.target);
function followShadow(x: number, z: number) {
  sun.target.position.set(x, 0, z);
  sun.position.set(x + lightDir.x * 200, lightDir.y * 200, z + lightDir.z * 200);
}
followShadow(0, 0);

// A scatter of stars on the inside of the sky dome (upper hemisphere only),
// faded in/out with nightFactor rather than an on/off switch.
const STAR_COUNT = 900;
const starPositions = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  let x = 0, y = 0, z = 0, lenSq = 0;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random(); // upper hemisphere only
    z = Math.random() * 2 - 1;
    lenSq = x * x + y * y + z * z;
  } while (lenSq > 1 || lenSq < 0.05);
  const len = Math.sqrt(lenSq);
  const r = 2800;
  starPositions[i * 3] = (x / len) * r;
  starPositions[i * 3 + 1] = (y / len) * r;
  starPositions[i * 3 + 2] = (z / len) * r;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

const moonMat = new THREE.MeshBasicMaterial({ color: 0xdfe8f2, transparent: true, opacity: 0, depthWrite: false });
const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 16), moonMat);
moon.frustumCulled = false;
scene.add(moon);

updateSunFromRealTime();

// ================= Ground, river, hills =================
ground = new THREE.Mesh(
  new THREE.PlaneGeometry(HALF * 2.3, HALF * 2.3, 1, 1),
  new THREE.MeshStandardMaterial({ color: IS_BAMBERG ? cssVar("--grass") : IS_OVERVIEW ? "#9ea58f" : "#cfc4ac", map: createGrassTexture(), roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

if (IS_OVERVIEW && CITY.outline) {
  const land = new THREE.Mesh(new THREE.ShapeGeometry(footprintShape(CITY.outline as Footprint)),
    new THREE.MeshStandardMaterial({ color: cssVar("--grass"), map: createGrassTexture(), roughness: 1 }));
  land.rotateX(-Math.PI / 2); land.position.y = 0.03; land.receiveShadow = true; scene.add(land);
  // the border in Bavaria's colours: white and blue dashes
  const ol = CITY.outline;
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i]!, b = ol[(i + 1) % ol.length]!;
    const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 1.3), new THREE.MeshStandardMaterial({ color: i % 2 ? "#ffffff" : "#1f7ac2", roughness: 0.6 }));
    seg.position.set((a[0]! + b[0]!) / 2, 0.25, (a[1]! + b[1]!) / 2);
    seg.rotation.y = -Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!);
    scene.add(seg);
  }
  for (const lk of CITY.lakes || []) {
    const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ color: cssVar("--regnitz"), roughness: 0.1, metalness: 0.35 }));
    lake.scale.set(lk.rx, lk.rz, 1); lake.rotation.x = -Math.PI / 2; lake.position.set(lk.cx, 0.14, lk.cz); scene.add(lake);
  }
}

function addHill(def: typeof DOMBERG, color: string) {
  const geo = new THREE.ConeGeometry(def.r, def.h, 9, 1, true);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true }));
  mesh.position.set(def.cx, def.h / 2, def.cz);
  mesh.receiveShadow = true;
  scene.add(mesh);
}
if (IS_BAMBERG) {
  addHill(DOMBERG, cssVar("--sandstone-deep"));
  addHill(MICHAELSBERG, "#5c7a45");
} else {
  CITY.hills.forEach((hl) => addHill(hl, (hl as { snow?: boolean }).snow ? "#dfe5ea" : "#7d9a55"));
}

// Build a ribbon by offsetting the real Regnitz polyline perpendicular to
// its own direction at each point -- a straightforward buffered-line
// construction, not a fitted curve, but fine for a low-poly ribbon.
for (const riverLine of RIVER_LINES) {
const riverShape = new THREE.Shape();
const top: THREE.Vector2[] = [], bot: THREE.Vector2[] = [];
for (let i = 0; i < riverLine.length; i++) {
  const [x, z] = riverLine[i]!;
  const [px, pz] = riverLine[Math.max(0, i - 1)]!;
  const [nx, nz] = riverLine[Math.min(riverLine.length - 1, i + 1)]!;
  const dx = nx - px, dz = nz - pz;
  const len = Math.hypot(dx, dz) || 1;
  const perpX = -dz / len, perpZ = dx / len;
  // negate z here (see footprintShape) so the ribbon lands at the real
  // river position once rotateX(-PI/2) flips local Y back to world Z.
  top.push(new THREE.Vector2(x + perpX * RIVER_HALF_W, -(z + perpZ * RIVER_HALF_W)));
  bot.push(new THREE.Vector2(x - perpX * RIVER_HALF_W, -(z - perpZ * RIVER_HALF_W)));
}
riverShape.moveTo(top[0]!.x, top[0]!.y);
top.forEach((p) => riverShape.lineTo(p.x, p.y));
bot.slice().reverse().forEach((p) => riverShape.lineTo(p.x, p.y));
riverShape.closePath();
const riverGeo = new THREE.ShapeGeometry(riverShape);
riverGeo.rotateX(-Math.PI / 2);
const rm = new THREE.Mesh(riverGeo, new THREE.MeshStandardMaterial({ color: cssVar("--regnitz"), roughness: 0.12, metalness: 0.35 }));
rm.position.y = 0.12;
scene.add(rm);
riverMesh = riverMesh || rm;
}

// Real pedestrian/residential streets -- same buffered-line ribbon
// technique as the river, just thinner and paved-colored, laid flush on
// the ground (and following it up onto the hills).
// Same fixed-repeat approach as the window texture -- ShapeGeometry also
// uses raw local coordinates as UVs (confirmed by reading its source, same
// as ExtrudeGeometry's side walls), so repeat is a per-world-unit density
// shared across every road, not something to compute per-segment.
function createRoadTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const shade = 0.78 + Math.random() * 0.38;
    ctx.fillStyle = `rgba(${Math.round(shade * 255)},${Math.round(shade * 255)},${Math.round(shade * 255)},0.55)`;
    const w = 2 + Math.random() * 3, h = 2 + Math.random() * 3;
    ctx.fillRect(Math.random() * size, Math.random() * size, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const roadTexture = createRoadTexture();
const ROAD_TILE_SIZE = 1.6;
roadTexture.repeat.set(1 / ROAD_TILE_SIZE, 1 / ROAD_TILE_SIZE);

const roadColor = IS_BAMBERG ? "#cbb99a" : "#a19b90"; // big cities: grey cobbles against pale paving
// Tracked so applyWeather() can shift every road toward a wet sheen (lower
// roughness, a little metalness) during rain and back for clear/other
// weather -- one array write covers every road regardless of count.
const roadMaterials: THREE.MeshStandardMaterial[] = [];
MAP.roads.forEach((road) => {
  const line = road.line;
  if (line.length < 2) return;
  const halfW = road.width / 2;
  const shape = new THREE.Shape();
  const rTop: THREE.Vector2[] = [], rBot: THREE.Vector2[] = [];
  for (let i = 0; i < line.length; i++) {
    const [x, z] = line[i]!;
    const [px, pz] = line[Math.max(0, i - 1)]!;
    const [nx, nz] = line[Math.min(line.length - 1, i + 1)]!;
    const dx = nx - px, dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    const perpX = -dz / len, perpZ = dx / len;
    rTop.push(new THREE.Vector2(x + perpX * halfW, -(z + perpZ * halfW)));
    rBot.push(new THREE.Vector2(x - perpX * halfW, -(z - perpZ * halfW)));
  }
  shape.moveTo(rTop[0]!.x, rTop[0]!.y);
  rTop.forEach((p) => shape.lineTo(p.x, p.y));
  rBot.slice().reverse().forEach((p) => shape.lineTo(p.x, p.y));
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const roadMat = new THREE.MeshStandardMaterial({ color: roadColor, map: roadTexture, roughness: 1, metalness: 0 });
  roadMaterials.push(roadMat);
  const mesh = new THREE.Mesh(geo, roadMat);
  // follow the terrain (roads climbing Domberg shouldn't float or clip) --
  // lift each vertex to the ground height under it.
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vz = pos.getZ(i);
    pos.setY(i, terrainHeight(vx, vz) + 0.08);
  }
  pos.needsUpdate = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
});

// vineyard terrace stripes on Michaelsberg
for (let vr = MICHAELSBERG.r * 0.25; vr < MICHAELSBERG.r * 0.85; vr += 7) {
  const stripGeo = new THREE.TorusGeometry(vr, 0.5, 4, 20, Math.PI * 1.1);
  const strip = new THREE.Mesh(stripGeo, new THREE.MeshStandardMaterial({ color: "#7a9a56", flatShading: true, metalness: 0 }));
  strip.rotation.x = Math.PI / 2;
  const vh = hillBump(MICHAELSBERG.cx, MICHAELSBERG.cz - vr, MICHAELSBERG.cx, MICHAELSBERG.cz, MICHAELSBERG.r, MICHAELSBERG.h);
  strip.position.set(MICHAELSBERG.cx, vh + 0.4, MICHAELSBERG.cz);
  strip.rotation.z = Math.PI * 0.4;
  scene.add(strip);
}

// ================= Building block helpers (low-poly, primitives only) =================
function box(w: number, h: number, d: number, color: string, flat = false): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, flatShading: flat, roughness: 0.9, metalness: 0 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function pyramidRoof(w: number, d: number, h: number, color: string): THREE.Mesh {
  const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4, 1);
  geo.rotateY(Math.PI / 4);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, flatShading: true, metalness: 0, roughness: 0.9 }));
  m.castShadow = true;
  return m;
}
function house(x: number, z: number, w: number, h: number, d: number, wallColor: string, roofColor: string, rot?: number): THREE.Group {
  const g = new THREE.Group();
  const b = box(w, h, d, wallColor); b.position.y = h / 2;
  const r = pyramidRoof(w, d, h * 0.6, roofColor); r.position.y = h + (h * 0.6) / 2 - 0.05;
  g.add(b, r);
  g.position.set(x, terrainHeight(x, z), z);
  if (rot) g.rotation.y = rot;
  scene.add(g);
  return g;
}

if (IS_BAMBERG) {
(function buildRathaus() {
  const l = LANDMARKS[0]!;
  const footprint = MAP.landmarks.rathaus!.footprint!;
  const g = buildingFromFootprint(footprint, 9, cssVar("--sandstone"), cssVar("--roof"));
  // the real footprint already captures the building spanning the river on
  // its pier -- just add the recognizable turret on top, offset toward one
  // end the way the real clock tower sits off-center.
  const turret = box(2.4, 4, 2.4, cssVar("--timber")); turret.position.set(2, 9 + 2, 3); g.add(turret);
  const turretRoof = pyramidRoof(2.4, 2.4, 2.6, cssVar("--gold")); turretRoof.position.set(2, 9 + 4 + 1.2, 3); g.add(turretRoof);
  g.position.set(l.x, l.y!, l.z);
  scene.add(g);
  l.mesh = g;
})();

(function buildDom() {
  const l = LANDMARKS[1]!;
  const footprint = MAP.landmarks.dom!.footprint!;
  // buildingFromFootprint recenters on the footprint's own centroid before
  // building geometry -- recenter the same way here so the spire offsets
  // below line up with where the body mesh actually ends up, locally.
  const ccx = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
  const ccz = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
  const local = footprint.map(([x, z]) => [x - ccx, z - ccz] as [number, number]);
  const xs = local.map((p) => p[0]), zs = local.map((p) => p[1]);
  const hx = (Math.max(...xs) - Math.min(...xs)) / 2 - 5;
  const hz = (Math.max(...zs) - Math.min(...zs)) / 2 - 5;

  const g = buildingFromFootprint(footprint, 12, cssVar("--sandstone-deep"), cssVar("--roof"));
  // four corner spires -- the Dom's most recognizable feature -- inset from
  // the real footprint's own bounding box instead of fixed offsets.
  ([[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]] as const).forEach(([ox, oz]) => {
    const spH = 20;
    const tower = box(3.4, spH, 3.4, cssVar("--timber"));
    tower.position.set(ox, spH / 2, oz);
    g.add(tower);
    const cap = pyramidRoof(3.4, 3.4, 7, cssVar("--gold"));
    cap.position.set(ox, spH + 3.5, oz);
    g.add(cap);
  });
  g.position.set(l.x, l.y!, l.z);
  scene.add(g);
  l.mesh = g;
})();

(function buildVenedig() {
  const l = LANDMARKS[2]!;
  const g = new THREE.Group();
  // Klein Venedig is famous for exactly this -- a row of small, brightly
  // painted fishermen's houses right on the riverbank.
  const colors = [cssVar("--facade-pink"), cssVar("--facade-yellow"), cssVar("--facade-blue"), cssVar("--facade-cream"), cssVar("--facade-teal")];
  for (let i = 0; i < 5; i++) {
    const h = house(i * 8 - 16, 0, 6, 5 + (i % 2), 6, colors[i % colors.length]!, cssVar("--roof"), 0);
    g.add(h);
  }
  g.position.set(l.x, 0, l.z);
  scene.add(g);
  l.mesh = g;
})();

(function buildSchlenkerla() {
  const l = LANDMARKS[3]!;
  const g = new THREE.Group();
  const body = box(9, 6, 8, cssVar("--timber"), true); body.position.y = 3; g.add(body);
  const roof = pyramidRoof(9, 8, 4.5, "#241a12"); roof.position.y = 6 + 2.1; g.add(roof);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3), new THREE.MeshStandardMaterial({ color: cssVar("--timber"), metalness: 0 }));
  post.position.set(5.2, 4.5, 0); g.add(post);
  const sign = box(2.2, 1.4, 0.2, cssVar("--gold")); sign.position.set(5.2, 3.6, 1); g.add(sign);
  g.position.set(l.x, l.y!, l.z);
  scene.add(g);
  l.mesh = g;
})();

(function buildRosengarten() {
  const l = LANDMARKS[4]!;
  const footprint = MAP.landmarks.rosengarten!.footprint!;
  const ccx = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
  const ccz = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
  const local = footprint.map(([x, z]) => [x - ccx, z - ccz] as [number, number]);
  const rMax = Math.max(...local.map(([x, z]) => Math.hypot(x, z)));

  const g = new THREE.Group();
  const terrace = new THREE.Mesh(
    new THREE.ExtrudeGeometry(footprintShape(local), { depth: 0.5, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: cssVar("--sandstone"), flatShading: true, metalness: 0 })
  );
  terrace.rotateX(-Math.PI / 2);
  g.add(terrace);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const rad = rMax * 0.6;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 5), new THREE.MeshStandardMaterial({ color: i % 2 ? "#c96a8f" : "#5c7a45", flatShading: true, metalness: 0 }));
    bush.position.set(Math.cos(ang) * rad, 1, Math.sin(ang) * rad);
    g.add(bush);
  }
  g.position.set(l.x, l.y!, l.z);
  scene.add(g);
  l.mesh = g;
})();

(function buildConcordia() {
  const l = LANDMARKS[5]!;
  const footprint = MAP.landmarks.concordia!.footprint!;
  const g = buildingFromFootprint(footprint, 7, "#d8b878", cssVar("--roof"));
  g.position.set(l.x, l.y!, l.z);
  scene.add(g);
  l.mesh = g;
})();

(function buildFountain() {
  const l = LANDMARKS[6]!;
  const g = new THREE.Group();
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 0.4, 20), new THREE.MeshStandardMaterial({ color: "#cbbfa4", metalness: 0 }));
  plaza.position.y = 0.2; plaza.receiveShadow = true; g.add(plaza);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 1.2, 12), new THREE.MeshStandardMaterial({ color: cssVar("--sandstone-deep"), metalness: 0 }));
  basin.position.y = 0.9; g.add(basin);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3, 8), new THREE.MeshStandardMaterial({ color: cssVar("--gold"), metalness: 0.6, roughness: 0.35 }));
  pole.position.y = 2.5; g.add(pole);
  const top2 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), new THREE.MeshStandardMaterial({ color: cssVar("--gold-bright"), metalness: 0.6, roughness: 0.3 }));
  top2.position.y = 4.2; g.add(top2);
  g.position.set(l.x, l.y!, l.z);
  scene.add(g);
  l.mesh = g;
})();

// Neue Residenz -- real footprint, not a collectible, just authentic
// background context for the Rosengarten right beside it.
(function buildNeueResidenz() {
  const footprint = MAP.landmarks.neue_residenz!.footprint!;
  const center = MAP.landmarks.neue_residenz!.center;
  const g = buildingFromFootprint(footprint, 10, cssVar("--sandstone"), cssVar("--roof"));
  g.position.set(center[0], terrainHeight(center[0], center[1]), center[1]);
  scene.add(g);
})();
} else {
  buildCityLandmarks();
}

// ================= Decorative scatter: generic houses + trees =================
// Real building footprints from the old town core (see bamberg-map-data.json)
// stand in for the invented scatter this used to be -- same low-poly flat-
// roofed treatment as everything else, but the actual street layout.
// ---- Generic landmarks for the OpenStreetMap cities: the real outline, taller, with the feature that makes each
// kind recognisable (spires, a clock tower, a castle keep, a paved square with a fountain, a stone bridge deck).
function localOf(fp: Footprint): [number, number][] {
  const cx = fp.reduce((a, p) => a + p[0]!, 0) / fp.length, cz = fp.reduce((a, p) => a + p[1]!, 0) / fp.length;
  return fp.map(([x, z]) => [x! - cx, z! - cz] as [number, number]);
}
function spire(g: THREE.Group, x: number, z: number, h: number, w = 3.6) {
  const t = box(w, h, w, cssVar("--sandstone-deep")); t.position.set(x, h / 2, z); t.castShadow = true; g.add(t);
  const cap = pyramidRoof(w + 0.4, w + 0.4, w * 2.2, cssVar("--gold")); cap.position.set(x, h + w * 1.1, z); g.add(cap);
}
function fountainGroup(r: number): THREE.Group {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 1.1, 16), new THREE.MeshStandardMaterial({ color: cssVar("--sandstone-deep"), roughness: 0.8 }));
  basin.position.y = 0.55; basin.castShadow = true; g.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.1, 16), new THREE.MeshStandardMaterial({ color: cssVar("--regnitz"), roughness: 0.1, metalness: 0.3 }));
  water.position.y = 1.05; g.add(water);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: cssVar("--gold"), metalness: 0.6, roughness: 0.35 }));
  pole.position.y = 3; pole.castShadow = true; g.add(pole);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 10), new THREE.MeshStandardMaterial({ color: cssVar("--gold-bright"), metalness: 0.6, roughness: 0.3 }));
  orb.position.y = 5.3; g.add(orb);
  return g;
}
function plaza(fp: Footprint | undefined, r = 12): THREE.Mesh {
  const shape = fp && fp.length >= 3 ? footprintShape(localOf(fp)) : new THREE.Shape(new THREE.Path().absarc(0, 0, r, 0, Math.PI * 2, false).getPoints(24));
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: "#d3c7ad", roughness: 0.95 }));
  m.rotateX(-Math.PI / 2); m.receiveShadow = true;
  return m;
}
function buildCityLandmarks() {
  for (const l of LANDMARKS) {
    const fp = MAP.landmarks[l.id]?.footprint as Footprint | undefined;
    const kind = l.kind || "building";
    let g: THREE.Group;
    if (kind === "square") {
      g = new THREE.Group(); g.add(plaza(fp, 14));
      const f = fountainGroup(2.4); g.add(f);
    } else if (kind === "fountain") {
      g = new THREE.Group(); g.add(plaza(undefined, 7)); g.add(fountainGroup(3.4));
    } else if (kind === "bridge" && fp) {
      g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(footprintShape(localOf(fp)), { depth: 0.45, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color: cssVar("--sandstone"), roughness: 0.9, flatShading: true }));
      deck.rotateX(-Math.PI / 2); deck.position.y = 0.05; deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
      // statues along the bridge, on its long axis
      const loc = localOf(fp);
      let far = loc[0]!, fd = 0;
      for (const p of loc) { const d = Math.hypot(p[0], p[1]); if (d > fd) { fd = d; far = p; } }
      const ux = far[0] / (fd || 1), uz = far[1] / (fd || 1);
      for (let t = -fd * 0.85; t <= fd * 0.85; t += 14) {
        for (const side of [-1, 1]) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 6), new THREE.MeshStandardMaterial({ color: "#bfb39c", roughness: 0.9 }));
          st.position.set(ux * t - uz * side * 2.2, 1.8, uz * t + ux * side * 2.2); st.castShadow = true; g.add(st);
        }
      }
    } else if (kind === "fairy_castle") { // Neuschwanstein: white, slim towers with blue-grey pointed roofs
      g = new THREE.Group();
      const body = box(14, 10, 6, "#f4f1ea"); body.position.y = 5; body.castShadow = true; g.add(body);
      const roof = pyramidRoof(14, 6, 4, "#5b6f86"); roof.position.y = 12; g.add(roof);
      for (const [ox, oz, h, w] of [[-8, 0, 16, 2.6], [8, 1, 13, 2.2], [3, -4, 19, 2.2], [-3, 4, 11, 1.8], [0, 0, 22, 2.8]] as const) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 10), new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.8 }));
        t.position.set(ox, h / 2, oz); t.castShadow = true; g.add(t);
        const c = new THREE.Mesh(new THREE.ConeGeometry(w * 0.7, w * 2.2, 10), new THREE.MeshStandardMaterial({ color: "#5b6f86", roughness: 0.6 }));
        c.position.set(ox, h + w * 1.1, oz); g.add(c);
      }
    } else if (kind === "summit") { // a summit cross and flag on the highest mountain
      g = new THREE.Group();
      const post = box(0.8, 9, 0.8, cssVar("--gold")); post.position.y = 4.5; g.add(post);
      const arm = box(5, 0.8, 0.8, cssVar("--gold")); arm.position.y = 6.8; g.add(arm);
      const cairn = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.4, 7), new THREE.MeshStandardMaterial({ color: "#8a8f94", roughness: 1, flatShading: true }));
      cairn.position.y = 1.2; g.add(cairn);
    } else if (kind === "lake_chapel") { // St. Bartholomä: white chapel with red onion domes by the water
      g = new THREE.Group();
      const body = box(9, 5, 7, "#f4f0e6"); body.position.y = 2.5; body.castShadow = true; g.add(body);
      for (const [ox, oz, r] of [[-3, 0, 2.2], [2.5, -1.5, 1.6], [2.5, 1.5, 1.6]] as const) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshStandardMaterial({ color: "#b8483a", roughness: 0.6 }));
        d.position.set(ox, 5 + r * 0.7, oz); d.scale.y = 1.25; g.add(d);
      }
    } else if (kind === "temple") { // Walhalla: a Greek temple on a stepped base
      g = new THREE.Group();
      for (let i = 0; i < 3; i++) { const st = box(26 - i * 2, 1.2, 14 - i * 2, "#d9d4c8"); st.position.y = 0.6 + i * 1.2; g.add(st); }
      for (let i = 0; i < 8; i++) for (const zz of [-4.6, 4.6]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 7, 10), new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.7 }));
        col.position.set(-9.8 + i * 2.8, 3.6 + 3.5, zz); col.castShadow = true; g.add(col);
      }
      const cella = box(18, 7, 6, "#e9e4d8"); cella.position.y = 7.1; g.add(cella);
      const beam = box(22, 1.4, 11, "#ece8dd"); beam.position.y = 11.3; g.add(beam);
      const roof = pyramidRoof(22, 11, 3, "#8c8579"); roof.position.y = 13.4; g.add(roof);
    } else if (kind === "walled_town") { // Rothenburg: a ring wall with towers around red-roofed houses
      g = new THREE.Group();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const w = box(5, 3, 1.2, "#d6c39e"); w.position.set(Math.cos(a) * 15, 1.5, Math.sin(a) * 15); w.rotation.y = -a + Math.PI / 2; w.castShadow = true; g.add(w);
        if (i % 5 === 0) spire(g, Math.cos(a) * 15, Math.sin(a) * 15, 6, 2.6);
      }
      for (let i = 0; i < 9; i++) {
        const hx = (Math.random() - 0.5) * 18, hz = (Math.random() - 0.5) * 18;
        const hb = box(3, 3, 3, i % 2 ? "#f1e3c6" : "#e8c68c"); hb.position.set(hx, 1.5, hz); hb.castShadow = true; g.add(hb);
        const hr = pyramidRoof(3.2, 3.2, 2.2, "#b8503a"); hr.position.set(hx, 4.1, hz); g.add(hr);
      }
    } else if (kind === "island_palace") { // Herrenchiemsee: a palace on a green island in the lake
      g = new THREE.Group();
      const island = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 0.6, 20), new THREE.MeshStandardMaterial({ color: cssVar("--grass"), roughness: 1 }));
      island.position.y = 0.2; island.receiveShadow = true; g.add(island);
      const pal = box(16, 6, 5, "#efe3c5"); pal.position.y = 3.5; pal.castShadow = true; g.add(pal);
      for (const ox of [-7, 7]) { const wing = box(3.5, 6, 8, "#efe3c5"); wing.position.set(ox, 3.5, 3); g.add(wing); }
      const trim = box(16.4, 0.6, 5.4, cssVar("--gold")); trim.position.y = 6.8; g.add(trim);
    } else if (kind === "three_rivers") { // Passau: the cathedral with green domes
      g = new THREE.Group();
      const body = box(8, 9, 16, "#f3efe6"); body.position.y = 4.5; body.castShadow = true; g.add(body);
      for (const [ox, oz, r] of [[-2.6, -8, 1.6], [2.6, -8, 1.6], [0, 5, 2.6]] as const) {
        const tw = box(r * 1.6, 12, r * 1.6, "#f3efe6"); tw.position.set(ox, 6, oz); g.add(tw);
        const d = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshStandardMaterial({ color: "#5c9a7d", roughness: 0.5, metalness: 0.2 }));
        d.position.set(ox, 12 + r * 0.6, oz); d.scale.y = 1.3; g.add(d);
      }
    } else if (!fp) { // a point only (castle node, small building): a keep with corner towers
      g = new THREE.Group();
      const keep = box(16, 12, 12, cssVar("--sandstone")); keep.position.y = 6; keep.castShadow = true; g.add(keep);
      const roof = pyramidRoof(16, 12, 5, cssVar("--roof")); roof.position.y = 12 + 2.5; g.add(roof);
      for (const [ox, oz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]] as const) spire(g, ox, oz, 15, 3.2);
    } else {
      const height = kind === "church" || kind === "church2" ? 14 : kind === "palace" ? 12 : kind === "townhall" ? 12 : kind === "tower" ? 10 : 9;
      const wall = kind === "palace" ? "#f1e2c2" : kind === "church" || kind === "church2" ? cssVar("--sandstone") : cssVar("--facade-cream");
      g = buildingFromFootprint(fp, height, wall, cssVar("--roof"), kind === "church" || kind === "church2" ? "flat" : "hip");
      const loc = localOf(fp);
      let far = loc[0]!, fd = 0;
      for (const p of loc) { const d = Math.hypot(p[0], p[1]); if (d > fd) { fd = d; far = p; } }
      const ux = far[0] / (fd || 1), uz = far[1] / (fd || 1);
      if (kind === "church") spire(g, ux * fd * 0.5, uz * fd * 0.5, height + 16);
      if (kind === "church2") { for (const side of [-1, 1]) spire(g, ux * fd * 0.5 - uz * side * 3.2, uz * fd * 0.5 + ux * side * 3.2, height + 18, 3.4); }
      if (kind === "townhall" || kind === "tower") spire(g, 0, 0, height + (kind === "tower" ? 14 : 10), 4);
    }
    g.position.set(l.x, terrainHeight(l.x, l.z), l.z);
    scene.add(g);
    l.mesh = g;
  }
}

const occluders: THREE.Object3D[] = []; // every building group, for the see-through check
let fadedNow = new Set<THREE.Object3D>();
LANDMARKS.forEach((l) => { if (l.mesh) occluders.push(l.mesh); });
function setFade(g: THREE.Object3D, faded: boolean) {
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (!m || Array.isArray(m)) return;
    m.transparent = faded; m.opacity = faded ? 0.28 : 1; m.depthWrite = !faded; m.needsUpdate = true;
  });
}
const occRay = new THREE.Raycaster();
function updateOcclusion(from: THREE.Vector3, to: THREE.Vector3) {
  const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
  occRay.set(from, dir); occRay.far = dist;
  const hits = new Set<THREE.Object3D>();
  for (const h of occRay.intersectObjects(occluders, true)) {
    let o: THREE.Object3D | null = h.object;
    while (o && occluders.indexOf(o) === -1) o = o.parent;
    if (o) hits.add(o);
  }
  fadedNow.forEach((g) => { if (!hits.has(g)) setFade(g, false); });
  hits.forEach((g) => { if (!fadedNow.has(g)) setFade(g, true); });
  fadedNow = hits;
}

function scatterHouses() {
  // Real German old towns are painted, not brown-on-brown -- the classic
  // Fachwerk mix of ochre, rose, sky-blue and cream facades, cycled against
  // the wall color (offset stride) so neighbors don't fall into a visible
  // repeating pattern.
  const wallColors = [
    cssVar("--facade-yellow"), cssVar("--facade-pink"), cssVar("--facade-cream"),
    cssVar("--facade-blue"), cssVar("--sandstone"), cssVar("--facade-teal"), cssVar("--sandstone-deep"),
  ];
  const roofColors = [cssVar("--roof"), cssVar("--timber"), "#8a3f36", "#5c4a35"];
  MAP.scatter_buildings.forEach((b, idx) => {
    const footprint = b.footprint;
    const cx = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
    const cz = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
    const height = 3.5 + (idx % 4) * 0.9;
    const wall = wallColors[idx % wallColors.length]!;
    const roof = roofColors[(idx * 3 + 1) % roofColors.length]!;
    const g = buildingFromFootprint(footprint, height, wall, roof, "hip");
    g.position.set(cx, terrainHeight(cx, cz), cz);
    scene.add(g);
    occluders.push(g);
  });
}
scatterHouses();

// Trees are instanced (two draw calls total, however many hundred there are)
// rather than one Group per tree -- needed once avenue trees along the real
// road network are added on top of the hillside/scatter ones below.
const treePlacements: { x: number; z: number; scale: number }[] = [];
function addTree(x: number, z: number, scale = 1) {
  treePlacements.push({ x, z, scale });
}
const TREE_BLOCKERS: Footprint[] = IS_BAMBERG ? [] : [...MAP.scatter_buildings.map((b) => b.footprint), ...Object.values(MAP.landmarks).map((l) => l.footprint || []).filter((f) => f.length >= 3)];
function treeBlocked(x: number, z: number): boolean {
  if (IS_BAMBERG) return false;
  for (const f of TREE_BLOCKERS) {
    const p0 = f[0]!;
    if (Math.abs(p0[0]! - x) > 40 || Math.abs(p0[1]! - z) > 40) continue;
    if (pointInPoly(x, z, f) || pointInPoly(x + 1.5, z, f) || pointInPoly(x - 1.5, z, f)) return true;
  }
  return false;
}
for (let t = 0; t < (CITY_HILLS.length ? 55 : 0); t++) {
  const ang = Math.random() * Math.PI * 2;
  const pick = CITY_HILLS[Math.floor(Math.random() * CITY_HILLS.length)]!;
  const rad = pick.r * (0.3 + Math.random() * 0.75);
  const tx = pick.cx + Math.cos(ang) * rad, tz = pick.cz + Math.sin(ang) * rad;
  if (distToRiver(tx, tz) < RIVER_HALF_W + 4 || treeBlocked(tx, tz)) continue;
  addTree(tx, tz);
}
if (IS_OVERVIEW && CITY.outline) {
  const nearWay = (x: number, z: number) => MAP.roads.some((r) => { const [a, b] = [r.line[0]!, r.line[r.line.length - 1]!];
    const abx = b[0]! - a[0]!, abz = b[1]! - a[1]!, L = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]!) * abx + (z - a[1]!) * abz) / L));
    return Math.hypot(x - (a[0]! + t * abx), z - (a[1]! + t * abz)) < 5; });
  const nearGate = (x: number, z: number) => (CITY.portals || []).some((p) => Math.hypot(p.x - x, p.z - z) < 30) || LANDMARKS.some((l) => Math.hypot(l.x - x, l.z - z) < 22);
  const inLake = (x: number, z: number) => (CITY.lakes || []).some((lk) => ((x - lk.cx) / lk.rx) ** 2 + ((z - lk.cz) / lk.rz) ** 2 < 1.4);
  // forest clumps: a centre, then trees around it
  for (let c = 0; c < 70; c++) {
    const cx = (Math.random() - 0.5) * HALF * 1.9, cz = (Math.random() - 0.5) * HALF * 1.9;
    if (!pointInPoly(cx, cz, CITY.outline as Footprint)) continue;
    for (let k = 0; k < 14; k++) {
      const tx = cx + (Math.random() - 0.5) * 36, tz = cz + (Math.random() - 0.5) * 36;
      if (!pointInPoly(tx, tz, CITY.outline as Footprint) || distToRiver(tx, tz) < RIVER_HALF_W + 3 || nearWay(tx, tz) || nearGate(tx, tz) || inLake(tx, tz)) continue;
      addTree(tx, tz, 1.4 + Math.random() * 0.8);
    }
  }
}
for (let t2 = 0; t2 < (IS_BAMBERG ? 14 : 0); t2++) {
  const tx2 = (Math.random() - 0.5) * HALF * 1.6, tz2 = (Math.random() - 0.5) * HALF * 1.6;
  if (distToRiver(tx2, tz2) < RIVER_HALF_W + 6) continue;
  addTree(tx2, tz2);
}
// Avenue trees: walk each real street and drop trees along its verge, offset
// perpendicular to the road direction using the same ribbon-normal math the
// road mesh itself uses.
MAP.roads.forEach((road) => {
  const line = road.line;
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, z1] = line[i]!, [x2, z2] = line[i + 1]!;
    const segLen = Math.hypot(x2 - x1, z2 - z1);
    if (segLen < 6) continue;
    const steps = Math.floor(segLen / 14);
    for (let s = 1; s <= steps; s++) {
      if (Math.random() < 0.35) continue; // skip some gaps so it doesn't read as a picket fence
      const tt = s / (steps + 1);
      const mx = x1 + (x2 - x1) * tt, mz = z1 + (z2 - z1) * tt;
      const len = segLen || 1;
      const perpX = -(z2 - z1) / len, perpZ = (x2 - x1) / len;
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = road.width / 2 + 2.2;
      const fx = mx + perpX * offset * side, fz = mz + perpZ * offset * side;
      if (distToRiver(fx, fz) < RIVER_HALF_W + 3 || treeBlocked(fx, fz)) continue;
      if (!IS_BAMBERG && (road.width < 3 || Math.random() < 0.5)) continue; // big cities: fewer street trees, main streets only
      addTree(fx, fz, 0.85 + Math.random() * 0.3);
    }
  }
});

const trunkMesh = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6),
  new THREE.MeshStandardMaterial({ color: cssVar("--timber"), metalness: 0 }),
  treePlacements.length
);
const crownMesh = new THREE.InstancedMesh(
  new THREE.ConeGeometry(1.8, 3.6, 7),
  new THREE.MeshStandardMaterial({ color: "#5c7a45", flatShading: true, metalness: 0 }),
  treePlacements.length
);
trunkMesh.castShadow = true;
crownMesh.castShadow = true;
const treeMat4 = new THREE.Matrix4();
const noRot = new THREE.Quaternion();
treePlacements.forEach((p, i) => {
  const gy = terrainHeight(p.x, p.z);
  const s = new THREE.Vector3(p.scale, p.scale, p.scale);
  treeMat4.compose(new THREE.Vector3(p.x, gy + 1.2 * p.scale, p.z), noRot, s);
  trunkMesh.setMatrixAt(i, treeMat4);
  treeMat4.compose(new THREE.Vector3(p.x, gy + 3.8 * p.scale, p.z), noRot, s);
  crownMesh.setMatrixAt(i, treeMat4);
});
trunkMesh.instanceMatrix.needsUpdate = true;
crownMesh.instanceMatrix.needsUpdate = true;
scene.add(trunkMesh, crownMesh);

// ================= Street lamps =================
// Same road-walking placement technique as the avenue trees above, sparser.
// Poles are always-unlit geometry; every bulb shares ONE material, so
// updateStreetLamps() below is a single write regardless of lamp count.
const lampPlacements: { x: number; z: number }[] = [];
(IS_OVERVIEW ? [] : MAP.roads).forEach((road) => {
  const line = road.line;
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, z1] = line[i]!, [x2, z2] = line[i + 1]!;
    const segLen = Math.hypot(x2 - x1, z2 - z1);
    if (segLen < 6) continue;
    const steps = Math.floor(segLen / 11);
    for (let s = 1; s <= steps; s++) {
      const tt = s / (steps + 1);
      const mx = x1 + (x2 - x1) * tt, mz = z1 + (z2 - z1) * tt;
      const len = segLen || 1;
      const perpX = -(z2 - z1) / len, perpZ = (x2 - x1) / len;
      const side = Math.random() < 0.5 ? 1 : -1;
      const offset = road.width / 2 + 1.4;
      const fx = mx + perpX * offset * side, fz = mz + perpZ * offset * side;
      if (distToRiver(fx, fz) < RIVER_HALF_W + 3) continue;
      lampPlacements.push({ x: fx, z: fz });
    }
  }
});
const lampPoleMesh = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6),
  new THREE.MeshStandardMaterial({ color: "#2a2420", roughness: 0.8, metalness: 0.1 }),
  lampPlacements.length
);
const lampBulbMat = new THREE.MeshStandardMaterial({ color: "#3a3428", emissive: 0xffdd88, emissiveIntensity: 0, roughness: 0.5, metalness: 0 });
const lampBulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), lampBulbMat, lampPlacements.length);
lampPoleMesh.castShadow = true;
const lampMat4 = new THREE.Matrix4();
lampPlacements.forEach((p, i) => {
  const gy = terrainHeight(p.x, p.z);
  lampMat4.compose(new THREE.Vector3(p.x, gy + 1.7, p.z), noRot, new THREE.Vector3(1, 1, 1));
  lampPoleMesh.setMatrixAt(i, lampMat4);
  lampMat4.compose(new THREE.Vector3(p.x, gy + 3.5, p.z), noRot, new THREE.Vector3(1, 1, 1));
  lampBulbMesh.setMatrixAt(i, lampMat4);
});
lampPoleMesh.instanceMatrix.needsUpdate = true;
lampBulbMesh.instanceMatrix.needsUpdate = true;
scene.add(lampPoleMesh, lampBulbMesh);
function updateStreetLamps() {
  lampBulbMat.emissiveIntensity = nightFactor * 2.2;
}

// ================= Precipitation (rain/snow) =================
// A fixed pool of particles inside a cylinder volume, parented to a group
// that follows the player/kart each frame -- the classic "infinite rain"
// trick (recycle a particle to the top, at a random spot, once it falls
// below ground) rather than simulating real droplets. One shared point
// cloud serves both rain and snow; applyWeather() just changes its speed,
// drift, size and color.
const PRECIP_COUNT = 3200;
const PRECIP_RADIUS = 75, PRECIP_HEIGHT = 70; // tighter volume around the player than the first pass -- 1400 particles spread over a 140-radius cylinder read as barely-there specks
const precipPositions = new Float32Array(PRECIP_COUNT * 3);
for (let i = 0; i < PRECIP_COUNT; i++) {
  precipPositions[i * 3] = (Math.random() - 0.5) * PRECIP_RADIUS * 2;
  precipPositions[i * 3 + 1] = Math.random() * PRECIP_HEIGHT;
  precipPositions[i * 3 + 2] = (Math.random() - 0.5) * PRECIP_RADIUS * 2;
}
const precipGeo = new THREE.BufferGeometry();
precipGeo.setAttribute("position", new THREE.BufferAttribute(precipPositions, 3));
const precipMat = new THREE.PointsMaterial({ color: 0xbcd3e0, size: 0.16, transparent: true, opacity: 0, depthWrite: false });
const precipPoints = new THREE.Points(precipGeo, precipMat);
precipPoints.frustumCulled = false;
const precipGroup = new THREE.Group();
precipGroup.add(precipPoints);
scene.add(precipGroup);
function updatePrecipitation(dt: number, centerX: number, centerZ: number) {
  precipGroup.position.set(centerX, 0, centerZ);
  if (weather !== "rain" && weather !== "snow") return;
  const positions = precipGeo.attributes.position as THREE.BufferAttribute;
  const fallSpeed = weather === "rain" ? 55 : 6;
  const drift = weather === "snow" ? Math.sin(performance.now() * 0.0006) * 1.4 : 0;
  for (let i = 0; i < PRECIP_COUNT; i++) {
    let y = positions.getY(i) - fallSpeed * dt;
    let x = positions.getX(i) + drift * dt;
    if (y < 0) {
      y = PRECIP_HEIGHT;
      x = (Math.random() - 0.5) * PRECIP_RADIUS * 2;
      positions.setZ(i, (Math.random() - 0.5) * PRECIP_RADIUS * 2);
    }
    positions.setX(i, x);
    positions.setY(i, y);
  }
  positions.needsUpdate = true;
}

// ================= Hot air balloons =================
// Bamberg's own touch -- the region is known for its balloon festivals. A
// handful drift in slow lazy circles over the old town, high enough to
// never interfere with the ground game.
type Balloon = { group: THREE.Group; baseX: number; baseZ: number; radius: number; speed: number; phase: number; height: number };
const balloons: Balloon[] = [];
function makeBalloon(envelopeColor: string, stripeColor: string): THREE.Group {
  const g = new THREE.Group();
  const envelope = new THREE.Mesh(
    new THREE.SphereGeometry(6, 12, 10),
    new THREE.MeshStandardMaterial({ color: envelopeColor, flatShading: true, roughness: 0.85, metalness: 0 })
  );
  envelope.scale.set(1, 1.25, 1);
  envelope.position.y = 8;
  envelope.castShadow = true;
  const stripe = new THREE.Mesh(
    new THREE.SphereGeometry(6.05, 12, 10, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: stripeColor, flatShading: true, roughness: 0.85, metalness: 0 })
  );
  stripe.scale.set(1, 1.25, 1);
  stripe.position.y = 8;
  const basket = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1.6, 2),
    new THREE.MeshStandardMaterial({ color: cssVar("--timber"), roughness: 1, metalness: 0 })
  );
  basket.position.y = -1;
  basket.castShadow = true;
  g.add(envelope, stripe, basket);
  return g;
}
const BALLOON_COLORS: [string, string][] = [
  ["#c1445a", cssVar("--facade-cream")],
  ["#3f7ca8", cssVar("--facade-cream")],
  [cssVar("--facade-yellow"), "#5c7a45"],
  ["#8a5aa8", cssVar("--facade-cream")],
];
BALLOON_COLORS.forEach(([envelopeColor, stripeColor], i) => {
  const group = makeBalloon(envelopeColor, stripeColor);
  scene.add(group);
  balloons.push({
    group,
    baseX: (Math.random() - 0.5) * HALF,
    baseZ: (Math.random() - 0.5) * HALF,
    radius: 60 + Math.random() * 90,
    speed: 0.03 + Math.random() * 0.02,
    phase: (i / BALLOON_COLORS.length) * Math.PI * 2,
    height: 75 + i * 16,
  });
});

// ================= Drivable kart =================
// A real physics vehicle -- same technique as bruno-simon.com's go-kart
// (public, MIT-licensed: github.com/brunosimon/folio-2019, see
// src/javascript/World/Physics.js): a cannon-es RaycastVehicle chassis with
// 4 raycast wheels on a real physics world, not faked arcade math. That
// project runs its physics in a Z-up world and rotates everything into
// three.js's Y-up scene each frame; here the physics world is configured
// Y-up directly (indexUpAxis: 1) since three.js is already Y-up, so no
// per-frame axis juggling is needed.
const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) }); // heavier than real gravity -- reads as snappier/more "arcade" at this scale
physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
physicsWorld.defaultContactMaterial.friction = 0.3;
const groundPhysMaterial = new CANNON.Material("ground");

// Terrain collider: a Heightfield sampling the exact same terrainHeight()
// the ground mesh is built from, so the kart actually climbs the Domberg and
// Michaelsberg hills instead of clipping through them. Heightfield's local
// frame is X/Y-as-height by default; rotating the body -90 deg around X maps
// local Z (height) to world Y (up) and local Y to world -Z, which is why the
// sample loop below reads worldZ = HALF - yi*elementSize (derived from that
// rotation, not guessed).
const HF_SEGMENTS = 64;
const hfElementSize = (HALF * 2) / HF_SEGMENTS;
const hfData: number[][] = [];
for (let xi = 0; xi <= HF_SEGMENTS; xi++) {
  const col: number[] = [];
  const wx = -HALF + xi * hfElementSize;
  for (let yi = 0; yi <= HF_SEGMENTS; yi++) {
    col.push(terrainHeight(wx, HALF - yi * hfElementSize));
  }
  hfData.push(col);
}
const heightfieldBody = new CANNON.Body({ mass: 0, material: groundPhysMaterial });
heightfieldBody.addShape(new CANNON.Heightfield(hfData, { elementSize: hfElementSize }));
heightfieldBody.position.set(-HALF, 0, HALF);
heightfieldBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
physicsWorld.addBody(heightfieldBody);

// Landmark buildings get a rough static box collider each, so the kart can
// bump into the big sights. The ~260 background scatter buildings stay
// decoration-only -- real colliders for all of them isn't worth it for a
// casual arcade kart.
LANDMARKS.forEach((l) => {
  if (l.kind === "square" || l.kind === "fountain" || l.kind === "bridge") return; // open places: drive through
  const box = new CANNON.Body({ mass: 0, material: groundPhysMaterial });
  box.addShape(new CANNON.Box(new CANNON.Vec3(9, 6, 9)));
  box.position.set(l.x, 6, l.z);
  physicsWorld.addBody(box);
});

const FROM_CITY = new URLSearchParams(location.search).get("from") || "nuernberg";
const FROM_GATE = (CITY.portals || []).find((p) => p.id === FROM_CITY) || (CITY.portals || [])[0];
const PLAYER_SPAWN = IS_BAMBERG ? { x: 10, z: 16 } : IS_OVERVIEW && FROM_GATE ? { x: FROM_GATE.x + 20, z: FROM_GATE.z + 22 } : freeSpot(8, 8);
const KART_SPAWN = IS_BAMBERG ? { x: 13, z: 19 } : IS_OVERVIEW ? { x: PLAYER_SPAWN.x + 3, z: PLAYER_SPAWN.z + 2 } : freeSpot(PLAYER_SPAWN.x + 3, PLAYER_SPAWN.z + 2); // parked within reach of the player (E works from 5 m)
// Dimensions measured directly from the Kenney kart-oobi glTF's own accessor
// bounds (see the offline Python bounding-box extraction used while
// integrating it), not eyeballed -- the physics collider matches the real
// model instead of a guessed box. The model's own axes are already
// X-right/Y-up/Z-forward with its origin at ground/wheel-contact level, the
// same convention the vehicle below uses, so no axis remapping is needed --
// only the shape offset (the body sits above ground, not centered on it).
const chassisHalfExtents = new CANNON.Vec3(0.466, 0.296, 0.714);
const chassisShapeOffset = new CANNON.Vec3(0, 0.377, 0.112); // center of the body's bounding box, relative to the model's ground-level origin
const chassisBody = new CANNON.Body({ mass: 55 }); // was 140 for the old, much larger primitive box -- this real kart is a smaller volume
chassisBody.addShape(new CANNON.Box(chassisHalfExtents), chassisShapeOffset);
chassisBody.position.set(KART_SPAWN.x, terrainHeight(KART_SPAWN.x, KART_SPAWN.z) + 2, KART_SPAWN.z);
// The engine pushes at the wheels, well below this light kart's centre of mass, so full throttle used to flip it onto its
// tail within half a second (then no wheel touched the ground and it barely moved). An arcade kart only needs to turn:
// no pitch or roll, a little damping.
chassisBody.angularFactor.set(0, 1, 0);
chassisBody.angularDamping = 0.4;

// ---- Kart audio: synthesized (no sound files to fetch/license), started
// lazily on first entry since browsers require a user gesture -- "E" to
// get in the kart is that gesture. Engine pitch/volume track speed and
// throttle; horn and collision thud are short one-shot envelopes.
let audioCtx: AudioContext | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
function ensureKartAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  engineOsc = audioCtx.createOscillator();
  engineOsc.type = "sawtooth";
  engineOsc.frequency.value = 55;
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineGain).connect(audioCtx.destination);
  engineOsc.start();
}
function updateEngineSound(speedFrac: number, throttleMag: number) {
  if (!audioCtx || !engineOsc || !engineGain) return;
  const now = audioCtx.currentTime;
  engineOsc.frequency.setTargetAtTime(55 + speedFrac * 260, now, 0.06);
  engineGain.gain.setTargetAtTime(0.025 + throttleMag * 0.05 + speedFrac * 0.02, now, 0.08);
}
function silenceEngineSound() {
  if (!audioCtx || !engineGain) return;
  engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.15);
}
function playHorn() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = "square"; osc.frequency.value = 340;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now); osc.stop(now + 0.4);
}
function playThud(strength: number) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = "sine"; osc.frequency.setValueAtTime(110, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
  const vol = Math.min(0.4, 0.06 + strength * 0.05);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now); osc.stop(now + 0.3);
}
chassisBody.addEventListener("collide", (e: any) => {
  const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (impact > 3) playThud(impact);
});

const kartVehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
});
const wheelRadius = 0.21; // measured from the model's own wheel mesh bounds
const DRY_FRICTION_SLIP = 6; // was 1.5 -- Bruno's kart runs frictionSlip 10 on a much lighter (40 vs our 140 mass) chassis; our heavier chassis loads the suspension more, so this lands short of his raw number rather than matching it directly
const WET_FRICTION_SLIP = 2.2; // applyWeather() swaps every wheel to this during rain -- wet asphalt grips much less
const wheelBaseOptions: CANNON.WheelInfoOptions = {
  radius: wheelRadius,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  axleLocal: new CANNON.Vec3(1, 0, 0),
  suspensionStiffness: 32,
  suspensionRestLength: 0.32,
  frictionSlip: DRY_FRICTION_SLIP,
  dampingRelaxation: 2.3,
  dampingCompression: 4.4,
  maxSuspensionForce: 100000,
  rollInfluence: 0.02,
  maxSuspensionTravel: 0.3,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};
const WHEEL_FL = 0, WHEEL_FR = 1, WHEEL_BL = 2, WHEEL_BR = 3;
const WHEEL_MOUNT = 0.25; // the physics body now rides this much higher; the model is drawn this much lower to match
// Exact translations of the model's own wheel-front-left/-right/-back-left/
// -right nodes (measured, not guessed) -- order matters here, it lines up
// with WHEEL_FL..WHEEL_BR above and with the named-node lookup used to grab
// the matching visual meshes further down.
const wheelConnectionPoints: [number, number][] = [
  [0.277372271, 0.323733032], // front left
  [-0.277372271, 0.323733032], // front right
  [0.277372271, -0.3606073], // back left
  [-0.277372271, -0.3606073], // back right
];
wheelConnectionPoints.forEach(([wx, wz]) => {
  // mounted WHEEL_MOUNT above the body's origin: after a hard landing the body can bottom out on the ground, and rays that
  // start at ground level (as before) then never hit anything again -- the kart was stuck for good
  kartVehicle.addWheel({ ...wheelBaseOptions, chassisConnectionPointLocal: new CANNON.Vec3(wx, WHEEL_MOUNT, wz) });
});
kartVehicle.addToWorld(physicsWorld);

// Kart visual: the real modeled Kenney kart, not hand-built primitives.
const kartGltf = await kartGltfPromise;
const characterGltfs = await Promise.all(characterGltfPromises);
const kartGroup = kartGltf.scene;
kartGroup.traverse((obj) => {
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
});
// The wheel nodes get WORLD-space transforms directly from the physics
// vehicle's wheelInfos every frame (see loop() below) -- they can't stay
// nested under kartGroup's own moving/rotating transform, or that world
// transform would apply a second time on top of the parent's. Re-parent
// them to the scene root; scene.add() below re-adds kartGroup itself after,
// so draw order still groups them visually on load.
const kartWheelMeshes: THREE.Object3D[] = ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"].map((name) => {
  const node = kartGroup.getObjectByName(name)!;
  scene.add(node);
  return node;
});
scene.add(kartGroup);
kartGroup.position.set(chassisBody.position.x, chassisBody.position.y - WHEEL_MOUNT, chassisBody.position.z);
for (let i = 0; i < 4; i++) {
  kartVehicle.updateWheelTransform(i);
  const wt = kartVehicle.wheelInfos[i]!.worldTransform;
  kartWheelMeshes[i]!.position.set(wt.position.x, wt.position.y, wt.position.z);
}

// A jump ramp right by the spawn -- driving over real Bamberg terrain is
// the point of this kart, but a real go-kart game (see: Bruno's) also gives
// you something to actually do besides drive around, so there's one built
// in near where you get in. The resting position is derived from the
// rotation, not eyeballed: rotating a box -RAMP_ANGLE about X raises its
// +local-Z (forward, toward +world-Z from spawn) end, and the center height
// below places its low edge exactly at ground level.
const RAMP_ANGLE = 16 * (Math.PI / 180);
const RAMP_LEN = 12, RAMP_WIDTH = 6, RAMP_THICK = 0.5;
const rampX = KART_SPAWN.x, rampZ = KART_SPAWN.z + 18;
const rampBaseY = terrainHeight(rampX, rampZ);
const rampBody = new CANNON.Body({ mass: 0, material: groundPhysMaterial });
rampBody.addShape(new CANNON.Box(new CANNON.Vec3(RAMP_WIDTH / 2, RAMP_THICK / 2, RAMP_LEN / 2)));
// sunk by its own thickness so the low end is flush with the ground: a 0.5 m lip used to stop the kart dead
rampBody.position.set(rampX, rampBaseY - (RAMP_THICK / 2) * Math.cos(RAMP_ANGLE) + (RAMP_LEN / 2) * Math.sin(RAMP_ANGLE), rampZ);
rampBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -RAMP_ANGLE);
const HAS_RAMP = IS_BAMBERG || IS_OVERVIEW; // the dense old towns have no room for it
if (HAS_RAMP) physicsWorld.addBody(rampBody);
const rampMesh = new THREE.Mesh(
  new THREE.BoxGeometry(RAMP_WIDTH, RAMP_THICK, RAMP_LEN),
  new THREE.MeshStandardMaterial({ color: cssVar("--facade-yellow"), flatShading: true, roughness: 0.85, metalness: 0 })
);
rampMesh.position.set(rampBody.position.x, rampBody.position.y, rampBody.position.z);
rampMesh.quaternion.set(rampBody.quaternion.x, rampBody.quaternion.y, rampBody.quaternion.z, rampBody.quaternion.w);
rampMesh.castShadow = true;
rampMesh.receiveShadow = true;
if (HAS_RAMP) scene.add(rampMesh);

let driving = false;
let nearKart = false;
let kartSteer = 0;
const KART_MAX_STEER = 0.5;
const KART_ENGINE_FORCE = 700; // per rear wheel; 1800 on a 55 kg kart was a rocket that flipped it
const KART_MAX_SPEED = 24; // m/s-ish before engine force cuts out

function enterKart() {
  driving = true;
  chassisBody.velocity.setZero();
  chassisBody.angularVelocity.setZero();
  chassisBody.position.set(player.x, terrainHeight(player.x, player.z) + 1, player.z);
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), player.rotY);
  kartSteer = 0;
  kartLookYaw = 0;
  player.mesh!.visible = false;
  carPromptEl.classList.remove("show");
  ensureKartAudio(); // the "E" keypress that got us here is the user gesture browsers require
}
function exitKart() {
  driving = false;
  player.x = chassisBody.position.x;
  player.z = chassisBody.position.z;
  player.mesh!.visible = true;
  silenceEngineSound();
}
function kartJump() {
  if (kartVehicle.numWheelsOnGround === 0) return; // no mid-air double-jumps
  chassisBody.applyImpulse(new CANNON.Vec3(0, 55, 0), chassisBody.position);
}

// ================= Player + peer avatars =================
// A blocky little figure (legs, torso, arms, head) instead of the previous
// capsule-and-sphere "snowman" -- reads as a person at a glance and matches
// the low-poly, sharp-edged style of the buildings around it.
// Limbs are pivot Groups anchored at the joint (hip/shoulder) with the box
// mesh offset downward inside them, so rotating the pivot swings the limb
// from the joint instead of spinning it around its own middle.
// Real modeled + animated characters (Kenney "Blocky Characters") instead
// of hand-built box limbs. Each is a plain node hierarchy with no
// skeleton/skin (confirmed by inspecting the glTF directly), so an ordinary
// deep .clone() is enough -- no SkeletonUtils needed -- and the bundled
// "idle"/"walk" AnimationClips replay correctly on the clone because
// AnimationMixer resolves clip tracks by node name, which .clone() preserves.
type AvatarRig = { group: THREE.Group; mixer: THREE.AnimationMixer; idleAction: THREE.AnimationAction; walkAction: THREE.AnimationAction };
// The model's real native height, measured by composing the actual node
// hierarchy (feet at y=0 on leg-left/-right, up through torso to head --
// head carries its own scale:[0.1,0.1,0.1] on an 8-unit mesh, easy to miss
// if you only skim translations) works out to ~2.7 units, already close to
// the old hand-built avatar's ~2.85. An earlier guess of "~1 unit native"
// was wrong and had this scaling up 2.8x -- nearly 3x too tall.
const AVATAR_SCALE = 2.85 / 2.7;
function makeAvatar(variantIdx: number): AvatarRig {
  const gltf = characterGltfs[variantIdx]!;
  const group = gltf.scene.clone(true) as THREE.Group;
  group.scale.setScalar(AVATAR_SCALE);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  const mixer = new THREE.AnimationMixer(group);
  const idleClip = THREE.AnimationClip.findByName(gltf.animations, "idle")!;
  const walkClip = THREE.AnimationClip.findByName(gltf.animations, "walk")!;
  const idleAction = mixer.clipAction(idleClip).play();
  const walkAction = mixer.clipAction(walkClip).play();
  walkAction.setEffectiveWeight(0);
  return { group, mixer, idleAction, walkAction };
}

// Crossfades idle <-> walk and advances the mixer -- called every frame for
// the player and every peer, `amount` easing 0->1 as they start/stop moving
// so the stride doesn't snap on and off.
function animateWalk(rig: AvatarRig, dt: number, amount: number) {
  rig.walkAction.setEffectiveWeight(amount);
  rig.idleAction.setEffectiveWeight(1 - amount);
  rig.mixer.update(dt);
}

function variantForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % CHARACTER_VARIANTS.length;
}

// ---- Walking collision: ordinary houses are solid (you slide along the wall). Landmarks and houses right next
// to them stay walk-through, because landmarks are collected by getting within 13 m of their centre and some
// are bigger than that. Starting inside a house never traps you: only ENTERING one is blocked.
type Solid = { poly: Footprint; minX: number; maxX: number; minZ: number; maxZ: number };
const SOLID_CELL = 20;
const solidGrid = new Map<string, Solid[]>();
(function buildSolids() {
  for (const b of MAP.scatter_buildings) {
    const f = b.footprint;
    const cx = f.reduce((a, p) => a + p[0]!, 0) / f.length, cz = f.reduce((a, p) => a + p[1]!, 0) / f.length;
    if (LANDMARKS.some((l) => Math.hypot(l.x - cx, l.z - cz) < 22)) continue;
    const xs = f.map((p) => p[0]!), zs = f.map((p) => p[1]!);
    const sd: Solid = { poly: f, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    for (let gx = Math.floor(sd.minX / SOLID_CELL); gx <= Math.floor(sd.maxX / SOLID_CELL); gx++)
      for (let gz = Math.floor(sd.minZ / SOLID_CELL); gz <= Math.floor(sd.maxZ / SOLID_CELL); gz++) {
        const k = gx + "," + gz;
        if (!solidGrid.has(k)) solidGrid.set(k, []);
        solidGrid.get(k)!.push(sd);
      }
  }
})();
function insideSolid(x: number, z: number, pad = 0.7): boolean {
  const list = solidGrid.get(Math.floor(x / SOLID_CELL) + "," + Math.floor(z / SOLID_CELL));
  if (!list) return false;
  for (const sd of list) {
    if (x < sd.minX - pad || x > sd.maxX + pad || z < sd.minZ - pad || z > sd.maxZ + pad) continue;
    const f = sd.poly;
    let inside = false, near = false;
    for (let i = 0, j = f.length - 1; i < f.length; j = i++) {
      const [xi, zi] = f[i] as [number, number], [xj, zj] = f[j] as [number, number];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const ex = xj - xi, ez = zj - zi, L = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / L));
      if (Math.hypot(x - (xi + t * ex), z - (zi + t * ez)) < pad) near = true;
    }
    if (inside || near) return true;
  }
  return false;
}
/** Move the walker by (mx, mz), sliding along walls. Returns false when completely blocked. */
function walkBy(mx: number, mz: number): boolean {
  const clamp = (v: number) => Math.max(-HALF, Math.min(HALF, v));
  const nx = clamp(player.x + mx), nz = clamp(player.z + mz);
  if (insideSolid(player.x, player.z) || !insideSolid(nx, nz)) { player.x = nx; player.z = nz; return true; }
  if (!insideSolid(nx, player.z)) { player.x = nx; return Math.abs(mx) > 1e-4; }
  if (!insideSolid(player.x, nz)) { player.z = nz; return Math.abs(mz) > 1e-4; }
  return false;
}

// ---- Guide: which uncollected landmark is nearest, and which way it is from where the camera looks.
function updateGuide() {
  const el = document.getElementById("guideHud")!;
  const left = LANDMARKS.filter((l) => !isCollected(l));
  if (!joined || !left.length) { el.style.display = "none"; return; }
  const px = driving ? kartGroup.position.x : player.x, pz = driving ? kartGroup.position.z : player.z;
  let best = left[0]!, bd = Infinity;
  for (const l of left) { const d = Math.hypot(l.x - px, l.z - pz); if (d < bd) { bd = d; best = l; } }
  // Direction in the camera's own space (x = screen right, -z = away from the camera), so the arrow always
  // matches what's on screen whichever way the camera is turned; 0 rad = straight up.
  const a = new THREE.Vector3(px, 0, pz).applyMatrix4(camera.matrixWorldInverse);
  const t = new THREE.Vector3(best.x, 0, best.z).applyMatrix4(camera.matrixWorldInverse);
  document.getElementById("guideArrow")!.style.transform = `rotate(${Math.atan2(t.x - a.x, -(t.z - a.z))}rad)`;
  document.getElementById("guideName")!.textContent = tl(best).label + " · +" + best.points;
  document.getElementById("guideDist")!.textContent = IS_OVERVIEW ? Math.round((bd * (CITY.m_per_unit || 327)) / 1000) + " km" : Math.round(bd) + " m";
  el.style.display = "flex";
}

const player = { x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, rotY: 0, mesh: null as THREE.Group | null, rig: null as AvatarRig | null, walkAmount: 0, speedEase: 0, speed: 26 }; // just outside the Rathaus's own footprint

// ================= Player identity =================
const PLAYER_KEY = "littleBamberg.playerId";
let playerId: string;
try {
  playerId = localStorage.getItem(PLAYER_KEY) || "";
  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem(PLAYER_KEY, playerId);
  }
} catch (e) {
  playerId = "session-" + Math.random().toString(16).slice(2);
}
const myVariant = variantForId(playerId);

const state = { name: "", score: 0, collected: [] as string[] };

// ================= Leaderboard + player persistence (own backend) =================
async function ensurePlayerDoc() {
  try {
    const res = await fetch("/api/player?id=" + encodeURIComponent(playerId));
    const data = await res.json();
    if (!data.exists) {
      await fetch("/api/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: playerId, name: state.name, score: state.score, collected: state.collected }),
      });
    } else {
      state.score = typeof data.score === "number" ? data.score : 0;
      state.collected = Array.isArray(data.collected) ? data.collected : [];
      await fetch("/api/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: playerId, name: state.name, score: state.score, collected: state.collected }),
      });
    }
  } catch (e) { /* offline -- keep playing locally */ }
}
async function persistProgress() {
  try {
    await fetch("/api/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: playerId, name: state.name, score: state.score, collected: state.collected }),
    });
  } catch (e) { /* transient failures are fine to drop */ }
}
let lastBoardRows: { id: string; name: string; score: number }[] = [];
function renderBoard(rows: { id: string; name: string; score: number }[]) {
  lastBoardRows = rows;
  const list = document.getElementById("boardList")!;
  const empty = document.getElementById("boardEmpty")!;
  list.innerHTML = "";
  if (!rows.length) { empty.style.display = "block"; return; }
  empty.style.display = "none";
  rows.forEach((r) => {
    const li = document.createElement("li");
    if (r.id === playerId) li.className = "me";
    const nameSpan = document.createElement("span");
    nameSpan.className = "name";
    nameSpan.textContent = (r.name || "?") + (r.id === playerId ? " " + tr("youSuffix") : "");
    const ptsSpan = document.createElement("span");
    ptsSpan.className = "pts";
    ptsSpan.textContent = String(r.score || 0);
    li.appendChild(nameSpan); li.appendChild(ptsSpan);
    list.appendChild(li);
  });
}
async function pollLeaderboard() {
  try {
    const res = await fetch("/api/leaderboard");
    renderBoard(await res.json());
  } catch (e) { /* keep showing the last known board */ }
}
pollLeaderboard();
setInterval(pollLeaderboard, 4000);

// ================= Live multiplayer presence (own WebSocket) =================
interface Peer { mesh: THREE.Group; rig: AvatarRig; walkAmount: number; nameEl: HTMLDivElement; x: number; z: number; rotY: number; target: { x: number; z: number; rotY: number; name: string } }
const peers: Record<string, Peer> = {};
let ws: WebSocket | null = null;

function connectWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host + "/ws");
  ws.onmessage = (ev) => {
    let msg: any;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "presence" && (msg.city || "bamberg") !== CITY_ID) {
      const pid = msg.id as string; // they're in another city: drop them from this one if they were here
      if (peers[pid]) { scene.remove(peers[pid]!.mesh); peers[pid]!.nameEl.remove(); delete peers[pid]; }
    } else if (msg.type === "presence") {
      const pid = msg.id as string;
      if (!peers[pid]) {
        const rig = makeAvatar(variantForId(pid));
        scene.add(rig.group);
        const nameEl = document.createElement("div");
        nameEl.className = "label3d player";
        document.getElementById("labels")!.appendChild(nameEl);
        peers[pid] = { mesh: rig.group, rig, walkAmount: 0, nameEl, x: msg.x, z: msg.z, rotY: msg.rotY || 0, target: msg };
      }
      peers[pid]!.target = msg;
    } else if (msg.type === "leave") {
      const pid = msg.id as string;
      if (peers[pid]) {
        scene.remove(peers[pid]!.mesh);
        peers[pid]!.nameEl.remove();
        delete peers[pid];
      }
    }
  };
  ws.onclose = () => { setTimeout(connectWs, 1500); };
}
connectWs();

let lastPresenceSent = 0;
function sendPresence(t: number) {
  if (!ws || ws.readyState !== WebSocket.OPEN || t - lastPresenceSent < 110) return;
  lastPresenceSent = t;
  ws.send(JSON.stringify({ type: "presence", x: player.x, z: player.z, rotY: player.rotY, name: state.name, city: CITY_ID }));
}

// ================= Join flow =================
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const joinBtn = document.getElementById("joinBtn") as HTMLButtonElement;
try {
  const savedName = localStorage.getItem("littleBamberg.name");
  if (savedName) nameInput.value = savedName;
} catch (e) {}

joinBtn.addEventListener("click", startGame);
nameInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") startGame(); });

let joined = false;
async function startGame() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.style.outline = "2px solid var(--roof)";
    setTimeout(() => { nameInput.style.outline = ""; }, 900);
    return;
  }
  state.name = name.slice(0, 18);
  try { localStorage.setItem("littleBamberg.name", state.name); } catch (e) {}

  joinBtn.disabled = true;
  joinBtn.textContent = tr("joining");
  await ensurePlayerDoc();
  joinBtn.disabled = false;
  joinBtn.textContent = tr("joinCta");

  nameInput.blur(); // make sure WASD reaches the game, not a hidden text field
  document.getElementById("hero-copy")!.style.display = "none";
  document.getElementById("scoreHud")!.style.display = "flex";
  document.getElementById("topRightHud")!.style.display = "flex";
  document.getElementById("joystick")!.classList.add("game-active");
  document.getElementById("cameraHint")!.classList.add("game-active");
  updateScoreHud();
  joined = true;
  showHint();
}

// ---- Language toggle: swaps every static + dynamic UI string, persisted
// across visits. Landmark text goes through tl() (defined above, near
// LANDMARKS); everything else through t() against UI_TEXT.
function applyLanguage() {
  document.title = tr("title");
  document.getElementById("loading")!.textContent = tr("loading");
  document.getElementById("txtEyebrow")!.textContent = tr("eyebrow");
  document.getElementById("txtTitle")!.textContent = tr("title");
  document.getElementById("txtTagline")!.textContent = tr("tagline");
  document.getElementById("txtNameLabel")!.textContent = tr("nameLabel");
  nameInput.placeholder = tr("namePlaceholder");
  joinBtn.textContent = joinBtn.disabled ? tr("joining") : tr("joinCta");
  document.getElementById("txtFootnote")!.textContent = tr("footnote");
  document.getElementById("txtScoreLabel")!.textContent = lang === "ml" ? CITY.name_ml : CITY.name_en;
  document.getElementById("travelToggle")!.textContent = tr("travel");
  document.getElementById("travelToggleHero")!.textContent = "📍 " + (lang === "ml" ? CITY.name_ml : CITY.name_en) + " · " + tr("travel");
  document.getElementById("travelTitle")!.textContent = tr("travelTitle");
  document.getElementById("travelNote")!.textContent = tr("travelNote");
  document.getElementById("travelClose")!.textContent = tr("travelClose");
  if (!document.getElementById("travel")!.hidden) renderTravel();
  document.getElementById("boardToggle")!.textContent = tr("boardToggle");
  document.getElementById("txtBoardTitle")!.textContent = tr("boardTitle");
  document.getElementById("boardEmpty")!.textContent = tr("boardEmpty");
  document.getElementById("hint")!.textContent = tr("hint");
  document.getElementById("cameraHint")!.textContent = tr("cameraHint");
  document.getElementById("langToggle")!.textContent = tr("langChip");
  document.getElementById("langToggleGame")!.textContent = tr("langChip");
  updateDayNightButton();
  updateWeatherButton();
  landmarkLabels.forEach((el, i) => { el.textContent = tl(LANDMARKS[i]!).label; });
  renderBoard(lastBoardRows);
}
function toggleLanguage() {
  lang = lang === "ml" ? "en" : "ml";
  try { localStorage.setItem("littleBamberg.lang", lang); } catch (e) {}
  applyLanguage();
}
// ================= Travel: a map of Bavaria with every city =================
function cityProgress(c: CityMeta): { got: number; of: number } {
  const ids = c.id === "bamberg" ? ["rathaus", "dom", "venedig", "schlenkerla", "rosengarten", "concordia", "maxplatz"] : c.landmarks.map((l) => c.id + ":" + l.id);
  return { got: ids.filter((k) => state.collected.indexOf(k) !== -1).length, of: ids.length };
}
function renderTravel() {
  const svg = document.getElementById("travelMap")!;
  const outline = bavariaOutline as number[][];
  const lats = outline.map((p) => p[0]!), lons = outline.map((p) => p[1]!);
  const k = Math.cos(49 * Math.PI / 180);
  const minX = Math.min(...lons) * k, maxX = Math.max(...lons) * k, minY = Math.min(...lats), maxY = Math.max(...lats);
  const W = 640, H = 520, pad = 18;
  const sc = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY));
  const px = (lat: number, lon: number) => [pad + (lon * k - minX) * sc, pad + (maxY - lat) * sc];
  const path = outline.map((p, i) => { const [x, y] = px(p[0]!, p[1]!); return (i ? "L" : "M") + x!.toFixed(1) + "," + y!.toFixed(1); }).join("") + "Z";
  const pts = ALL_CITIES.map((c) => ({ c, xy: px(c.latlon[0]!, c.latlon[1]!) }));
  const order = ["wuerzburg", "bamberg", "erlangen", "nuernberg", "regensburg", "muenchen", "augsburg"]; // a rail loop
  const rail = order.map((id, i) => { const p = pts.find((q) => q.c.id === id)!.xy; return (i ? "L" : "M") + p[0]!.toFixed(1) + "," + p[1]!.toFixed(1); }).join("");
  const name = (c: CityMeta) => (lang === "ml" ? c.name_ml : c.name_en);
  svg.innerHTML = `<path class="land" d="${path}"/><path class="rail" d="${rail}"/>` + pts.map(({ c, xy }) => {
    const p = cityProgress(c), here = c.id === CITY_ID;
    // close neighbours (Würzburg/Bamberg, Erlangen/Nürnberg) put their labels on opposite sides
    const right = ({ wuerzburg: false, nuernberg: false, augsburg: false } as Record<string, boolean>)[c.id] ?? xy[0]! < W - 150;
    const dy = ({ nuernberg: 14, erlangen: -8, bamberg: -8, wuerzburg: 10 } as Record<string, number>)[c.id] ?? 0;
    return `<g class="city${here ? " here" : ""}" data-city="${c.id}" tabindex="0" role="button" aria-label="${name(c)}">
      <circle cx="${xy[0]}" cy="${xy[1]}" r="8"/>
      <text x="${xy[0]! + (right ? 14 : -14)}" y="${xy[1]! - 2 + dy}" text-anchor="${right ? "start" : "end"}">${name(c)}</text>
      <text class="sub" x="${xy[0]! + (right ? 14 : -14)}" y="${xy[1]! + 14 + dy}" text-anchor="${right ? "start" : "end"}">${here ? tr("travelHere") + " · " : ""}${p.got}/${p.of}</text></g>`;
  }).join("");
  document.getElementById("travelList")!.innerHTML = `<button class="chip road" data-city="bayern" type="button"${IS_OVERVIEW ? ' aria-current="true"' : ""}>${tr("roadTrip")}</button>` + ALL_CITIES.map((c) => {
    const p = cityProgress(c);
    return `<button class="chip" data-city="${c.id}" type="button"${c.id === CITY_ID ? ' aria-current="true"' : ""}>${name(c)} · ${p.got}/${p.of}</button>`;
  }).join("");
}
function goToCity(id: string) {
  if (id === CITY_ID) { document.getElementById("travel")!.hidden = true; return; }
  try { localStorage.setItem("littleBamberg.city", id); } catch (e) {}
  document.getElementById("travelNote")!.textContent = tr("travelling");
  location.search = "?city=" + encodeURIComponent(id) + (id === "bayern" ? "&from=" + encodeURIComponent(IS_OVERVIEW ? FROM_CITY : CITY_ID) : "");
}
function openTravel() { renderTravel(); document.getElementById("travel")!.hidden = false; }
document.getElementById("travelToggle")!.addEventListener("click", openTravel);
document.getElementById("travelToggleHero")!.addEventListener("click", openTravel);
document.getElementById("travelClose")!.addEventListener("click", () => { document.getElementById("travel")!.hidden = true; });
document.getElementById("travel")!.addEventListener("click", (e) => {
  const t = (e.target as Element).closest("[data-city]");
  if (t) goToCity(t.getAttribute("data-city")!);
  else if (e.target === e.currentTarget) document.getElementById("travel")!.hidden = true;
});
document.getElementById("travel")!.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.getElementById("travel")!.hidden = true;
  const t = (e.target as Element).closest?.("[data-city]");
  if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); goToCity(t.getAttribute("data-city")!); }
});

document.getElementById("langToggle")!.addEventListener("click", toggleLanguage);
document.getElementById("langToggleGame")!.addEventListener("click", toggleLanguage);

// ---- Day/night toggle: cycles Live (follows the real clock, the default) ->
// Day -> Night -> back to Live. Manual modes hold a fixed sun angle; Live
// re-syncs to the real time every 30s (see the loop() call to this).
type SunMode = "auto" | "day" | "night";
let sunMode: SunMode = "auto";
try { sunMode = (localStorage.getItem("littleBamberg.sunMode") as SunMode) || "auto"; } catch (e) {}
function updateDayNightButton() {
  const label = sunMode === "auto" ? tr("sunAuto") : sunMode === "day" ? tr("sunDay") : tr("sunNight");
  document.getElementById("dayNightToggle")!.textContent = label;
}
function applySunMode() {
  if (sunMode === "auto") {
    updateSunFromRealTime();
  } else if (sunMode === "day") {
    setSunAngle(50, 56);
    moonMat.opacity = 0;
  } else {
    setSunAngle(-25, 56);
    updateMoon(new Date());
  }
  updateBuildingNightLights();
  updateStreetLamps();
  updateDayNightButton();
}
document.getElementById("dayNightToggle")!.addEventListener("click", () => {
  sunMode = sunMode === "auto" ? "day" : sunMode === "day" ? "night" : "auto";
  try { localStorage.setItem("littleBamberg.sunMode", sunMode); } catch (e) {}
  applySunMode();
});
if (sunMode !== "auto") applySunMode(); // apply a persisted manual mode; "auto" is already live from updateSunFromRealTime() above
updateBuildingNightLights(); // applySunMode() above only runs (and only updates these) for a persisted non-auto mode -- cover the default "auto" case too, or lit windows/lamps would stay off until the first 30s resync
updateStreetLamps();

// ---- Weather toggle: cycles Clear -> Cloudy -> Rain -> Snow -> back to
// Clear. Drives cloud coverage (reusing the Sky's own uniforms), fog
// distance, the road material's wet sheen, precipitation particles, and the
// kart's wheel grip. NOTE: applyWeather()'s initial call happens at the very
// end of this file, not here -- scene.fog doesn't exist until
// applyThemeColors() runs (much further down), so mutating scene.fog.near
// this early would throw on a null fog.
type Weather = "clear" | "cloudy" | "rain" | "snow";
let weather: Weather = "clear";
try { weather = (localStorage.getItem("littleBamberg.weather") as Weather) || "clear"; } catch (e) {}
function updateWeatherButton() {
  const key = weather === "clear" ? "weatherClear" : weather === "cloudy" ? "weatherCloudy" : weather === "rain" ? "weatherRain" : "weatherSnow";
  document.getElementById("weatherToggle")!.textContent = tr(key);
}
document.getElementById("weatherToggle")!.addEventListener("click", () => {
  weather = weather === "clear" ? "cloudy" : weather === "cloudy" ? "rain" : weather === "rain" ? "snow" : "clear";
  try { localStorage.setItem("littleBamberg.weather", weather); } catch (e) {}
  applyWeather();
});
function applyWeather() {
  const isRain = weather === "rain", isSnow = weather === "snow", isCloudy = weather === "cloudy";

  skyUniforms.cloudCoverage.value = weather === "clear" ? 0.22 : isCloudy ? 0.55 : 0.75;
  skyUniforms.cloudDensity.value = weather === "clear" ? 0.3 : isCloudy ? 0.5 : 0.62;

  if (scene.fog) {
    const fog = scene.fog as THREE.Fog;
    fog.near = weather === "clear" ? 160 : isCloudy ? 120 : 60;
    fog.far = weather === "clear" ? 650 : isCloudy ? 480 : 260;
  }

  for (const mat of roadMaterials) {
    mat.roughness = isRain ? 0.35 : 1;
    mat.metalness = isRain ? 0.25 : 0;
  }

  for (let i = 0; i < 4; i++) {
    kartVehicle.wheelInfos[i]!.frictionSlip = isRain ? WET_FRICTION_SLIP : DRY_FRICTION_SLIP;
  }

  precipMat.opacity = isRain ? 0.55 : isSnow ? 0.85 : 0;
  precipMat.size = isSnow ? 0.55 : 0.3;
  precipMat.color.set(isSnow ? 0xffffff : 0xbcd3e0);

  updateWeatherButton();
}

function updateScoreHud() {
  // this city's points out of its total; the leaderboard shows the all-cities total
  document.getElementById("scoreValue")!.textContent = String(cityScore());
  document.getElementById("scoreTotal")!.textContent = " / " + TOTAL_POSSIBLE;
}
function showHint() {
  const hint = document.getElementById("hint")!;
  hint.classList.add("show");
  setTimeout(() => hint.classList.remove("show"), 3400);
}

// ================= Input =================
const keys: Record<string, boolean> = {};
function isTypingTarget(el: Element | null): boolean {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}
window.addEventListener("keydown", (e) => {
  if (isTypingTarget(document.activeElement)) return; // never hijack WASD while the name field (or anything else) has focus
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].indexOf(k) !== -1) {
    keys[k] = true; e.preventDefault();
  }
  if (k === "e" && joined) {
    if (driving) exitKart();
    else if (nearKart) enterKart();
  }
  if (k === "h" && driving) playHorn();
  if (k === " " && driving) { e.preventDefault(); kartJump(); }
});
const carPromptEl = document.getElementById("carPrompt")!;
window.addEventListener("keyup", (e) => {
  if (isTypingTarget(document.activeElement)) return;
  keys[e.key.toLowerCase()] = false;
});
// Virtual analog joystick (mobile): drag from anywhere inside the base to
// steer; direction + push distance both matter, unlike the old 4-button pad
// which could only ever be one of 8 fixed directions.
let joyX = 0, joyZ = 0; // world-relative, matches WASD -- not camera-relative
(function initJoystick() {
  const el = document.getElementById("joystick")!;
  const knob = document.getElementById("joystickKnob")!;
  const maxR = 34;
  let pointerId = -1;
  function setKnob(dx: number, dz: number) {
    knob.style.transform = `translate(${dx}px, ${dz}px)`;
  }
  function update(clientX: number, clientY: number) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    setKnob(dx, dy);
    joyX = dx / maxR;
    joyZ = dy / maxR;
    if (joyX || joyZ) moveTarget = null; // manual steering overrides a pending click-to-move
  }
  el.addEventListener("pointerdown", (e) => {
    pointerId = e.pointerId;
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== pointerId) return;
    update(e.clientX, e.clientY);
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    joyX = 0; joyZ = 0;
    el.classList.remove("dragging");
    setKnob(0, 0);
    try { el.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
})();

// Click/tap-to-move (desktop mouse): a short tap on the ground raycasts to a
// world point and the player auto-walks there, overridden the instant WASD
// or the joystick is used.
let moveTarget: { x: number; z: number } | null = null;
const moveRaycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ================= Player avatar in scene =================
const playerRig = makeAvatar(myVariant);
player.mesh = playerRig.group;
player.rig = playerRig;
scene.add(player.mesh);
const myNameEl = document.createElement("div");
myNameEl.className = "label3d player me";
document.getElementById("labels")!.appendChild(myNameEl);

// ---- Road trip: a gate per city; walk or drive into it to go there
const GATES = (CITY.portals || []).map((p) => {
  const c = ALL_CITIES.find((x) => x.id === p.id)!;
  const g = new THREE.Group();
  for (const side of [-1, 1]) { const pil = box(2.2, 11, 2.2, cssVar("--sandstone")); pil.position.set(side * 6, 5.5, 0); pil.castShadow = true; g.add(pil); }
  const lintel = box(15, 2, 2.6, cssVar("--roof")); lintel.position.y = 12; g.add(lintel);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32), new THREE.MeshStandardMaterial({ color: "#ffe6a3", emissive: 0xffd26b, emissiveIntensity: 1.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  glow.position.y = 5.8; g.add(glow);
  g.position.set(p.x, terrainHeight(p.x, p.z), p.z);
  scene.add(g);
  const el = document.createElement("div");
  el.className = "label3d gate";
  document.getElementById("labels")!.appendChild(el);
  return { ...p, city: c, group: g, el, glow };
});
let gateLeaving = false, gatesArmed = false; // armed once you've moved clear of every gate, so you never bounce straight back
function checkGates(t: number) {
  if (!GATES.length) return;
  if (!gatesArmed && GATES.every((gt) => Math.hypot(player.x - gt.x, player.z - gt.z) > 14)) gatesArmed = true;
  for (const gt of GATES) {
    (gt.glow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + 0.4 * Math.sin(t / 400);
    gt.el.textContent = "→ " + (lang === "ml" ? gt.city.name_ml : gt.city.name_en);
    updateLabel(gt.el, new THREE.Vector3(gt.x, terrainHeight(gt.x, gt.z) + 16, gt.z));
    if (joined && gatesArmed && !gateLeaving && Math.hypot(player.x - gt.x, player.z - gt.z) < 7) {
      gateLeaving = true;
      showToast({ label: tr("travelling"), flavor: lang === "ml" ? gt.city.name_ml : gt.city.name_en, points: 0 });
      persistProgress();
      setTimeout(() => goToCity(gt.id), 900);
    }
  }
}

const landmarkLabels = LANDMARKS.map((l) => {
  const el = document.createElement("div");
  el.className = "label3d";
  el.textContent = tl(l).label;
  document.getElementById("labels")!.appendChild(el);
  return el;
});

// ================= Collectibles =================
const collectingLock: Record<string, boolean> = {};
function checkCollisions() {
  if (!joined) return;
  LANDMARKS.forEach((l) => {
    if (isCollected(l)) return;
    if (collectingLock[l.id]) return;
    const d = Math.hypot(player.x - l.x, player.z - l.z);
    if (d < 13) { collectingLock[l.id] = true; collect(l); }
  });
}
function collect(landmark: Landmark) {
  state.collected.push(lmKey(landmark));
  state.score += landmark.points;
  updateScoreHud();
  const text = tl(landmark);
  showToast({ label: text.label, flavor: text.flavor, points: landmark.points });
  persistProgress();
  if (LANDMARKS.every(isCollected)) {
    setTimeout(() => {
      showToast({ label: tr("completeLabel"), flavor: tr("completeFlavor"), points: 0 });
    }, 2600);
  }
}
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(entry: { label: string; flavor: string; points: number }) {
  const toast = document.getElementById("toast")!;
  toast.innerHTML = "";
  const strong = document.createElement("div");
  strong.style.fontWeight = "700"; strong.style.marginBottom = "2px";
  strong.textContent = entry.points ? tr("collectedPrefix") + entry.label : entry.label;
  const sub = document.createElement("div");
  sub.textContent = entry.flavor;
  if (entry.points) {
    const pts = document.createElement("span");
    pts.className = "pts"; pts.textContent = "  +" + entry.points;
    sub.appendChild(pts);
  }
  toast.appendChild(strong); toast.appendChild(sub);
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

// ================= Resize =================
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
applyThemeColors();
applyWeather(); // applyThemeColors() just (re)built scene.fog from scratch at its default near/far -- reassert the current weather's fog distance on top of it
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener?.("change", () => { applyThemeColors(); applyWeather(); });

// ================= Camera rig =================
let introAngle = 0;
const camPos = new THREE.Vector3(0, 60, 90);
const camTarget = new THREE.Vector3(0, 4, 0);

// Orbit control: drag rotates/tilts the camera around the player; it holds
// that angle on its own (doesn't snap back to "behind") while the target
// keeps following the player every frame regardless of dragging.
let occFrame = 0;
let camYaw = 0, camPitch = IS_BAMBERG ? 0.62 : IS_OVERVIEW ? 0.95 : 0.86, camDist = IS_BAMBERG ? 30 : IS_OVERVIEW ? 110 : 34;
// Karting gets its own chase-camera state -- closer, lower, and yaw-locked
// behind the vehicle's heading by default (kartLookYaw is only a temporary
// look-around offset from dragging, and springs back to 0 on release),
// instead of reusing the walking camera's free-floating orbit.
let kartLookYaw = 0, kartCamPitch = IS_OVERVIEW ? 0.5 : 0.28, kartCamDist = IS_OVERVIEW ? 26 : 11;
let dragging = false, lastPX = 0, lastPY = 0;
let downPX = 0, downPY = 0, downAt = 0;
const canvasEl = renderer.domElement;
canvasEl.style.touchAction = "none";
canvasEl.addEventListener("pointerdown", (e) => {
  if (!joined) return;
  dragging = true; lastPX = e.clientX; lastPY = e.clientY;
  downPX = e.clientX; downPY = e.clientY; downAt = performance.now();
  canvasEl.setPointerCapture(e.pointerId);
});
canvasEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
  lastPX = e.clientX; lastPY = e.clientY;
  if (driving) {
    kartLookYaw -= dx * 0.006;
    kartCamPitch = Math.max(0.05, Math.min(0.9, kartCamPitch + dy * 0.006));
  } else {
    camYaw -= dx * 0.006;
    camPitch = Math.max(0.18, Math.min(1.35, camPitch + dy * 0.006));
  }
});
function endDrag(e: PointerEvent) {
  // A short, near-stationary press+release is a click, not a camera drag --
  // treat it as "walk here": raycast the click through the camera onto the
  // ground plane and let the loop steer the player toward that world point.
  const movedPx = Math.hypot(e.clientX - downPX, e.clientY - downPY);
  if (dragging && joined && movedPx < 6 && performance.now() - downAt < 350) {
    const rect = canvasEl.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    moveRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hit = new THREE.Vector3();
    if (moveRaycaster.ray.intersectPlane(groundPlane, hit)) {
      moveTarget = { x: Math.max(-HALF, Math.min(HALF, hit.x)), z: Math.max(-HALF, Math.min(HALF, hit.z)) };
    }
  }
  dragging = false;
  try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) {}
}
canvasEl.addEventListener("pointerup", endDrag);
canvasEl.addEventListener("pointercancel", endDrag);
canvasEl.addEventListener("wheel", (e) => {
  if (!joined) return;
  e.preventDefault();
  if (driving) kartCamDist = Math.max(6, Math.min(IS_OVERVIEW ? 60 : 24, kartCamDist + e.deltaY * 0.03));
  else camDist = Math.max(14, Math.min(IS_OVERVIEW ? 220 : 70, camDist + e.deltaY * 0.05));
}, { passive: false });

function updateLabel(el: HTMLDivElement, worldPos: THREE.Vector3) {
  const v = worldPos.clone().project(camera);
  if (v.z > 1) { el.style.display = "none"; return; }
  const w = container.clientWidth, h = container.clientHeight;
  const sx = (v.x * 0.5 + 0.5) * w;
  const sy = (-v.y * 0.5 + 0.5) * h;
  if (sx < -80 || sx > w + 80 || sy < -40 || sy > h + 40) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.style.left = sx + "px";
  el.style.top = sy + "px";
}

let lastT: number | null = null;
let lastSunSyncAt = 0;
// ?debug: expose game state for automated play-testing (read-only use)
if (new URLSearchParams(location.search).has("debug")) {
  (window as any).__lb = { player, get driving() { return driving; }, get nearKart() { return nearKart; }, kart: () => chassisBody.position, KART_SPAWN, PLAYER_SPAWN, body: chassisBody, vehicle: kartVehicle, world: physicsWorld, hf: heightfieldBody };
}

function loop(t: number) {
  if (lastT === null) lastT = t;
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  skyUniforms.time.value = t / 1000;
  if (sunMode === "auto" && t - lastSunSyncAt > 30000) { // re-sync to the real clock every 30s -- the sun visibly creeps as you play
    lastSunSyncAt = t;
    updateSunFromRealTime();
    updateBuildingNightLights();
    updateStreetLamps();
  }

  balloons.forEach((b) => {
    const ang = b.phase + (t / 1000) * b.speed;
    const x = b.baseX + Math.cos(ang) * b.radius;
    const z = b.baseZ + Math.sin(ang) * b.radius;
    const y = b.height + Math.sin(t / 1000 * 0.3 + b.phase) * 3;
    b.group.position.set(x, y, z);
    b.group.rotation.y = ang + Math.PI / 2;
  });

  updatePrecipitation(dt, player.x, player.z);

  if (!joined) {
    introAngle += dt * 0.06;
    const r = 230;
    camPos.set(-40 + Math.cos(introAngle) * r, 120, 60 + Math.sin(introAngle) * r);
    camTarget.set(-40, 10, 60);
  } else if (driving) {
    // Steering eases toward the input target rather than snapping, same
    // shape as the classic RaycastVehicle demo's steer-smoothing.
    let steerInput = 0;
    if (keys["arrowleft"] || keys["a"]) steerInput = 1;
    else if (keys["arrowright"] || keys["d"]) steerInput = -1;
    else if (joyX) steerInput = -joyX;
    const steerSpeed = dt * 3;
    if (steerInput !== 0) kartSteer += steerInput * steerSpeed;
    else if (Math.abs(kartSteer) > steerSpeed) kartSteer -= steerSpeed * Math.sign(kartSteer);
    else kartSteer = 0;
    kartSteer = Math.max(-KART_MAX_STEER, Math.min(KART_MAX_STEER, kartSteer));
    kartVehicle.setSteeringValue(kartSteer, WHEEL_FL);
    kartVehicle.setSteeringValue(kartSteer, WHEEL_FR);

    let throttleInput = 0;
    if (keys["arrowup"] || keys["w"]) throttleInput = 1;
    else if (keys["arrowdown"] || keys["s"]) throttleInput = -1;
    else if (joyZ) throttleInput = -joyZ;
    const speed = chassisBody.velocity.length();
    // NOTE: forward/reverse and steering sign here were reasoned from the
    // vehicle's axis config, not visually confirmed (this environment can't
    // reliably screenshot WebGL output) -- flip the sign on `engineForce`
    // or `kartSteer` below if driving forward or turning feels inverted.
    const engineForce = speed < KART_MAX_SPEED || throttleInput < 0 ? throttleInput * KART_ENGINE_FORCE : 0;
    kartVehicle.applyEngineForce(-engineForce, WHEEL_BL);
    kartVehicle.applyEngineForce(-engineForce, WHEEL_BR);
    updateEngineSound(Math.min(1, speed / KART_MAX_SPEED), Math.abs(throttleInput));
    const braking = throttleInput === 0 ? 0.4 : 0;
    kartVehicle.setBrake(braking, WHEEL_BL);
    kartVehicle.setBrake(braking, WHEEL_BR);

    physicsWorld.step(1 / 60, dt, 5);

    kartGroup.position.set(chassisBody.position.x, chassisBody.position.y - WHEEL_MOUNT, chassisBody.position.z);
    kartGroup.quaternion.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w);
    for (let i = 0; i < 4; i++) {
      kartVehicle.updateWheelTransform(i);
      const wt = kartVehicle.wheelInfos[i]!.worldTransform;
      kartWheelMeshes[i]!.position.set(wt.position.x, wt.position.y, wt.position.z);
      kartWheelMeshes[i]!.quaternion.set(wt.quaternion.x, wt.quaternion.y, wt.quaternion.z, wt.quaternion.w);
    }

    player.x = chassisBody.position.x;
    player.z = chassisBody.position.z;
    const worldFwd = chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    player.rotY = Math.atan2(worldFwd.x, worldFwd.z);

    // Dedicated chase camera: locked in behind the kart's own heading (not
    // the walking camera's free-floating yaw), close and low like a kart
    // game, with a manual look-around that springs back when you let go,
    // a look-ahead target for a sense of speed, and FOV widening at speed.
    if (!dragging) kartLookYaw *= Math.max(0, 1 - dt * 3);
    const chaseAngle = player.rotY + Math.PI + kartLookYaw;
    const camOffset = new THREE.Vector3(
      Math.sin(chaseAngle) * Math.cos(kartCamPitch) * kartCamDist,
      Math.sin(kartCamPitch) * kartCamDist + 2.2,
      Math.cos(chaseAngle) * Math.cos(kartCamPitch) * kartCamDist
    );
    const desiredKartCam = new THREE.Vector3(chassisBody.position.x + camOffset.x, chassisBody.position.y + camOffset.y, chassisBody.position.z + camOffset.z);
    camPos.lerp(desiredKartCam, dragging ? 1 : Math.min(1, dt * 10));
    const lookAheadDist = 3 + Math.min(9, speed * 0.28);
    const lookTarget = new THREE.Vector3(
      player.x + Math.sin(player.rotY) * lookAheadDist,
      chassisBody.position.y + 1.1,
      player.z + Math.cos(player.rotY) * lookAheadDist
    );
    camTarget.lerp(lookTarget, Math.min(1, dt * 8));
    camera.fov = 52 + Math.min(1, speed / KART_MAX_SPEED) * 12;
    camera.updateProjectionMatrix();

    sendPresence(t);
    checkCollisions();
  } else {
    let rawX = 0, rawZ = 0, mag = 1;
    if (keys["arrowup"] || keys["w"]) rawZ -= 1;
    if (keys["arrowdown"] || keys["s"]) rawZ += 1;
    if (keys["arrowleft"] || keys["a"]) rawX -= 1;
    if (keys["arrowright"] || keys["d"]) rawX += 1;
    if (!rawX && !rawZ && (joyX || joyZ)) {
      rawX = joyX; rawZ = joyZ;
      mag = Math.min(1, Math.hypot(joyX, joyZ)); // analog push distance controls speed
    }
    // Steering is camera-relative: "forward" is always away from the camera
    // and "right" is always the camera's right, so the controls keep making
    // sense as the player drags the camera around (world-relative WASD felt
    // backwards the moment you orbited 90 degrees).
    let dx = 0, dz = 0;
    if (rawX || rawZ) {
      const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
      const inputForward = -rawZ, inputRight = rawX;
      dx = inputRight * cosY - inputForward * sinY;
      dz = -inputRight * sinY - inputForward * cosY;
    }
    // Real movement used to snap straight to full speed/full stop every
    // frame -- speedEase gives it a believable ease-in/ease-out instead,
    // without touching the kart (which already has real physics for this)
    // or peers (their lerp-toward-target already has an implicit ease).
    const wantsMove = !!(dx || dz) || (!!moveTarget && Math.hypot(moveTarget.x - player.x, moveTarget.z - player.z) > 0.6);
    player.speedEase += ((wantsMove ? 1 : 0) - player.speedEase) * Math.min(1, dt * 6);
    let didMove = false;
    if (dx || dz) {
      moveTarget = null; // manual input always overrides a pending click-to-move
      const len = Math.hypot(dx, dz);
      const nx = dx / len, nz = dz / len;
      walkBy(nx * player.speed * mag * player.speedEase * dt, nz * player.speed * mag * player.speedEase * dt);
      const targetRot = Math.atan2(nx, nz);
      const diff = ((targetRot - player.rotY + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      player.rotY += diff * Math.min(1, dt * 10);
      didMove = true;
    } else if (moveTarget) {
      const tdx = moveTarget.x - player.x, tdz = moveTarget.z - player.z;
      const dist = Math.hypot(tdx, tdz);
      if (dist > 0.6) {
        const nx = tdx / dist, nz = tdz / dist;
        if (!walkBy(nx * player.speed * player.speedEase * dt, nz * player.speed * player.speedEase * dt) && player.speedEase > 0.9) {
          moveTarget = null; // walked into a wall on the way to a clicked spot: stop instead of pushing forever
        }
        const targetRot = Math.atan2(nx, nz);
        const diff = ((targetRot - player.rotY + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        player.rotY += diff * Math.min(1, dt * 10);
        didMove = true;
      } else {
        moveTarget = null;
      }
    }
    player.walkAmount += ((didMove ? 1 : 0) - player.walkAmount) * Math.min(1, dt * 8);
    animateWalk(player.rig!, dt, player.walkAmount);
    const groundY = terrainHeight(player.x, player.z);
    player.mesh!.position.set(player.x, groundY, player.z);
    player.mesh!.rotation.y = player.rotY;

    const orbitOffset = new THREE.Vector3(
      Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      Math.sin(camPitch) * camDist,
      Math.cos(camYaw) * Math.cos(camPitch) * camDist
    );
    const desiredCam = new THREE.Vector3(player.x + orbitOffset.x, groundY + 3 + orbitOffset.y, player.z + orbitOffset.z);
    camPos.lerp(desiredCam, dragging ? 1 : Math.min(1, dt * 8));
    camTarget.lerp(new THREE.Vector3(player.x, groundY + 3, player.z), Math.min(1, dt * 6));
    if (camera.fov !== 52) { camera.fov = 52; camera.updateProjectionMatrix(); } // undo the kart's speed-FOV widening

    const distToKart = Math.hypot(player.x - kartGroup.position.x, player.z - kartGroup.position.z);
    nearKart = distToKart < 5;
    carPromptEl.textContent = tr("carPrompt");
    carPromptEl.classList.toggle("show", nearKart);

    sendPresence(t);
    checkCollisions();
  }

  camera.position.copy(camPos);
  camera.lookAt(camTarget);
  followShadow(camTarget.x, camTarget.z);
  updateGuide();
  if ((occFrame = (occFrame + 1) % 2) === 0) updateOcclusion(camTarget, camPos);

  Object.keys(peers).forEach((pid) => {
    const p = peers[pid]!;
    const prevX = p.x, prevZ = p.z;
    p.x += (p.target.x - p.x) * Math.min(1, dt * 6);
    p.z += (p.target.z - p.z) * Math.min(1, dt * 6);
    const movedDist = Math.hypot(p.x - prevX, p.z - prevZ);
    p.walkAmount += ((movedDist > 0.01 ? 1 : 0) - p.walkAmount) * Math.min(1, dt * 8);
    animateWalk(p.rig, dt, p.walkAmount);
    const y = terrainHeight(p.x, p.z);
    p.mesh.position.set(p.x, y, p.z);
    const rd = ((p.target.rotY - p.rotY + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    p.rotY += rd * Math.min(1, dt * 6);
    p.mesh.rotation.y = p.rotY;
    p.nameEl.textContent = p.target.name || "?";
    updateLabel(p.nameEl, new THREE.Vector3(p.x, y + 3.6, p.z));
  });

  if (joined) {
    myNameEl.textContent = state.name;
    updateLabel(myNameEl, new THREE.Vector3(player.x, terrainHeight(player.x, player.z) + 3.6, player.z));
  } else {
    myNameEl.style.display = "none";
  }

  checkGates(t);
  LANDMARKS.forEach((l, idx) => {
    const el = landmarkLabels[idx]!;
    const got = isCollected(l);
    el.className = "label3d" + (got ? " got" : "");
    if (l.mesh) {
      const box3 = new THREE.Box3().setFromObject(l.mesh);
      updateLabel(el, new THREE.Vector3(l.x, box3.max.y + 1.5, l.z));
    }
  });

  composer.render();
  requestAnimationFrame(loop);
}

document.getElementById("loading")!.classList.add("hide");
requestAnimationFrame(loop);

document.getElementById("boardToggle")!.addEventListener("click", () => {
  const board = document.getElementById("board")!;
  board.style.display = board.style.display === "block" ? "none" : "block";
});

applyLanguage();