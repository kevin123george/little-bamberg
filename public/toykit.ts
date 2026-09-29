// Toy-town modelling kit: small, reusable parts (rounded walls, roofs, window rows, half-timbering, arcades, towers,
// spires, onion domes, clocks, statues, fountains, bridge arches, balustrades) that the landmark models in
// landmarks.ts are assembled from. Everything is built in local units (1 unit ≈ 2.2 m, the game's scale), +z is the
// front of a building, y is up, the origin is on the ground at the footprint centre.
//
// bake() merges a finished model into one mesh per material, so a detailed landmark costs a handful of draw calls.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ---------------- colours ----------------
export const C = {
  plaster: "#f6ead3", cream: "#fbf3df", white: "#f7f5f0", sand: "#e9cf9c", sandstone: "#d8b27a", sandstoneDark: "#b98a58",
  redstone: "#c8715a", pinkstone: "#dc9a86", ochre: "#f0c35e", yellow: "#f7d774", salmon: "#f2a489", rose: "#ecb3b8",
  sky: "#9fc9e3", mint: "#a8d8bf", roof: "#d9573f", roofDark: "#a8452f", slate: "#5d6878", copper: "#6cb89c",
  copperDark: "#4f9a80", gold: "#f2c14e", timber: "#6b4128", glass: "#4f7fa8", glassNight: "#ffd88a", frame: "#fffaf0",
  door: "#7a4a2b", stoneGrey: "#b9b3a8", darkStone: "#8a8378", water: "#4fb3e8", green: "#79c05a", flower: "#e8586b",
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Shared material per colour/finish -- models reuse these, and bake() merges by them. */
export function mat(color: string, o: { rough?: number; metal?: number; emissive?: string; flat?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = [color, o.rough ?? 0.7, o.metal ?? 0, o.emissive ?? "", o.flat ? 1 : 0].join("|");
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0, flatShading: !!o.flat });
    if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = 0; m.userData.nightGlow = true; }
    matCache.set(key, m);
  }
  return m;
}
/** Window glass glows warm at night (the game drives emissiveIntensity for every material flagged nightGlow). */
export const glassMat = () => mat(C.glass, { rough: 0.25, metal: 0.1, emissive: C.glassNight });
export function nightGlowMaterials(): THREE.MeshStandardMaterial[] {
  return [...matCache.values()].filter((m) => m.userData.nightGlow);
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

// ---------------- basic solids ----------------
/** A softly rounded box -- the toy look. Sits on y=0 unless placed. */
export function rbox(w: number, h: number, d: number, color: string, r = 0.18): THREE.Mesh {
  const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
  const g = rr > 0.02 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return mesh(g, mat(color));
}
export function box(w: number, h: number, d: number, color: string, m?: THREE.Material): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return mesh(g, m ?? mat(color));
}
export function cyl(rTop: number, rBot: number, h: number, color: string, seg = 16, m?: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(0, h / 2, 0);
  return mesh(g, m ?? mat(color));
}
export function cone(r: number, h: number, color: string, seg = 16): THREE.Mesh {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  return mesh(g, mat(color, { rough: 0.55 }));
}
export function sphere(r: number, color: string, o: { rough?: number; metal?: number } = {}): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(r, 18, 12), mat(color, o), 0, r, 0);
}
/** Place an object and return it (chainable helper for compact model code). */
export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0): T {
  o.position.set(x, y, z);
  if (ry) o.rotation.y = ry;
  return o;
}

