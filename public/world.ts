// One Bavaria: the seven city maps (terrain.ts, each at its world offset) joined by a compressed countryside you can walk
// and drive across -- real heights, rivers, lakes, motorways and towns (scripts/build_world.py -> public/world/world.json).
// Cities are built whole at load; the countryside is built in 256-unit chunks around the player and dropped behind.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Terrain } from "./terrain";
import { toyHouse } from "./landmarks";
import { bake, tower, onion, C } from "./toykit";

type P = number[];
export type WorldData = {
  K: number; vm: number; ref_m: number; city_half: number;
  grid: { x0: number; z0: number; nx: number; nz: number; step: number; h16: string };
  cities: Record<string, { x: number; z: number; y: number; half?: number; moved_km: number }>;
  sights: Record<string, P>;
  outline: P[];
  rivers: { name: string; hw: number; line: P[] }[];
  lakes: { name: string; ring: P[] }[];
  motorways: { ref: string; line: P[] }[];
  links: { city?: string; sight?: string; line: P[] }[];
  towns: { name: string; x: number; z: number; big: boolean; pop: number }[];
};

const CH = 256, CS = 8, CN = CH / CS + 1;      // chunk size, cell size, vertices per side
const VIS = 1000, DROP = 1350;                // build chunks within, drop beyond (fog ends at ~650-900)
const MOTORWAY_HW = 3.4, LINK_HW = 2.2;

// ---------- small value noise (deterministic)
function hash2(x: number, z: number): number { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** The countryside height function alone (what a city map's edge blends into), usable before the world is built. */
export function countryEdgeFn(wd: WorldData): (x: number, z: number) => number {
  const g = wd.grid, bytes = Uint8Array.from(atob(g.h16), (c) => c.charCodeAt(0)), h16 = new Int16Array(bytes.buffer);
  return (x, z) => {
    const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.step)), fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / g.step));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const at = (a: number, b: number) => h16[b * g.nx + a]! / 10;
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz + (vnoise(x / 40, z / 40) - 0.5) * 1.2;
  };
}

