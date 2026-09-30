// Real ground for the city maps: the Bavarian survey's bare-earth heights (DGM1), the real water (OSM river and lake
// areas, each at its own level -- so weirs show as steps), and the real bridges over it as stone arch bridges.
// Data from scripts/build_terrain.py (public/terrain/<city>.json). Everything here is in game units (1 unit = 2.2 m).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Pt = number[];
export type TerrainData = {
  step: number; half: number; n: number; m_per_unit: number; h16: string;
  water: ({ rings: Pt[][]; holes: Pt[][]; level: number } | { line: Pt[]; half_w: number; level: number })[];
  bridges: { line: Pt[]; half_w: number; name: string }[];
};

const VEX = 1.25;   // heights a little taller than life: the toy town reads better with a bit more drama
const FINE = 2;     // ground mesh / lookup grid spacing, units
const DEPTH = 1.6;  // river bed below the water surface
const BANK = 3;     // banks within this distance of the water are kept above it (sand-coloured)
const CLEAR = 1.7;  // bridge deck at least this far above the water

export type Terrain = ReturnType<typeof buildTerrain>;

export function buildTerrain(td: TerrainData, opts: { grassMap?: THREE.Texture }) {
  const toU = (m: number) => (m / td.m_per_unit) * VEX;
  const half = td.half, N = Math.round((half * 2) / FINE) + 1;
  const idx = (ix: number, iz: number) => iz * N + ix;

  // ---- heights: the 4-unit survey grid resampled to 2 units
  const bytes = Uint8Array.from(atob(td.h16), (c) => c.charCodeAt(0));
  const dem = new Int16Array(bytes.buffer);
  const demAt = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(td.n - 1.001, (x + half) / td.step)), fz = Math.max(0, Math.min(td.n - 1.001, (z + half) / td.step));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const g = (a: number, b: number) => dem[b * td.n + a]! / 10;
    return toU((g(ix, iz) * (1 - tx) + g(ix + 1, iz) * tx) * (1 - tz) + (g(ix, iz + 1) * (1 - tx) + g(ix + 1, iz + 1) * tx) * tz);
  };
  const hg = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) hg[idx(ix, iz)] = demAt(-half + ix * FINE, -half + iz * FINE);
  // Smooth away narrow man-made ridges and cuts (railway embankments, sunken roads: 10-15 m wide, and the game draws
  // no railways, so they read as odd dark bands) while hills and river valleys, hundreds of metres across, stay.
  const tmpH = new Float32Array(N * N);
  for (let pass = 0; pass < 3; pass++) {
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) { // 5 taps along x (10 units)
      let sum = 0; for (let k = -2; k <= 2; k++) sum += hg[idx(Math.max(0, Math.min(N - 1, ix + k)), iz)]!;
      tmpH[idx(ix, iz)] = sum / 5;
    }
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) { // then along z
      let sum = 0; for (let k = -2; k <= 2; k++) sum += tmpH[idx(ix, Math.max(0, Math.min(N - 1, iz + k)))]!;
      hg[idx(ix, iz)] = sum / 5;
    }
  }

  // ---- water: which cells are wet (and at what level), and how far dry cells are from the water
  const wl = new Float32Array(N * N).fill(NaN);
  const wd = new Float32Array(N * N).fill(99);
  const wnear = new Float32Array(N * N).fill(NaN);
  const segDist = (x: number, z: number, a: Pt, b: Pt) => {
    const ex = b[0]! - a[0]!, ez = b[1]! - a[1]!, L = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]!) * ex + (z - a[1]!) * ez) / L));
    return Math.hypot(x - a[0]! - t * ex, z - a[1]! - t * ez);
  };
  const inRing = (x: number, z: number, r: Pt[]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i] as [number, number], [xj, zj] = r[j] as [number, number];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (const f of td.water) {
    const level = toU(f.level);
    const pts = "rings" in f ? f.rings.flat() : f.line;
    const pad = BANK + 1 + ("half_w" in f ? f.half_w : 0);
    const x0 = Math.min(...pts.map((p) => p[0]!)) - pad, x1 = Math.max(...pts.map((p) => p[0]!)) + pad;
    const z0 = Math.min(...pts.map((p) => p[1]!)) - pad, z1 = Math.max(...pts.map((p) => p[1]!)) + pad;
    for (let iz = Math.max(0, Math.floor((z0 + half) / FINE)); iz <= Math.min(N - 1, Math.ceil((z1 + half) / FINE)); iz++)
      for (let ix = Math.max(0, Math.floor((x0 + half) / FINE)); ix <= Math.min(N - 1, Math.ceil((x1 + half) / FINE)); ix++) {
        const x = -half + ix * FINE, z = -half + iz * FINE, k = idx(ix, iz);
        let inside: boolean, d = Infinity;
        if ("rings" in f) {
          inside = f.rings.some((r) => inRing(x, z, r)) && !f.holes.some((r) => inRing(x, z, r));
          if (!inside) for (const r of [...f.rings, ...f.holes]) for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(x, z, r[j]!, r[i]!));
        } else {
          for (let i = 0; i < f.line.length - 1; i++) d = Math.min(d, segDist(x, z, f.line[i]!, f.line[i + 1]!));
          d -= f.half_w; inside = d <= 0;
        }
        if (inside) { if (isNaN(wl[k]!)) wl[k] = level; wd[k] = 0; }
        else if (d < wd[k]!) { wd[k] = d; wnear[k] = level; }
      }
  }
  // carve the beds, keep the banks just above the water
  for (let k = 0; k < N * N; k++) {
    if (!isNaN(wl[k]!)) hg[k] = Math.min(hg[k]!, wl[k]! - DEPTH);
    else if (wd[k]! < BANK) hg[k] = Math.max(hg[k]!, wnear[k]! + 0.35);
  }

  const cell = (x: number, z: number) => {
    const ix = Math.max(0, Math.min(N - 1, Math.round((x + half) / FINE))), iz = Math.max(0, Math.min(N - 1, Math.round((z + half) / FINE)));
    return idx(ix, iz);
  };
  function height(x: number, z: number): number {
    const fx = Math.max(0, Math.min(N - 1.001, (x + half) / FINE)), fz = Math.max(0, Math.min(N - 1.001, (z + half) / FINE));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    // same diagonal split as the mesh below, so feet and wheels sit exactly on the drawn ground
    const a = hg[idx(ix, iz)]!, b = hg[idx(ix + 1, iz)]!, c = hg[idx(ix, iz + 1)]!, d = hg[idx(ix + 1, iz + 1)]!;
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  /** Water surface height at (x, z), or NaN on dry land. */
  const waterLevel = (x: number, z: number) => wl[cell(x, z)]!;
  /** Distance to the nearest water, 0 in it (capped: anything past ~10 units just reads as far). */
  const waterDist = (x: number, z: number) => Math.min(wd[cell(x, z)]!, 99);

  const group = new THREE.Group();

  // ---- ground mesh with vertex colours: grass, darker on slopes, sand on the banks and river bed
  let minH = Infinity, maxH = -Infinity;
  for (let k = 0; k < N * N; k++) { minH = Math.min(minH, hg[k]!); maxH = Math.max(maxH, hg[k]!); }
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
  const cGrass = new THREE.Color("#93c97a"), cGrassDark = new THREE.Color("#6fa85c"), cRock = new THREE.Color("#b9a78c");
  const cSand = new THREE.Color("#d9ca97"), cBed = new THREE.Color("#a89a6e"), tmp = new THREE.Color();
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
    const k = idx(ix, iz), x = -half + ix * FINE, z = -half + iz * FINE;
    pos.set([x, hg[k]!, z], k * 3); uv.set([x / 6, z / 6], k * 2);
    const sx = (hg[idx(Math.min(N - 1, ix + 1), iz)]! - hg[idx(Math.max(0, ix - 1), iz)]!) / (2 * FINE);
    const sz = (hg[idx(ix, Math.min(N - 1, iz + 1))]! - hg[idx(ix, Math.max(0, iz - 1))]!) / (2 * FINE);
    const slope = Math.hypot(sx, sz);
    if (!isNaN(wl[k]!)) tmp.copy(cBed);
    else if (wd[k]! < 1.6) tmp.copy(cSand);
    else tmp.copy(cGrass).lerp(cGrassDark, Math.min(0.6, slope * 0.7)).lerp(cRock, Math.max(0, Math.min(1, (slope - 1.1) * 1.5)));
    const j = 1 + (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1) * 0.035; // a little per-vertex variation
    col.set([tmp.r * j, tmp.g * j, tmp.b * j], k * 3);
  }
  const index: number[] = [];
  for (let iz = 0; iz < N - 1; iz++) for (let ix = 0; ix < N - 1; ix++) {
    const a = idx(ix, iz), b = idx(ix + 1, iz), c = idx(ix, iz + 1), d = idx(ix + 1, iz + 1);
    index.push(a, c, b, b, c, d);
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  groundGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  groundGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  groundGeo.setIndex(index);
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: opts.grassMap, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  // ---- diorama edge: the map is a slab of earth, cut clean at the border (water shows in the cut too)
  const bottom = minH - 5;
  const skirt: number[] = [], skirtCol: number[] = [];
  const cSoil = new THREE.Color("#9b7652"), cSoilDeep = new THREE.Color("#6d4f36"), cCut = new THREE.Color("#4f9fd0");
  const quad = (ax: number, az: number, ay0: number, ay1: number, bx: number, bz: number, by0: number, by1: number, c0: THREE.Color, c1: THREE.Color) => {
    skirt.push(ax, ay0, az, bx, by0, bz, ax, ay1, az, bx, by0, bz, bx, by1, bz, ax, ay1, az);
    for (const c of [c0, c0, c1, c0, c1, c1]) skirtCol.push(c.r, c.g, c.b);
  };
  const edges: [number, number, number, number][] = [[0, 0, 1, 0], [N - 1, 0, 0, 1], [N - 1, N - 1, -1, 0], [0, N - 1, 0, -1]];
  for (const [sx, sz, dx, dz] of edges)
    for (let i = 0; i < N - 1; i++) {
      const ax = sx + dx * i, az = sz + dz * i, bx = ax + dx, bz = az + dz;
      const ka = idx(ax, az), kb = idx(bx, bz);
      const [wx0, wz0, wx1, wz1] = [-half + ax * FINE, -half + az * FINE, -half + bx * FINE, -half + bz * FINE];
      quad(wx0, wz0, bottom, hg[ka]!, wx1, wz1, bottom, hg[kb]!, cSoilDeep, cSoil);
      const la = wl[ka]!, lb = wl[kb]!;
      if (!isNaN(la) && !isNaN(lb)) quad(wx0, wz0, hg[ka]!, la, wx1, wz1, hg[kb]!, lb, cCut, cCut);
    }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirt, 3));
  skirtGeo.setAttribute("color", new THREE.Float32BufferAttribute(skirtCol, 3));
  skirtGeo.computeVertexNormals();
  group.add(new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })));

  // ---- water surfaces: flat at their own level, slightly see-through, with drifting ripples and a foam line
  const waveTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(255,255,255,1)";
    for (let i = 0; i < 26; i++) { // short light dashes = sun glints on ripples
      const x = (i * 53) % 128, y = (i * 29) % 128;
      g.fillStyle = "rgba(210,236,250,0.9)"; g.fillRect(x, y, 10 + (i % 3) * 5, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 14, 1 / 14);
    return t;
  })();
  const waterMat = new THREE.MeshStandardMaterial({ color: "#5cb6e0", map: waveTex, roughness: 0.16, metalness: 0.08, transparent: true, opacity: 0.88 });
  const foamMat = new THREE.MeshBasicMaterial({ color: "#f2fbff", transparent: true, opacity: 0.55, depthWrite: false });
  const shapeOf = (r: Pt[]) => new THREE.Shape(r.map((p) => new THREE.Vector2(p[0]!, -p[1]!)));
  const flatRibbon = (line: Pt[], hw: number, y: number, closed = false) => {
    const ln = closed ? [...line, line[0]!, line[1]!] : line;
    const v: number[] = [];
    const side = (i: number) => {
      const p = ln[Math.max(0, i - 1)]!, q = ln[Math.min(ln.length - 1, i + 1)]!;
      const dx = q[0]! - p[0]!, dz = q[1]! - p[1]!, L = Math.hypot(dx, dz) || 1;
      return [-dz / L * hw, dx / L * hw];
    };
    for (let i = 0; i < ln.length - (closed ? 2 : 1); i++) {
      const [ax, az] = ln[i] as [number, number], [bx, bz] = ln[i + 1] as [number, number];
      const [pax, paz] = side(i), [pbx, pbz] = side(i + 1);
      v.push(ax + pax, y, az + paz, bx + pbx, y, bz + pbz, ax - pax, y, az - paz, bx + pbx, y, bz + pbz, bx - pbx, y, bz - pbz, ax - pax, y, az - paz);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(v.flatMap((_, i) => (i % 3 === 0 ? [v[i]!, v[i + 2]!] : [])), 2));
    g.computeVertexNormals();
    return g;
  };
  const waterGeos: THREE.BufferGeometry[] = [], foamGeos: THREE.BufferGeometry[] = [];
  for (const f of td.water) {
    const y = toU(f.level);
    if ("rings" in f) {
      for (const r of f.rings) {
        const s = shapeOf(r);
        for (const h of f.holes) if (r.length && inRing(h[0]![0]!, h[0]![1]!, r)) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0]!, -p[1]!))));
        const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
        waterGeos.push(g.toNonIndexed());
        foamGeos.push(flatRibbon(r, 0.35, y + 0.03, true));
      }
      for (const h of f.holes) foamGeos.push(flatRibbon(h, 0.35, y + 0.03, true));
    } else waterGeos.push(flatRibbon(f.line, f.half_w, y));
  }
  const clean = (gs: THREE.BufferGeometry[]) => gs.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; });
  const waterMesh = waterGeos.length ? new THREE.Mesh(mergeGeometries(clean(waterGeos))!, waterMat) : null;
  if (waterMesh) { waterMesh.receiveShadow = true; waterMesh.renderOrder = 1; group.add(waterMesh); }
  if (foamGeos.length) { const fm = new THREE.Mesh(mergeGeometries(clean(foamGeos))!, foamMat); fm.renderOrder = 2; group.add(fm); }

  // ---- bridges: the real OSM bridge lines as stone arch bridges; the deck rises to clear the water
  type Bridge = { xs: number[]; zs: number[]; deck: number[]; hw: number; minX: number; maxX: number; minZ: number; maxZ: number };
  const bridges: Bridge[] = [];
  const deckTris: number[] = [], stoneTris: number[] = [];
  const physBoxes: { pos: THREE.Vector3; quat: THREE.Quaternion; half: THREE.Vector3 }[] = [];
  const tri = (arr: number[], ...p: number[][]) => { for (const q of p) arr.push(q[0]!, q[1]!, q[2]!); };
  const quadTo = (arr: number[], a: number[], b: number[], c: number[], d: number[]) => tri(arr, a, b, c, b, d, c); // a-b bottom, c-d top
  for (const b0 of td.bridges) {
    // OSM bridge ends often stop at the water's edge, where our ground is carved down: extend each end until it reaches
    // dry bank above the water, so the deck starts level with the street instead of climbing out of the river bed
    const levs: number[] = [];
    for (let i = 0; i < b0.line.length - 1; i++) for (let t = 0; t <= 1; t += 0.1) {
      const l = waterLevel(b0.line[i]![0]! + (b0.line[i + 1]![0]! - b0.line[i]![0]!) * t, b0.line[i]![1]! + (b0.line[i + 1]![1]! - b0.line[i]![1]!) * t);
      if (!isNaN(l)) levs.push(l);
    }
    const wMax = levs.length ? Math.max(...levs) : -Infinity;
    const line = b0.line.map((p) => [p[0]!, p[1]!]);
    for (const [e, n] of [[0, 1], [line.length - 1, line.length - 2]] as const) {
      const dx = line[e]![0]! - line[n]![0]!, dz = line[e]![1]! - line[n]![1]!, L = Math.hypot(dx, dz) || 1;
      for (let k = 0; k <= 10; k++) {
        const x = line[e]![0]! + (dx / L) * k, z = line[e]![1]! + (dz / L) * k;
        if (isNaN(waterLevel(x, z)) && height(x, z) >= wMax + 0.25) { line[e] = [x, z]; break; }
      }
    }
    const b = { ...b0, line };
    const xs: number[] = [], zs: number[] = [], ss: number[] = [];
    let s = 0;
    for (let i = 0; i < b.line.length - 1; i++) {
      const [ax, az] = b.line[i] as [number, number], [bx, bz] = b.line[i + 1] as [number, number];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L));
      for (let j = 0; j < n; j++) { xs.push(ax + ((bx - ax) * j) / n); zs.push(az + ((bz - az) * j) / n); ss.push(s + (L * j) / n); }
      s += L;
    }
    const last = b.line[b.line.length - 1]!;
    xs.push(last[0]!); zs.push(last[1]!); ss.push(s);
    if (s < 3) continue;
    const M = xs.length;
    const lev = xs.map((x, i) => waterLevel(x, zs[i]!));
    if (!lev.some((l) => !isNaN(l))) continue;
    const endH = (i: number) => (isNaN(lev[i]!) ? height(xs[i]!, zs[i]!) : lev[i]! + CLEAR);
    const hS = endH(0), hE = endH(M - 1);
    const need = Math.max(...lev.filter((l) => !isNaN(l))) + CLEAR;
    let bump = 0;
    for (let i = 0; i < M; i++) if (!isNaN(lev[i]!)) {
      const t = ss[i]! / s;
      bump = Math.max(bump, (need - (hS + (hE - hS) * t)) / Math.max(0.35, Math.sin(Math.PI * t)));
    }
    bump = Math.max(0, Math.min(4, bump, (0.28 * s) / Math.PI)); // steepest at the ends: keep it drivable (~15 degrees)
    const deck = ss.map((si) => { const t = si / s; return hS + (hE - hS) * t + bump * Math.sin(Math.PI * t); });
    const hw = Math.max(2.2, b.half_w * 1.2); // at least 4.4 wide: the truck (1.95) must fit between the parapets
    bridges.push({ xs, zs, deck, hw, minX: Math.min(...xs) - hw, maxX: Math.max(...xs) + hw, minZ: Math.min(...zs) - hw, maxZ: Math.max(...zs) + hw });

    // arches over the wet stretch: piers standing in the river bed, semi-elliptic arches between them
    const wetIdx = lev.map((l, i) => (isNaN(l) ? -1 : i)).filter((i) => i >= 0);
    const s0 = ss[wetIdx[0]!]! - 1, s1 = ss[wetIdx[wetIdx.length - 1]!]! + 1;
    const nSpan = Math.max(1, Math.round((s1 - s0) / 8)), span = (s1 - s0) / nSpan, pf = Math.min(0.2, 1.3 / span);
    const bedAt = (i: number) => (isNaN(lev[i]!) ? height(xs[i]!, zs[i]!) : lev[i]! - DEPTH);
    const arch = ss.map((si, i) => {
      if (si < s0 || si > s1) return -Infinity;
      const u = ((si - s0) % span) / span, base = bedAt(i), top = deck[i]! - 0.55;
      if (u < pf || u > 1 - pf) return base;
      const v = (u - pf) / (1 - 2 * pf);
      return base + (top - base) * Math.sqrt(Math.max(0, 1 - (2 * v - 1) ** 2));
    });
    const side = (i: number, sign: number, off: number) => {
      const p = Math.max(0, i - 1), q = Math.min(M - 1, i + 1);
      const dx = xs[q]! - xs[p]!, dz = zs[q]! - zs[p]!, L = Math.hypot(dx, dz) || 1;
      return [xs[i]! - (dz / L) * off * sign, zs[i]! + (dx / L) * off * sign];
    };
    for (let i = 0; i < M - 1; i++) {
      const j = i + 1;
      const [lix, liz] = side(i, 1, hw), [ljx, ljz] = side(j, 1, hw), [rix, riz] = side(i, -1, hw), [rjx, rjz] = side(j, -1, hw);
      // deck
      quadTo(deckTris, [rix, deck[i]!, riz], [rjx, deck[j]!, rjz], [lix, deck[i]!, liz], [ljx, deck[j]!, ljz]);
      for (const sign of [1, -1]) {
        const [ax, az] = sign > 0 ? [lix, liz] : [rix, riz], [bx, bz] = sign > 0 ? [ljx, ljz] : [rjx, rjz];
        // spandrel wall: from the arch (or the ground) up to the parapet top
        const lowI = Math.max(arch[i]!, height(ax, az) - 0.5), lowJ = Math.max(arch[j]!, height(bx, bz) - 0.5);
        const topI = deck[i]! + 0.7, topJ = deck[j]! + 0.7;
        if (sign > 0) quadTo(stoneTris, [ax, lowI, az], [bx, lowJ, bz], [ax, topI, az], [bx, topJ, bz]);
        else quadTo(stoneTris, [bx, lowJ, bz], [ax, lowI, az], [bx, topJ, bz], [ax, topI, az]);
        // parapet: inner face and cap
        const [cix, ciz] = side(i, sign, hw - 0.3), [cjx, cjz] = side(j, sign, hw - 0.3);
        if (sign > 0) { quadTo(stoneTris, [cjx, deck[j]!, cjz], [cix, deck[i]!, ciz], [cjx, topJ, cjz], [cix, topI, ciz]); quadTo(stoneTris, [cix, topI, ciz], [cjx, topJ, cjz], [ax, topI, az], [bx, topJ, bz]); }
        else { quadTo(stoneTris, [cix, deck[i]!, ciz], [cjx, deck[j]!, cjz], [cix, topI, ciz], [cjx, topJ, cjz]); quadTo(stoneTris, [cjx, topJ, cjz], [cix, topI, ciz], [bx, topJ, bz], [ax, topI, az]); }
      }
      // soffit: the underside of the arch, facing down
      if (arch[i]! > -Infinity && arch[j]! > -Infinity) quadTo(stoneTris, [lix, arch[i]!, liz], [ljx, arch[j]!, ljz], [rix, arch[i]!, riz], [rjx, arch[j]!, rjz]);
    }
    // physics: approach ramps at both ends (dip into the ground, so the deck edge is never a kerb) ...
    for (const [e, n] of [[0, 1], [M - 1, M - 2]] as const) {
      const ex = xs[e]! - xs[n]!, ez = zs[e]! - zs[n]!, eL = Math.hypot(ex, ez) || 1, ux = ex / eL, uz = ez / eL;
      const len = 3, drop = 0.7, slope = Math.atan2(drop, len);
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(uz, ux), -slope, "YZX"));
      const mid = new THREE.Vector3(xs[e]! + (ux * len) / 2, deck[e]! - drop / 2, zs[e]! + (uz * len) / 2);
      physBoxes.push({ pos: mid.add(new THREE.Vector3(0, -0.3, 0).applyQuaternion(quat)), quat, half: new THREE.Vector3(len / 2 + 0.1, 0.3, hw) });
    }
    // ... then the deck and the parapets as a chain of thin boxes, every ~3 units
    for (let i = 0; i < M - 1; i += 3) {
      const j = Math.min(M - 1, i + 3);
      const dx = xs[j]! - xs[i]!, dz = zs[j]! - zs[i]!, dy = deck[j]! - deck[i]!, L = Math.hypot(dx, dz);
      if (L < 0.2) continue;
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(dz, dx), Math.atan2(dy, L), "YZX"));
      const mid = new THREE.Vector3((xs[i]! + xs[j]!) / 2, (deck[i]! + deck[j]!) / 2, (zs[i]! + zs[j]!) / 2);
      const down = new THREE.Vector3(0, -0.3, 0).applyQuaternion(quat);
      physBoxes.push({ pos: mid.clone().add(down), quat, half: new THREE.Vector3(Math.hypot(L, dy) / 2 + 0.15, 0.3, hw) });
      for (const sign of [1, -1]) {
        const off = new THREE.Vector3(0, 0.5, sign * (hw - 0.15)).applyQuaternion(quat);
        physBoxes.push({ pos: mid.clone().add(off), quat, half: new THREE.Vector3(Math.hypot(L, dy) / 2 + 0.15, 0.5, 0.15) });
      }
    }
  }
  const trisGeo = (arr: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g; };
  const deckMat = new THREE.MeshStandardMaterial({ color: "#efe0bd", roughness: 0.95, side: THREE.DoubleSide });
  const stoneMat = new THREE.MeshStandardMaterial({ color: "#d8bf92", roughness: 0.9, side: THREE.DoubleSide });
  if (deckTris.length) {
    const dm = new THREE.Mesh(trisGeo(deckTris), deckMat), sm = new THREE.Mesh(trisGeo(stoneTris), stoneMat);
    dm.receiveShadow = sm.receiveShadow = sm.castShadow = true;
    group.add(dm, sm);
  }
  /** Bridge deck height at (x, z), or null when not on a bridge. */
  function deckAt(x: number, z: number): number | null {
    for (const b of bridges) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      for (let i = 0; i < b.xs.length - 1; i++) {
        const ax = b.xs[i]!, az = b.zs[i]!, ex = b.xs[i + 1]! - ax, ez = b.zs[i + 1]! - az, L = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L));
        if (Math.hypot(x - ax - t * ex, z - az - t * ez) <= b.hw - 0.2) return b.deck[i]! + (b.deck[i + 1]! - b.deck[i]!) * t;
      }
    }
    return null;
  }
  /** The longest real bridge passing within r of (x, z) (for decorating a landmark bridge), or null. */
  function bridgeNear(x: number, z: number, r: number) {
    let best: Bridge | null = null, bestLen = 0;
    for (const b of bridges) {
      if (!b.xs.some((bx, i) => Math.hypot(bx - x, b.zs[i]! - z) < r)) continue;
      if (b.xs.length > bestLen) { best = b; bestLen = b.xs.length; }
    }
    return best;
  }
  /** Where feet and wheels go: the bridge deck when on one, else the ground. */
  const surface = (x: number, z: number) => deckAt(x, z) ?? height(x, z);
  /** In water deep enough to swim (and not on a bridge). */
  const inWater = (x: number, z: number) => { const l = waterLevel(x, z); return !isNaN(l) && height(x, z) < l - 0.3 && deckAt(x, z) === null; };

  let t0 = 0;
  function update(dt: number) { t0 += dt; waveTex.offset.set(t0 * 0.012, Math.sin(t0 * 0.3) * 0.02); foamMat.opacity = 0.45 + Math.sin(t0 * 1.3) * 0.12; }

  return { group, ground, bridgeNear, height, surface, waterLevel, waterDist, inWater, deckAt, physBoxes, waterMat, waterMesh, groundMat, update, minH, maxH, bridgeCount: bridges.length };
}