// ---------------- roofs ----------------
/** Gable roof: ridge along x, width w (along the ridge), depth d, height h, with a little overhang. */
export function gable(w: number, d: number, h: number, color: string, over = 0.35): THREE.Mesh {
  const hw = d / 2 + over;
  const s = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: w + over * 2, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 });
  g.translate(0, 0, -(w + over * 2) / 2);
  g.rotateY(Math.PI / 2);
  return mesh(g, mat(color, { rough: 0.6 }));
}
/** Hip roof: four slopes, ridge along the longer side. */
export function hip(w: number, d: number, h: number, color: string, over = 0.3): THREE.Mesh {
  const W = w + over * 2, D = d + over * 2;
  const ridge = Math.max(0, W - D) / 2;
  const pos = [
    -W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2, // base 0..3
    -ridge, h, 0, ridge, h, 0, // ridge 4,5
  ];
  const idx = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 3, 5, 4, 3, 4, 0, 0, 1, 2, 0, 2, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return mesh(ng, mat(color, { rough: 0.6, flat: true }));
}
/** Mansard-ish roof for palaces: steep lower slope, flat top. */
export function mansard(w: number, d: number, h: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const lower = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.0, 1, 4, 1);
  lower.rotateY(Math.PI / 4);
  lower.scale(w * 1.02, 1, d * 1.02);
  const top = new THREE.CylinderGeometry(Math.SQRT1_2 * 0.8, Math.SQRT1_2, 1, 4, 1);
  top.rotateY(Math.PI / 4);
  top.scale(w, h, d);
  top.translate(0, h / 2, 0);
  g.add(mesh(top, mat(color, { rough: 0.6, flat: true })));
  return g;
}
/** Stepped gable end (the late-gothic Staffelgiebel on town halls and the Hofbräuhaus). */
export function steppedGable(w: number, h: number, steps: number, color: string, thick = 0.5): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < steps; i++) {
    const sw = w * (1 - i / steps), sh = h / steps;
    g.add(at(rbox(sw, sh, thick, color, 0.06), 0, i * sh, 0));
  }
  return g;
}