export function buildWorld(wd: WorldData, cityTer: Record<string, Terrain>) {
  const g = wd.grid;
  const bytes = Uint8Array.from(atob(g.h16), (c) => c.charCodeAt(0));
  const h16 = new Int16Array(bytes.buffer);
  const X1 = g.x0 + (g.nx - 1) * g.step, Z1 = g.z0 + (g.nz - 1) * g.step;
  const bounds = { x0: g.x0 + 8, x1: X1 - 8, z0: g.z0 + 8, z1: Z1 - 8 };
  function coarse(x: number, z: number): number {
    const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.step)), fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / g.step));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const at = (a: number, b: number) => h16[b * g.nx + a]! / 10;
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
  }
  const cityList = Object.entries(wd.cities).map(([id, c]) => ({ id, ...c, half: c.half ?? wd.city_half }));
  function cityAt(x: number, z: number) {
    for (const c of cityList) if (Math.abs(x - c.x) <= c.half && Math.abs(z - c.z) <= c.half) return c;
    return null;
  }
  const SEA = 0.35; // coarse height at or below this (x 12 m) is sea: the North Sea, the Baltic, the Wadden flats

  // ---------- spatial hash of water and roads (64-unit cells)
  type Seg = { ax: number; az: number; bx: number; bz: number; la: number; lb: number; hw: number };
  const HC = 64;
  const waterSegs: Seg[] = [], roadSegs: Seg[] = [];
  const hashW = new Map<string, number[]>(), hashR = new Map<string, number[]>();
  const addSeg = (list: Seg[], hash: Map<string, number[]>, s: Seg) => {
    const i = list.push(s) - 1, pad = s.hw + 10;
    for (let cx = Math.floor((Math.min(s.ax, s.bx) - pad) / HC); cx <= Math.floor((Math.max(s.ax, s.bx) + pad) / HC); cx++)
      for (let cz = Math.floor((Math.min(s.az, s.bz) - pad) / HC); cz <= Math.floor((Math.max(s.az, s.bz) + pad) / HC); cz++) {
        const k = cx + "," + cz; if (!hash.has(k)) hash.set(k, []); hash.get(k)!.push(i);
      }
  };
  for (const r of wd.rivers) { // water level along the river: never rising downstream (OSM rivers run downstream)
    let lv = Infinity;
    const lev = r.line.map((p) => (lv = Math.min(lv, coarse(p[0]!, p[1]!) - 0.3)));
    for (let i = 0; i < r.line.length - 1; i++)
      addSeg(waterSegs, hashW, { ax: r.line[i]![0]!, az: r.line[i]![1]!, bx: r.line[i + 1]![0]!, bz: r.line[i + 1]![1]!, la: lev[i]!, lb: lev[i + 1]!, hw: r.hw });
  }
  const lakes = wd.lakes.map((l) => {
    const xs = l.ring.map((p) => p[0]!), zs = l.ring.map((p) => p[1]!);
    return { ring: l.ring, level: Math.min(...l.ring.map((p) => coarse(p[0]!, p[1]!))) - 0.3, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  for (const m of wd.motorways) for (let i = 0; i < m.line.length - 1; i++)
    addSeg(roadSegs, hashR, { ax: m.line[i]![0]!, az: m.line[i]![1]!, bx: m.line[i + 1]![0]!, bz: m.line[i + 1]![1]!, la: 0, lb: 0, hw: MOTORWAY_HW });
  for (const l of wd.links) for (let i = 0; i < l.line.length - 1; i++)
    addSeg(roadSegs, hashR, { ax: l.line[i]![0]!, az: l.line[i]![1]!, bx: l.line[i + 1]![0]!, bz: l.line[i + 1]![1]!, la: 1, lb: 1, hw: LINK_HW });
  const near = (list: Seg[], hash: Map<string, number[]>, x: number, z: number) => (hash.get(Math.floor(x / HC) + "," + Math.floor(z / HC)) || []).map((i) => list[i]!);
  const segT = (s: Seg, x: number, z: number) => {
    const ex = s.bx - s.ax, ez = s.bz - s.az, L = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L));
    return { t, d: Math.hypot(x - s.ax - t * ex, z - s.az - t * ez) };
  };
  const inRing = (x: number, z: number, r: P[]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i]![0]!, zi = r[i]![1]!, xj = r[j]![0]!, zj = r[j]![1]!;
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const ringDist = (x: number, z: number, r: P[]) => {
    let d = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segT({ ax: r[j]![0]!, az: r[j]![1]!, bx: r[i]![0]!, bz: r[i]![1]!, la: 0, lb: 0, hw: 0 }, x, z).d);
    return d;
  };

  // ---------- countryside ground: coarse heights + a little detail, riverbeds and lakes carved, city squares tucked under
  function countryWater(x: number, z: number): { level: number; dist: number } {
    let level = NaN, dist = 99;
    const ch = coarse(x, z);
    if (ch <= SEA) return { level: 0, dist: -1 };
    if (ch < SEA + 1.2) { level = 0; dist = (ch - SEA) * 8; } // the coast
    for (const s of near(waterSegs, hashW, x, z)) {
      const { t, d } = segT(s, x, z), e = d - s.hw;
      if (e < dist) { dist = e; level = s.la + (s.lb - s.la) * t; }
    }
    for (const l of lakes) {
      if (x < l.x0 - 12 || x > l.x1 + 12 || z < l.z0 - 12 || z > l.z1 + 12) continue;
      const e = inRing(x, z, l.ring) ? -1 : ringDist(x, z, l.ring);
      if (e < dist) { dist = e; level = l.level; }
    }
    return { level, dist };
  }
  function countryH(x: number, z: number): number {
    let h = coarse(x, z) + (vnoise(x / 40, z / 40) - 0.5) * 1.2;
    const w = countryWater(x, z);
    if (coarse(x, z) <= SEA) return Math.min(h, -1.2); // sea floor
    if (w.dist < 8 && !isNaN(w.level)) {
      const bed = w.level - 1.4;
      h = w.dist <= 0 ? Math.min(h, bed) : Math.min(h, bed + (Math.max(h, w.level + 0.4) - bed) * Math.min(1, w.dist / 8));
    }
    for (const s of near(roadSegs, hashR, x, z)) { // roads get a gentle, even bed
      const { d } = segT(s, x, z);
      if (d < s.hw + 3) h = h * 0.7 + coarse(x, z) * 0.3;
    }
    const c = cityAt(x, z);
    if (c) {
      const cheb = Math.max(Math.abs(x - c.x), Math.abs(z - c.z));
      h -= cheb < c.half - 12 ? 40 : 0.3; // under the city map (which blends into this height at its edge)
    }
    return h;
  }
  /** Height of the countryside as if no city were there (what a city's edge blends into). */
  function countryEdge(x: number, z: number): number { return coarse(x, z) + (vnoise(x / 40, z / 40) - 0.5) * 1.2; }

  // ---------- composite queries (world coordinates)
  function height(x: number, z: number): number {
    const c = cityAt(x, z);
    return c ? cityTer[c.id]!.height(x - c.x, z - c.z) + c.y : countryH(x, z);
  }
  function deckAt(x: number, z: number): number | null {
    const c = cityAt(x, z); if (!c) return null;
    const d = cityTer[c.id]!.deckAt(x - c.x, z - c.z);
    return d === null ? null : d + c.y;
  }
  const surface = (x: number, z: number) => deckAt(x, z) ?? height(x, z);
  function waterLevel(x: number, z: number): number {
    const c = cityAt(x, z);
    if (c) { const l = cityTer[c.id]!.waterLevel(x - c.x, z - c.z); return isNaN(l) ? l : l + c.y; }
    const w = countryWater(x, z);
    return w.dist <= 0 ? w.level : NaN;
  }
  function waterDist(x: number, z: number): number {
    const c = cityAt(x, z);
    return c ? cityTer[c.id]!.waterDist(x - c.x, z - c.z) : Math.max(0, countryWater(x, z).dist);
  }
  function inWater(x: number, z: number): boolean {
    const c = cityAt(x, z);
    if (c) return cityTer[c.id]!.inWater(x - c.x, z - c.z);
    const w = countryWater(x, z);
    return w.dist <= 0 && countryH(x, z) < w.level - 0.3;
  }
  /** On a motorway (for the truck's higher top speed). */
  function onMotorway(x: number, z: number): boolean {
    return near(roadSegs, hashR, x, z).some((s) => s.hw === MOTORWAY_HW && segT(s, x, z).d < s.hw + 0.5);
  }
  function bridgeNear(x: number, z: number, r: number) {
    const c = cityAt(x, z); if (!c) return null;
    const b = cityTer[c.id]!.bridgeNear(x - c.x, z - c.z, r); if (!b) return null;
    return { ...b, xs: b.xs.map((v) => v + c.x), zs: b.zs.map((v) => v + c.z), deck: b.deck.map((v) => v + c.y) };
  }

  const group = new THREE.Group();
  for (const c of cityList) { const t = cityTer[c.id]!; t.group.position.set(c.x, c.y, c.z); group.add(t.group); }
  const physBoxes = cityList.flatMap((c) => cityTer[c.id]!.physBoxes.map((b) => ({ pos: b.pos.clone().add(new THREE.Vector3(c.x, c.y, c.z)), quat: b.quat, half: b.half })));

  // ---------- global: motorways, link roads, rivers, lakes
  const densify = (line: P[], step: number) => {
    const out: P[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i] as [number, number], [bx, bz] = line[i + 1] as [number, number];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, az + ((bz - az) * j) / n]);
    }
    out.push(line[line.length - 1]!);
    return out;
  };
  const strip = (line: P[], hw: number, yAt: (x: number, z: number, i: number) => number): THREE.BufferGeometry => {
    const v: number[] = [], uv: number[] = [];
    let s = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const side = (k: number) => {
        const p = line[Math.max(0, k - 1)]!, q = line[Math.min(line.length - 1, k + 1)]!;
        const dx = q[0]! - p[0]!, dz = q[1]! - p[1]!, L = Math.hypot(dx, dz) || 1;
        return [(-dz / L) * hw, (dx / L) * hw];
      };
      const a = line[i]!, b = line[i + 1]!, [pax, paz] = side(i), [pbx, pbz] = side(i + 1);
      const L = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      const ya1 = yAt(a[0]! + pax!, a[1]! + paz!, i), ya2 = yAt(a[0]! - pax!, a[1]! - paz!, i), yb1 = yAt(b[0]! + pbx!, b[1]! + pbz!, i + 1), yb2 = yAt(b[0]! - pbx!, b[1]! - pbz!, i + 1);
      v.push(a[0]! + pax!, ya1, a[1]! + paz!, b[0]! + pbx!, yb1, b[1]! + pbz!, a[0]! - pax!, ya2, a[1]! - paz!,
        b[0]! + pbx!, yb1, b[1]! + pbz!, b[0]! - pbx!, yb2, b[1]! - pbz!, a[0]! - pax!, ya2, a[1]! - paz!);
      uv.push(0, s, 0, s + L, 1, s, 0, s + L, 1, s + L, 1, s);
      s += L;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  };
  const outsideCities = (line: P[]) => { // split a line into runs outside the city maps
    const runs: P[][] = []; let run: P[] = [];
    for (const p of line) { if (!cityAt(p[0]!, p[1]!)) run.push(p); else { if (run.length >= 2) runs.push(run); run = []; } }
    if (run.length >= 2) runs.push(run);
    return runs;
  };
  const dashTex = (() => { // motorway: grey asphalt, white edge lines, dashed middle
    const c = document.createElement("canvas"); c.width = 32; c.height = 64;
    const x = c.getContext("2d")!;
    x.fillStyle = "#6d717b"; x.fillRect(0, 0, 32, 64);
    x.fillStyle = "#f4f4f4"; x.fillRect(1, 0, 2, 64); x.fillRect(29, 0, 2, 64); x.fillRect(15, 0, 2, 32);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1 / 10); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mGeos: THREE.BufferGeometry[] = [], lGeos: THREE.BufferGeometry[] = [], vergeGeos: THREE.BufferGeometry[] = [];
  for (const m of wd.motorways) for (const run of outsideCities(densify(m.line, CS))) {
    mGeos.push(strip(run, MOTORWAY_HW, (x, z) => countryH(x, z) + 0.25));
    vergeGeos.push(strip(run, MOTORWAY_HW + 1, (x, z) => countryH(x, z) + 0.12));
  }
  for (const l of wd.links) for (const run of outsideCities(densify(l.line, CS))) {
    lGeos.push(strip(run, LINK_HW, (x, z) => countryH(x, z) + 0.22));
    vergeGeos.push(strip(run, LINK_HW + 0.6, (x, z) => countryH(x, z) + 0.1));
  }
  const addMerged = (geos: THREE.BufferGeometry[], m: THREE.Material) => {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, m); mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  addMerged(mGeos, new THREE.MeshStandardMaterial({ map: dashTex, roughness: 0.9 }));
  addMerged(lGeos, new THREE.MeshStandardMaterial({ color: "#f4e6c6", roughness: 1 }));
  addMerged(vergeGeos, new THREE.MeshStandardMaterial({ color: "#dcc494", roughness: 1 }));
  const waterMat = new THREE.MeshStandardMaterial({ color: "#5cb6e0", roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.9 });
  const rGeos: THREE.BufferGeometry[] = [];
  for (const r of wd.rivers) {
    const segsFor = densify(r.line, CS);
    let lv = Infinity;
    const lev = segsFor.map((p) => (lv = Math.min(lv, coarse(p[0]!, p[1]!) - 0.3)));
    for (const run of [segsFor]) rGeos.push(strip(run, r.hw + 5, (_x, _z, i) => lev[i]!));
  }
  for (const l of lakes) {
    const sh = new THREE.Shape(l.ring.map((p) => new THREE.Vector2(p[0]!, -p[1]!)));
    const geo = new THREE.ShapeGeometry(sh); geo.rotateX(-Math.PI / 2); geo.translate(0, l.level, 0);
    // pad the lake a little outward (its shore is carved below the level up to the ring)
    rGeos.push(geo.toNonIndexed());
  }
  const riverMesh = addMerged(rGeos.map((gg) => { for (const k of Object.keys(gg.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") gg.deleteAttribute(k); if (!gg.attributes.uv) gg.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((gg.attributes.position!.count) * 2), 2)); return gg.index ? gg.toNonIndexed() : gg; }), waterMat);
  if (riverMesh) riverMesh.renderOrder = 1;

  const FIELD = ["#9fd174", "#93c97a", "#c8d27a", "#b3cf6e", "#a9c983", "#d7cf85", "#8cc26f"].map((c) => new THREE.Color(c));
  // ---------- the sea: one plane at sea level under everything (land above it hides it)
  {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(X1 - g.x0 + 4000, Z1 - g.z0 + 4000), waterMat);
    sea.rotation.x = -Math.PI / 2; sea.position.set((g.x0 + X1) / 2, 0, (g.z0 + Z1) / 2); sea.renderOrder = 0;
    group.add(sea);
  }

  // ---------- far view: the whole country as coarse 512-unit tiles (every 64 units), shown only where no detailed chunk is
  const FT = 512, FS = 64, FN = FT / FS + 1;
  const farTiles: { cx: number; cz: number; mesh: THREE.Mesh }[] = [];
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  for (let tz = Math.floor(g.z0 / FT); tz * FT < Z1; tz++) for (let tx = Math.floor(g.x0 / FT); tx * FT < X1; tx++) {
    const pos = new Float32Array(FN * FN * 3), col = new Float32Array(FN * FN * 3), idx: number[] = [];
    const tmp = new THREE.Color();
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
      const x = tx * FT + i * FS, z = tz * FT + j * FS, raw = coarse(x, z), c = cityAt(x, z), k = j * FN + i;
      const y = raw <= SEA ? -1.5 : raw - (c ? 6 : 1.2); // a little under the detailed ground and the city maps
      pos.set([x, y, z], k * 3);
      if (raw <= SEA) tmp.set("#a89a6e"); else if (raw > 125) tmp.set("#f4f6f8"); else if (raw > 90) tmp.set("#b3a58f");
      else if (vnoise(x / 160, z / 160) > 0.6 || (raw > 22 && vnoise(x / 90 + 7, z / 90) > 0.42)) tmp.set("#5f9b4c");
      else tmp.copy(FIELD[Math.floor(hash2(Math.floor(x / 52), Math.floor(z / 44)) * FIELD.length)]!);
      col.set([tmp.r, tmp.g, tmp.b], k * 3);
    }
    for (let j = 0; j < FN - 1; j++) for (let i = 0; i < FN - 1; i++) { const a = j * FN + i; idx.push(a, a + FN, a + 1, a + 1, a + FN, a + FN + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, farMat); mesh.receiveShadow = false; group.add(mesh);
    farTiles.push({ cx: tx * FT + FT / 2, cz: tz * FT + FT / 2, mesh });
  }

  // ---------- countryside chunks
  const outline = wd.outline;
  const oMask = (() => { // inside Bavaria? on a 64-unit mask
    const m = new Map<string, boolean>();
    return (x: number, z: number) => {
      const k = Math.floor(x / 64) + "," + Math.floor(z / 64);
      if (!m.has(k)) m.set(k, inRing(Math.floor(x / 64) * 64 + 32, Math.floor(z / 64) * 64 + 32, outline));
      return m.get(k)!;
    };
  })();
  const cForest = new THREE.Color("#5f9b4c"), cRock = new THREE.Color("#b3a58f"), cSnow = new THREE.Color("#f4f6f8"), cSand = new THREE.Color("#d9ca97"), cBed = new THREE.Color("#a89a6e"), cGrey = new THREE.Color("#b9bfa9");
  const forestAt = (x: number, z: number, h: number) => vnoise(x / 160, z / 160) > 0.6 || (h > 22 && vnoise(x / 90 + 7, z / 90) > 0.42);
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false });
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(1.9, 2.2, 7).translate(0, -0.9, 0), new THREE.ConeGeometry(1.5, 1.9, 7).translate(0, 0.3, 0), new THREE.ConeGeometry(1.05, 1.7, 7).translate(0, 1.35, 0),
  ])!;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
  const pineMat = new THREE.MeshStandardMaterial({ color: "#ffffff", flatShading: true, roughness: 0.9 }), trunkMat = new THREE.MeshStandardMaterial({ color: "#6b4a2e", roughness: 1 });
  const townsByChunk = new Map<string, WorldData["towns"]>();
  for (const t of wd.towns) { const k = Math.floor(t.x / CH) + "," + Math.floor(t.z / CH); if (!townsByChunk.has(k)) townsByChunk.set(k, []); townsByChunk.get(k)!.push(t); }
  const nearRoad = (x: number, z: number, pad: number) => near(roadSegs, hashR, x, z).some((s) => segT(s, x, z).d < s.hw + pad);
  const WALLS = [C.plaster, C.rose, C.ochre, C.sky, C.salmon, C.mint, C.cream, C.yellow];

  type Chunk = { key: string; ix: number; iz: number; group: THREE.Group; ground: THREE.Mesh; heights: number[][] };
  const chunks = new Map<string, Chunk>();
  function buildChunk(ix: number, iz: number): Chunk {
    const x0 = ix * CH, z0 = iz * CH, cg = new THREE.Group();
    const pos = new Float32Array(CN * CN * 3), col = new Float32Array(CN * CN * 3);
    const heights: number[][] = []; // [xi][zi] for the physics heightfield
    const tmp = new THREE.Color();
    for (let a = 0; a < CN; a++) heights.push(new Array(CN).fill(0));
    for (let zi = 0; zi < CN; zi++) for (let xi = 0; xi < CN; xi++) {
      const x = x0 + xi * CS, z = z0 + zi * CS, h = countryH(x, z), k = zi * CN + xi;
      heights[xi]![zi] = h;
      pos.set([x, h, z], k * 3);
      const w = countryWater(x, z);
      const raw = coarse(x, z);
      const slope = Math.hypot(coarse(x + 8, z) - coarse(x - 8, z), coarse(x, z + 8) - coarse(x, z - 8)) / 16;
      if (w.dist <= 0.5) tmp.copy(cBed);
      else if (w.dist < 4) tmp.copy(cSand);
      else if (raw > 125) tmp.copy(cSnow);
      else if (raw > 90 || slope > 0.9) tmp.copy(cRock);
      else if (forestAt(x, z, raw)) tmp.copy(cForest);
      else { // fields: a patchwork of 40-60 unit plots
        const fx = Math.floor((x + vnoise(x / 70, z / 70) * 30) / 52), fz = Math.floor((z + vnoise(z / 70, x / 70) * 30) / 44);
        tmp.copy(FIELD[Math.floor(hash2(fx, fz) * FIELD.length)]!);
      }
      if (!oMask(x, z)) tmp.lerp(cGrey, 0.35); // outside Bavaria: a little muted, so the border shows
      const j = 0.97 + hash2(x, z) * 0.06;
      col.set([tmp.r * j, tmp.g * j, tmp.b * j], k * 3);
    }
    const idx: number[] = [];
    for (let zi = 0; zi < CN - 1; zi++) for (let xi = 0; xi < CN - 1; xi++) {
      const a = zi * CN + xi, b = a + 1, c = a + CN, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, groundMat); ground.receiveShadow = true; cg.add(ground);

    // trees: forests on the forest patches and the hills, a few field-edge trees elsewhere
    const trees: THREE.Matrix4[] = [], tcol: THREE.Color[] = [];
    for (let tz = z0 + 4; tz < z0 + CH; tz += 11) for (let tx = x0 + 4; tx < x0 + CH; tx += 11) {
      const x = tx + (hash2(tx, tz) - 0.5) * 9, z = tz + (hash2(tz, tx) - 0.5) * 9, raw = coarse(x, z);
      const dense = forestAt(x, z, raw) && raw < 110;
      if (!dense && hash2(x * 3, z * 7) > 0.025) continue;
      if (cityAt(x, z) || countryWater(x, z).dist < 3 || nearRoad(x, z, 4)) continue;
      const y = countryH(x, z), s = 0.9 + hash2(x, z * 2) * 0.7;
      trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 3.2 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
      tcol.push(new THREE.Color(hash2(x, z) > 0.5 ? "#3f7a4f" : "#4a8a58"));
    }
    if (trees.length) {
      const crowns = new THREE.InstancedMesh(pineGeo, pineMat, trees.length), trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
      trees.forEach((m, i) => {
        crowns.setMatrixAt(i, m); crowns.setColorAt(i, tcol[i]!);
        const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(t, q, s);
        trunks.setMatrixAt(i, new THREE.Matrix4().compose(t.clone().add(new THREE.Vector3(0, -2.2 * s.y, 0)), q, s));
      });
      crowns.castShadow = trunks.castShadow = true;
      crowns.computeBoundingSphere(); trunks.computeBoundingSphere();
      cg.add(crowns, trunks);
    }
    // towns in this chunk: toy houses around the centre, a church with an onion dome
    for (const t of townsByChunk.get(ix + "," + iz) || []) {
      const tg = new THREE.Group();
      const n = t.big ? Math.min(30, 12 + Math.floor(t.pop / 20000)) : Math.max(5, Math.min(12, 4 + Math.floor(t.pop / 3000)));
      let placed = 0;
      for (let k = 0; k < n * 4 && placed < n; k++) {
        const a = k * 2.39996, r = 9 + Math.sqrt(k) * 6.5;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        if (countryWater(x, z).dist < 4 || nearRoad(x, z, 5) || cityAt(x, z)) continue;
        const w = 5 + hash2(x, z) * 3, d = 4.5 + hash2(z, x) * 2.5;
        const hs = toyHouse(w, d, 2, WALLS[k % WALLS.length]!, k % 3 ? C.roof : C.roofDark, k % 5 === 0);
        hs.position.set(x, countryH(x, z) - 0.2, z); hs.rotation.y = a + Math.PI / 2;
        tg.add(hs); placed++;
      }
      if (countryWater(t.x, t.z).dist > 4 && !nearRoad(t.x, t.z, 5)) {
        const ch = tower(3.4, 11, C.white, { windows: 2, clock: true, clockY: 8.5 });
        ch.add(Object.assign(onion(2.1, C.copper), {}).translateY(11));
        const nave = toyHouse(6, 10, 2, C.white, C.roof); nave.position.z = -6.5;
        const church = new THREE.Group(); church.add(ch, nave);
        church.position.set(t.x, countryH(t.x, t.z) - 0.2, t.z); church.rotation.y = hash2(t.x, t.z) * 6.28;
        tg.add(church);
      }
      if (tg.children.length) { const b = bake(tg); b.userData.town = t.name; cg.add(b); }
    }
    group.add(cg);
    return { key: ix + "," + iz, ix, iz, group: cg, ground, heights };
  }
  function disposeChunk(c: Chunk) {
    group.remove(c.group);
    c.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry !== pineGeo && m.geometry !== trunkGeo) m.geometry.dispose(); });
  }
  let pending: [number, number][] = [];
  /** Keep chunks around (px, pz) built, drop far ones; at most `budget` new chunks per call (spreads the work). */
  function stream(px: number, pz: number, budget = 2): { added: Chunk[]; removed: Chunk[] } {
    const added: Chunk[] = [], removed: Chunk[] = [];
    for (const c of chunks.values()) {
      const cx = c.ix * CH + CH / 2, cz = c.iz * CH + CH / 2;
      if (Math.hypot(cx - px, cz - pz) > DROP) { disposeChunk(c); chunks.delete(c.key); removed.push(c); }
    }
    pending = [];
    const r = Math.ceil(VIS / CH);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const ix = Math.floor(px / CH) + dx, iz = Math.floor(pz / CH) + dz;
      if (ix * CH > bounds.x1 || (ix + 1) * CH < bounds.x0 || iz * CH > bounds.z1 || (iz + 1) * CH < bounds.z0) continue;
      const cx = ix * CH + CH / 2, cz = iz * CH + CH / 2;
      if (Math.hypot(cx - px, cz - pz) < VIS && !chunks.has(ix + "," + iz)) pending.push([ix, iz]);
    }
    pending.sort((a, b) => Math.hypot(a[0] * CH - px, a[1] * CH - pz) - Math.hypot(b[0] * CH - px, b[1] * CH - pz));
    for (const [ix, iz] of pending.slice(0, budget)) { const c = buildChunk(ix, iz); chunks.set(c.key, c); added.push(c); }
    for (const t of farTiles) { // coarse tile hidden only when every corner is inside the detailed ring
      const r = Math.hypot(Math.abs(t.cx - px) + FT / 2, Math.abs(t.cz - pz) + FT / 2);
      t.mesh.visible = r > VIS - CH * 0.75;
    }
    return { added, removed };
  }
  function grounds(): THREE.Object3D[] { return [...cityList.map((c) => cityTer[c.id]!.ground), ...[...chunks.values()].map((c) => c.ground)]; }

  let tAcc = 0;
  function update(dt: number) {
    tAcc += dt;
    for (const c of cityList) cityTer[c.id]!.update(dt);
  }

  return {
    group, bounds, cities: cityList, cityAt, height, surface, deckAt, waterLevel, waterDist, inWater, onMotorway, bridgeNear,
    physBoxes, stream, grounds, update, countryEdge, chunkSize: CH, cellSize: CS, waterMat, pendingCount: () => pending.length,
    towns: wd.towns, sights: wd.sights,
  };
}
export type World = ReturnType<typeof buildWorld>;