// ---------------- towers & tops ----------------
/** Lathe profile helper: points (radius, y) from bottom to top. */
function lathe(profile: [number, number][], color: string, seg = 16, o: { rough?: number; metal?: number } = {}): THREE.Mesh {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), seg);
  return mesh(g, mat(color, { rough: o.rough ?? 0.45, metal: o.metal ?? 0.1 }));
}
/** Needle spire (gothic): 8 sides, very pointed, with a small golden finial. */
export function spire(r: number, h: number, color = C.copper): THREE.Group {
  const g = new THREE.Group();
  const c = new THREE.ConeGeometry(r, h, 8);
  c.translate(0, h / 2, 0);
  g.add(mesh(c, mat(color, { rough: 0.5, flat: true })));
  g.add(at(sphere(r * 0.12, C.gold, { metal: 0.6, rough: 0.3 }), 0, h - r * 0.05, 0));
  return g;
}
/** Onion dome with lantern and finial (baroque towers: Augsburg, Passau, Hugenottenkirche, Bartholomä). */
export function onion(r: number, color = C.copper, lantern = true): THREE.Group {
  const g = new THREE.Group();
  const s = r;
  g.add(lathe([[s * 0.95, 0], [s * 1.12, s * 0.35], [s * 1.0, s * 0.75], [s * 0.55, s * 1.15], [s * 0.18, s * 1.45], [s * 0.1, s * 1.6]], color));
  if (lantern) {
    g.add(at(cyl(s * 0.32, s * 0.32, s * 0.5, C.plaster, 8), 0, s * 1.5, 0));
    g.add(at(lathe([[s * 0.4, 0], [s * 0.42, s * 0.18], [s * 0.2, s * 0.45], [s * 0.06, s * 0.6]], color), 0, s * 2.0, 0));
    g.add(at(sphere(s * 0.09, C.gold, { metal: 0.6, rough: 0.3 }), 0, s * 2.6, 0));
  }
  return g;
}
/** The "welsche Haube" of the Munich Frauenkirche: a tall rounded cap with a small lantern. */
export function haube(r: number, color = C.copper): THREE.Group {
  const g = new THREE.Group();
  g.add(lathe([[r, 0], [r * 1.02, r * 0.5], [r * 0.9, r * 1.05], [r * 0.6, r * 1.45], [r * 0.25, r * 1.7], [r * 0.12, r * 1.78]], color));
  g.add(at(cyl(r * 0.18, r * 0.18, r * 0.35, C.plaster, 8), 0, r * 1.72, 0));
  g.add(at(lathe([[r * 0.22, 0], [r * 0.1, r * 0.25], [r * 0.02, r * 0.4]], color), 0, r * 2.05, 0));
  return g;
}
/** Plain dome (Walhalla-style shallow or a church crossing dome). */
export function dome(r: number, color = C.copper, squash = 1): THREE.Mesh {
  const g = new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, squash, 1);
  return mesh(g, mat(color, { rough: 0.45, metal: 0.1 }));
}
/** Square tower with window slots and a cornice; returns the group, top at y=h. */
export function tower(w: number, h: number, color: string, o: { d?: number; windows?: number; clock?: boolean; clockY?: number; cornice?: string } = {}): THREE.Group {
  const d = o.d ?? w;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, color, 0.12));
  g.add(at(rbox(w + 0.3, 0.35, d + 0.3, o.cornice ?? C.white, 0.08), 0, h - 0.35, 0));
  const nw = o.windows ?? Math.max(1, Math.floor(h / 4));
  for (let i = 0; i < nw; i++) {
    const y = h * (0.25 + (0.6 * i) / Math.max(1, nw));
    for (const side of [0, 1, 2, 3]) {
      const win = archWindow(Math.min(w, d) * 0.22, Math.min(2.2, h * 0.08));
      const ang = (side * Math.PI) / 2;
      const off = (side % 2 === 0 ? d : w) / 2 + 0.02;
      win.position.set(Math.sin(ang) * off, y, Math.cos(ang) * off);
      win.rotation.y = ang;
      g.add(win);
    }
  }
  if (o.clock) {
    const cy = o.clockY ?? h * 0.82;
    for (const side of [0, 1, 2, 3]) {
      const ang = (side * Math.PI) / 2, off = (side % 2 === 0 ? d : w) / 2 + 0.05;
      const cl = clock(Math.min(w, d) * 0.3);
      cl.position.set(Math.sin(ang) * off, cy, Math.cos(ang) * off);
      cl.rotation.y = ang;
      g.add(cl);
    }
  }
  return g;
}
/** Clock face (facing +z): white dial, gold rim, two hands. */
export function clock(r: number): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.08, 24); rim.rotateX(Math.PI / 2);
  g.add(mesh(rim, mat(C.gold, { metal: 0.5, rough: 0.35 })));
  const face = new THREE.CylinderGeometry(r, r, 0.1, 24); face.rotateX(Math.PI / 2); face.translate(0, 0, 0.02);
  g.add(mesh(face, mat(C.white)));
  const h1 = new THREE.BoxGeometry(r * 0.1, r * 0.7, 0.04); h1.translate(0, r * 0.3, 0.1);
  const h2 = new THREE.BoxGeometry(r * 0.08, r * 0.5, 0.04); h2.translate(0, r * 0.2, 0.1); h2.rotateZ(-2.1);
  g.add(mesh(h1, mat("#222222")), mesh(h2, mat("#222222")));
  return g;
}

// ---------------- windows, doors, facades ----------------
/** A window facing +z: light frame, blue glass (glows at night), small sill. Origin at its centre. */
export function window_(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(w + 0.18, h + 0.18, 0.1, C.frame), 0, -(h + 0.18) / 2, 0));
  g.add(at(box(w, h, 0.12, "", glassMat()), 0, -h / 2, 0.02));
  g.add(at(box(w * 0.08, h, 0.14, C.frame), 0, -h / 2, 0.03));
  g.add(at(box(w + 0.3, 0.1, 0.22, C.frame), 0, -h / 2 - 0.12 - h / 2, 0.06));
  return g;
}
/** Round-headed window (baroque / romanesque). */
export function archWindow(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2 - w / 2);
  s.absarc(0, h / 2 - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, -h / 2);
  const glass = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  const frame = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }); frame.scale(1.18, 1.1, 1);
  g.add(mesh(frame, mat(C.frame)), at(mesh(glass, glassMat()), 0, 0, 0.02));
  return g;
}
/** Pointed gothic window with a mullion. */
export function gothicWindow(w: number, h: number, frameColor = C.frame): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2 - w * 0.7);
  s.quadraticCurveTo(w / 2, h / 2 - w * 0.15, 0, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2 - w * 0.15, -w / 2, h / 2 - w * 0.7); s.lineTo(-w / 2, -h / 2);
  const glass = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  const frame = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }); frame.scale(1.15, 1.06, 1);
  g.add(mesh(frame, mat(frameColor)), at(mesh(glass, glassMat()), 0, 0, 0.02));
  g.add(at(box(w * 0.08, h * 0.85, 0.16, frameColor), 0, -h / 2, 0.02));
  return g;
}
/** Rose window (round tracery window, facing +z). */
export function roseWindow(r: number, frameColor = C.frame): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.TorusGeometry(r, r * 0.12, 6, 24);
  g.add(mesh(ring, mat(frameColor)));
  const disc = new THREE.CylinderGeometry(r, r, 0.1, 24); disc.rotateX(Math.PI / 2);
  g.add(mesh(disc, glassMat()));
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.BoxGeometry(r * 1.9, r * 0.08, 0.14); sp.rotateZ((i * Math.PI) / 6);
    g.add(mesh(sp, mat(frameColor)));
  }
  return g;
}
/** Grid of windows on a facade plane facing +z at z=zFace, spanning width w from height y0 to y1. */
export function windowRows(w: number, y0: number, y1: number, rows: number, cols: number, zFace: number,
  kind: "rect" | "arch" | "gothic" = "rect", size = 0.55): THREE.Group {
  const g = new THREE.Group();
  const rowH = (y1 - y0) / rows, colW = w / cols;
  const ww = colW * size, wh = rowH * 0.58;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + colW * (c + 0.5), y = y0 + rowH * (r + 0.5);
    const win = kind === "arch" ? archWindow(ww, wh) : kind === "gothic" ? gothicWindow(ww, wh * 1.2) : window_(ww, wh);
    if (kind === "rect") win.position.set(x, y + wh / 2, zFace); else win.position.set(x, y, zFace);
    g.add(win);
  }
  return g;
}
/** Windows on all four sides of a w x d block. */
export function windowsAround(w: number, d: number, y0: number, y1: number, rows: number, spacing: number,
  kind: "rect" | "arch" | "gothic" = "rect"): THREE.Group {
  const g = new THREE.Group();
  const front = windowRows(w * 0.9, y0, y1, rows, Math.max(1, Math.round(w / spacing)), d / 2 + 0.01, kind);
  const back = windowRows(w * 0.9, y0, y1, rows, Math.max(1, Math.round(w / spacing)), d / 2 + 0.01, kind); back.rotation.y = Math.PI;
  const left = windowRows(d * 0.9, y0, y1, rows, Math.max(1, Math.round(d / spacing)), w / 2 + 0.01, kind); left.rotation.y = -Math.PI / 2;
  const right = windowRows(d * 0.9, y0, y1, rows, Math.max(1, Math.round(d / spacing)), w / 2 + 0.01, kind); right.rotation.y = Math.PI / 2;
  g.add(front, back, left, right);
  return g;
}
/** Door facing +z with an arched top. */
export function door(w: number, h: number, color = C.door): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); s.lineTo(-w / 2, 0);
  const frame = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }); frame.scale(1.2, 1.08, 1);
  g.add(mesh(frame, mat(C.frame)), at(mesh(new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }), mat(color)), 0, 0, 0.02));
  return g;
}
/** Row of open arches (loggias, arcades, market halls) facing +z: piers and arch lintels, dark interior behind. */
export function arcade(n: number, w: number, h: number, depth: number, color: string, pier = 0.5): THREE.Group {
  const g = new THREE.Group();
  const bay = w / n, archR = (bay - pier) / 2;
  g.add(at(box(w, h, depth * 0.9, "#4a3f36"), 0, 0, -depth * 0.05)); // shadowed interior
  for (let i = 0; i <= n; i++) g.add(at(rbox(pier, h - archR, depth, color, 0.06), -w / 2 + i * bay, 0, 0));
  const top = new THREE.Shape();
  top.moveTo(-w / 2, h - archR); top.lineTo(-w / 2, h + 0.6); top.lineTo(w / 2, h + 0.6); top.lineTo(w / 2, h - archR);
  for (let i = n - 1; i >= 0; i--) {
    const cx = -w / 2 + bay * (i + 0.5);
    top.lineTo(cx + archR, h - archR);
    top.absarc(cx, h - archR, archR, 0, Math.PI, false);
  }
  const tg = new THREE.ExtrudeGeometry(top, { depth, bevelEnabled: false });
  tg.translate(0, 0, -depth / 2);
  g.add(mesh(tg, mat(color)));
  return g;
}
/** Canvas texture: half-timbering (Fachwerk) -- dark beams on light infill, tiling. */
const timberTexCache = new Map<string, THREE.CanvasTexture>();
export function timberMat(infill = C.plaster, beam = C.timber): THREE.MeshStandardMaterial {
  const key = "timber|" + infill + beam;
  let m = matCache.get(key);
  if (m) return m;
  let tex = timberTexCache.get(infill + beam);
  if (!tex) {
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
    const x = cv.getContext("2d")!;
    x.fillStyle = infill; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = beam; x.lineWidth = 9; x.lineCap = "square";
    const L = (a: number, b: number, c: number, d: number) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); };
    L(0, 4, 128, 4); L(0, 64, 128, 64); L(0, 124, 128, 124); // sills
    L(4, 0, 4, 128); L(64, 0, 64, 128); L(124, 0, 124, 128); // posts
    L(4, 64, 64, 4); L(64, 4, 124, 64); L(4, 124, 34, 64); L(124, 124, 94, 64); // braces
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(0.35, 0.35);
    timberTexCache.set(infill + beam, tex);
  }
  m = new THREE.MeshStandardMaterial({ color: "#ffffff", map: tex, roughness: 0.8 });
  matCache.set(key, m);
  return m;
}
/** Box whose walls are half-timbered (world-scaled UVs so beams keep their size). */
export function timberBox(w: number, h: number, d: number, infill = C.plaster, beam = C.timber): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute, pos = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const u = nx > 0.5 ? pos.getZ(i) : pos.getX(i);
    uv.setXY(i, u, ny > 0.5 ? pos.getZ(i) : pos.getY(i));
  }
  g.translate(0, h / 2, 0);
  return mesh(g, timberMat(infill, beam));
}

// ---------------- ornaments ----------------
/** A statue on a pedestal: simple figure, bronze-ish or stone. */
export function statue(h: number, color = "#6f7d6a", pedestal = C.stoneGrey): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(h * 0.45, h * 0.35, h * 0.45, pedestal, 0.05));
  g.add(at(cyl(h * 0.12, h * 0.18, h * 0.45, color, 8), 0, h * 0.35, 0));
  g.add(at(sphere(h * 0.1, color), 0, h * 0.78, 0));
  const arm = new THREE.BoxGeometry(h * 0.35, h * 0.06, h * 0.06); arm.rotateZ(0.5); arm.translate(h * 0.1, h * 0.68, 0);
  g.add(mesh(arm, mat(color)));
  return g;
}
/** Lion (Feldherrnhalle) -- a lying toy lion on a plinth. */
export function lion(s: number, color = C.stoneGrey): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(s * 1.2, s * 0.35, s * 0.6, C.stoneGrey, 0.05));
  g.add(at(rbox(s * 1.0, s * 0.35, s * 0.45, color, 0.12), 0, s * 0.35, 0));
  g.add(at(sphere(s * 0.26, color), s * 0.45, s * 0.6, 0));
  return g;
}
/** Round fountain basin with water and a central column. */
export function fountain(r: number, column = 3, stone = C.stoneGrey): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(r, r * 1.05, 0.9, stone, 20));
  g.add(at(cyl(r * 0.88, r * 0.88, 0.1, "", 20, mat(C.water, { rough: 0.1, metal: 0.2 })), 0, 0.82, 0));
  if (column > 0) {
    g.add(at(cyl(r * 0.18, r * 0.24, column, stone, 12), 0, 0.9, 0));
    g.add(at(cyl(r * 0.45, r * 0.3, 0.3, stone, 16), 0, 0.9 + column * 0.55, 0));
  }
  return g;
}
/** Balustrade along x (length len). */
export function balustrade(len: number, h = 0.7, color = C.white): THREE.Group {
  const g = new THREE.Group();
  g.add(at(box(len, 0.14, 0.32, color), 0, h - 0.14, 0));
  g.add(box(len, 0.12, 0.34, color));
  const n = Math.max(2, Math.round(len / 0.45));
  for (let i = 0; i <= n; i++) g.add(at(cyl(0.07, 0.09, h - 0.26, color, 6), -len / 2 + (len * i) / n, 0.12, 0));
  return g;
}
/** Battlements (crenellation) along x. */
export function battlements(len: number, color: string, h = 0.6, t = 0.5): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i < n; i += 1) if (i % 2 === 0) g.add(at(box(len / n, h, t, color), -len / 2 + (len * (i + 0.5)) / n, 0, 0));
  return g;
}
/** Flag on a pole: two colours (Bavarian white/blue by default). */
export function flag(h = 4, c1 = "#ffffff", c2 = "#3b82c4"): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.08, h, "#dddddd", 6));
  g.add(at(box(1.2, 0.35, 0.05, c1), 0.62, h - 0.4, 0), at(box(1.2, 0.35, 0.05, c2), 0.62, h - 0.75, 0));
  return g;
}
/** Window boxes with red flowers under a row of windows (Schlenkerla, Klein Venedig). */
export function flowerBox(w: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, 0.25, 0.3, "#7a4a2b"));
  for (let i = 0; i < 4; i++) g.add(at(sphere(0.13, i % 2 ? C.flower : "#f2f2f2"), -w / 2 + (w * (i + 0.5)) / 4, 0.2, 0));
  return g;
}
/** Stone bridge along x with n round arches over water, deck height h, width d. */
export function stoneBridge(len: number, d: number, h: number, n: number, color = C.sandstone): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  const bay = len / n, r = bay * 0.36;
  s.moveTo(-len / 2, -1.5); s.lineTo(-len / 2, h); s.lineTo(len / 2, h); s.lineTo(len / 2, -1.5);
  for (let i = n - 1; i >= 0; i--) {
    const cx = -len / 2 + bay * (i + 0.5);
    s.lineTo(cx + r, -1.5); s.lineTo(cx + r, h - 0.9 - r); s.absarc(cx, h - 0.9 - r, r, 0, Math.PI, false); s.lineTo(cx - r, -1.5);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  g.add(mesh(geo, mat(color)));
  g.add(at(box(len, 0.6, 0.35, color), 0, h, d / 2 - 0.17), at(box(len, 0.6, 0.35, color), 0, h, -d / 2 + 0.17));
  for (let i = 1; i < n; i++) { // pier cutwaters
    const cw = new THREE.CylinderGeometry(0.01, d * 0.5, 1.6, 3); cw.rotateX(Math.PI / 2); cw.rotateZ(Math.PI / 2);
    g.add(at(mesh(cw, mat(color)), -len / 2 + bay * i, 0.2, d / 2 + 0.6));
  }
  return g;
}

// ---------------- bake ----------------
/** Merge all meshes in `root` into one mesh per material (keeps shadows); returns a new group. */
export function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position as THREE.BufferAttribute).count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mm = m.material as THREE.Material;
    if (!buckets.has(mm)) buckets.set(mm, []);
    buckets.get(mm)!.push(g);
  });
  const out = new THREE.Group();
  buckets.forEach((geos, mm) => {
    const merged = mergeGeometries(geos, false);
    if (!merged) return;
    const me = new THREE.Mesh(merged, mm);
    me.castShadow = true; me.receiveShadow = true;
    out.add(me);
  });
  return out;
}
