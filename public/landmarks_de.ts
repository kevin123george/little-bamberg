// Toy models of the landmarks in the ten cities outside Bavaria (Berlin ... Bremen). Same conventions as landmarks.ts:
// 1 unit ≈ 2.2 m, +z is the main facade, origin = footprint centre on the ground; builders get the real footprint's
// oriented size (w along, d deep). Tall ones keep their real height -- they are what you see from the next city.
import * as THREE from "three";
import {
  C, rbox, box, cyl, cone, sphere, at, gable, hip, steppedGable, spire, onion, dome, tower, clock,
  archWindow, gothicWindow, roseWindow, windowRows, windowsAround, door, arcade, statue, lion, fountain, balustrade,
  battlements, flag, stoneBridge, mansard,
} from "./toykit";
import { G, clamp, gothicNave, roundNave, baroqueTower, toyHouse, market, plazaDisc, lollipop, type Builder } from "./landmarks";

const BRICK = "#b5553f", BRICK_DARK = "#8e3f30", SAND = "#e2cf9f", GREY = "#b9b3a8", GLASS = "#8fb7d6";

/** A half-cylinder roof (train shed, glass arcade) of radius r and length len, lying along z, curved side up. */
function barrel(r: number, len: number, color: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16, 1, true, -Math.PI / 2, Math.PI), box(1, 1, 1, color).material);
  m.rotation.x = -Math.PI / 2;
  return m;
}
/** A classical portico: columns, entablature, pediment. */
function portico(n: number, w: number, h: number, color = C.white): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) g.add(at(cyl(0.45, 0.5, h, color, 12), -w / 2 + 0.6 + (i * (w - 1.2)) / (n - 1), 0, 0));
  g.add(at(box(w + 0.6, 1, 2.2, color), 0, h, -0.4));
  const ped = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.3, 0), new THREE.Vector2(w / 2 + 0.3, 0), new THREE.Vector2(0, w * 0.18)]);
  g.add(at(new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 0.8, bevelEnabled: false }), rbox(1, 1, 1, color).material), 0, h + 1, -0.8));
  return g;
}
/** A glass-and-steel tower (skyscraper). */
function glassTower(w: number, d: number, h: number, color = GLASS, band = "#e8eef3"): THREE.Group {
  const g = G(box(w, h, d, color));
  for (let y = 4; y < h; y += 4) g.add(at(box(w + 0.2, 0.35, d + 0.2, band), 0, y, 0));
  return g;
}
/** A slim TV tower: shaft, ball or pod, antenna. */
function tvTower(h: number, pod: "ball" | "disc", shaft = "#e9e6df"): THREE.Group {
  const g = G(cyl(1.2, 3.4, h, shaft, 16));
  for (let i = 0; i < 3; i++) g.add(at(cone(2.4, 6, shaft, 3), 0, 0, 0)); // the three feet at the base
  if (pod === "ball") {
    g.add(at(sphere(9.5, "#c8ccd2", { metal: 0.4, rough: 0.3 }), 0, h + 3, 0));
    for (let r = 0; r < 12; r++) { const a = (r / 12) * Math.PI * 2; g.add(at(box(0.3, 3, 0.3, "#8a4a9e"), Math.cos(a) * 9.4, h + 3, Math.sin(a) * 9.4)); } // the facets that catch the light
    g.add(at(cyl(0.5, 0.9, 30, "#e03a3a", 8), 0, h + 12, 0), at(cyl(0.3, 0.5, 12, C.white, 8), 0, h + 42, 0));
  } else {
    g.add(at(cyl(7, 4, 5, "#d8dde2", 20), 0, h, 0), at(cyl(5, 7, 4, GLASS, 20), 0, h + 5, 0), at(cyl(0.7, 1, 26, C.white, 8), 0, h + 9, 0));
  }
  return g;
}

// ============================ BERLIN ============================
const berlin: Record<string, Builder> = {
  brandenburger_tor: () => { // 12 doric columns in two rows, attic, the quadriga
    const g = new THREE.Group(), W = 30, H = 10;
    for (let i = 0; i < 6; i++) for (const z of [-3, 3]) g.add(at(cyl(0.7, 0.8, H, SAND, 14), -W / 2 + 1.2 + i * ((W - 2.4) / 5), 0, z));
    for (const x of [-1, 1]) g.add(at(rbox(4.5, H, 8, SAND, 0.1), x * (W / 2 + 2.2), 0, 0)); // side wings
    g.add(at(rbox(W + 2, 2.4, 9, SAND, 0.1), 0, H, 0), at(rbox(12, 2.2, 7, SAND, 0.1), 0, H + 2.4, 0));
    const q = new THREE.Group(); // quadriga: the goddess and four horses, green copper
    for (let i = 0; i < 4; i++) q.add(at(G(box(0.7, 1.2, 2.2, C.copper), at(box(0.5, 1, 0.6, C.copper), 0, 1, 1.1)), -1.5 + i, 0, 0.6));
    q.add(at(box(2.6, 1.2, 1.6, C.copper), 0, 0, -1.2), at(cyl(0.3, 0.4, 2.4, C.copper, 8), 0, 1.2, -1.3), at(box(1.4, 0.2, 0.2, C.copper), 0, 3.6, -1.3));
    g.add(at(q, 0, H + 4.6, 0));
    return g;
  },
  reichstag: (w, d) => { // stone block with four corner towers, portico, the glass dome
    const L = clamp(Math.max(w, d), 60, 64), D = clamp(Math.min(w, d), 42, 46), g = G(rbox(L, 14, D, "#cfc3a4", 0.2));
    g.add(windowsAround(L, D, 1.5, 13, 3, 3.2, "arch"));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(at(G(rbox(10, 19, 10, "#c8bb9a"), at(box(10.6, 1.2, 10.6, "#c8bb9a"), 0, 19, 0)), x * (L / 2 - 5), 0, z * (D / 2 - 5)));
    g.add(at(portico(6, 20, 11, "#d8cdb0"), 0, 0, D / 2 + 1.5));
    g.add(at(dome(9, GLASS, 0.75), 0, 14, 0), at(cyl(0.6, 0.6, 7, "#d7dde3", 8), 0, 14, 0));
    g.add(at(flag(6, "#1d1d1d", "#d63a2f"), -L / 2 + 5, 19, D / 2 - 5), at(flag(6, "#1d1d1d", "#f2c230"), L / 2 - 5, 19, D / 2 - 5));
    return g;
  },
  fernsehturm: () => tvTower(95, "ball"),
  berliner_dom: (w, d) => { // baroque-revival cathedral: big green dome, four corner towers with small domes
    const L = clamp(Math.max(w, d), 50, 56), D = clamp(Math.min(w, d), 34, 40);
    const g = G(rbox(L, 16, D, "#c5b491", 0.2), windowsAround(L, D, 2, 15, 2, 4.4, "arch"));
    g.add(at(cyl(10, 11, 8, "#c5b491", 24), 0, 16, 0), at(dome(11, "#5b9b86", 1.1), 0, 24, 0), at(G(cyl(1.4, 1.6, 4, "#c5b491", 10), at(dome(1.6, C.gold), 0, 4, 0), at(box(0.3, 2.4, 0.3, C.gold), 0, 5.4, 0)), 0, 35, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(at(G(tower(6, 22, "#c5b491", { windows: 2 }), at(dome(3.2, "#5b9b86", 1.3), 0, 22, 0)), x * (L / 2 - 4), 0, z * (D / 2 - 4)));
    g.add(at(arcade(5, 22, 8, 3, "#c5b491"), 0, 0, D / 2 + 1.2));
    return g;
  },
  rotes_rathaus: (w, d) => { // red brick block around a courtyard, tall square clock tower in the front
    const L = clamp(Math.max(w, d), 44, 50), D = clamp(Math.min(w, d), 36, 40);
    const g = G(rbox(L, 13, D, BRICK, 0.15), windowsAround(L, D, 1.5, 12.5, 3, 3, "arch"), at(hip(L, D, 3, BRICK_DARK), 0, 13, 0));
    const t = tower(9, 34, BRICK, { windows: 6, clock: true, clockY: 26 });
    t.add(at(G(cyl(3, 3.5, 4, BRICK, 8), at(cone(3.2, 4, C.copper, 8), 0, 4, 0), at(flag(4, "#ffffff", "#d63a2f"), 0, 8, 0)), 0, 34, 0));
    g.add(at(t, 0, 0, D / 2 - 4.5));
    return g;
  },
  altes_museum: (w, d) => { // long colonnade of 18 ionic columns on a podium, the dome block behind
    const L = clamp(Math.max(w, d), 40, 46), D = clamp(Math.min(w, d), 24, 30);
    const g = G(rbox(L, 2, D + 4, "#ddd4c0", 0.1), at(rbox(L, 13, D, "#e6dfcf", 0.1), 0, 2, -1.5));
    for (let i = 0; i < 18; i++) g.add(at(cyl(0.55, 0.6, 9.5, C.white, 12), -L / 2 + 1.2 + (i * (L - 2.4)) / 17, 2, D / 2 + 0.6));
    g.add(at(box(L + 0.4, 1.4, 2.6, "#e6dfcf"), 0, 11.5, D / 2), at(rbox(14, 4, 14, "#e6dfcf"), 0, 15, -2));
    for (const x of [-1, 1]) g.add(at(statue(2.4, "#6f6250", "#e6dfcf"), x * (L / 2 - 2), 13, D / 2));
    for (let i = 0; i < 7; i++) g.add(at(box(0.8, 0.4, 3.4, "#e6dfcf"), 0, i * 0.3, D / 2 + 2.4 + i * 0.35)); // the wide front steps
    return g;
  },
  gendarmenmarkt: () => { // the square: concert hall in the middle, a domed church each side
    const g = G(plazaDisc(40, "#e7dcc6"));
    const ch = G(rbox(20, 12, 26, "#e6dcc4"), at(portico(6, 16, 10), 0, 0, 14), windowsAround(20, 26, 2, 11, 2, 3.2, "arch"));
    g.add(at(ch, 0, 0, -4));
    for (const x of [-1, 1]) {
      const d = G(cyl(6, 6.5, 14, "#e6dcc4", 16), at(cyl(5, 5, 8, "#e6dcc4", 16), 0, 14, 0), at(dome(5.2, "#5b9b86", 1.4), 0, 22, 0), at(G(cyl(1, 1, 3, "#e6dcc4", 8), at(statue(2, C.gold, C.gold), 0, 3, 0)), 0, 29, 0));
      d.add(at(portico(6, 12, 9), 0, 0, 7));
      g.add(at(d, x * 30, 0, -4));
    }
    g.add(at(statue(3, "#dcd7cc", "#dcd7cc"), 0, 0, 16));
    return g;
  },
};

// ============================ HAMBURG ============================
const hamburg: Record<string, Builder> = {
  elbphilharmonie: (w, d) => { // brick warehouse base, glass top with a wavy roof
    const L = clamp(Math.max(w, d), 50, 60), D = clamp(Math.min(w, d), 28, 34);
    const g = G(rbox(L, 16, D, BRICK_DARK, 0.1), windowRows(L * 0.9, 1, 15, 5, 16, D / 2 + 0.02));
    const glass = G(box(L, 22, D, "#bcd7ea"));
    for (let y = 2; y < 22; y += 2.2) glass.add(at(box(L + 0.1, 0.2, D + 0.1, "#f2f6f9"), 0, y, 0));
    g.add(at(glass, 0, 16, 0));
    for (let i = 0; i < 6; i++) { // the wave roof: peaks of different heights
      const x = -L / 2 + 4 + (i * (L - 8)) / 5, hh = [6, 9, 4, 11, 7, 5][i]!;
      const wv = cone(D * 0.5, hh, "#eef3f7", 4); wv.scale.set(L / 12 / (D * 0.5), 1, 1); g.add(at(wv, x, 38, 0));
    }
    return g;
  },
  rathaus: (w, d) => { // neo-renaissance sandstone front, green roofs, the 112 m tower
    const L = clamp(Math.max(w, d), 52, 60), D = clamp(Math.min(w, d), 30, 36);
    const g = G(rbox(L, 20, D, "#c9b48a", 0.15), windowsAround(L, D, 2, 19, 4, 3, "arch"), at(hip(L, D, 5, "#5b9b86"), 0, 20, 0));
    const t = tower(10, 38, "#c9b48a", { windows: 6, clock: true, clockY: 32 });
    t.add(at(G(cyl(3.6, 4.4, 6, "#5b9b86", 8), at(spire(3, 12, "#5b9b86"), 0, 6, 0)), 0, 38, 0));
    g.add(at(t, 0, 0, D / 2 - 5));
    for (let i = 0; i < 8; i++) g.add(at(statue(1.8, "#8a7a5c", "#c9b48a"), -L / 2 + 5 + (i * (L - 10)) / 7, 10, D / 2 + 0.5));
    return g;
  },
  michel: (w, d) => { // baroque church, the green copper tower 132 m
    const L = clamp(Math.max(w, d), 40, 46), W = clamp(Math.min(w, d), 30, 34);
    const g = G(roundNave(W, L * 0.85, 17, "#d9cdb4", "#5b9b86"));
    const t = tower(9, 46, BRICK, { windows: 6, clock: true, clockY: 40 });
    t.add(at(G(cyl(3.6, 4, 6, "#5b9b86", 8), at(cyl(2.4, 3, 4, "#5b9b86", 8), 0, 6, 0), at(onion(2.6, "#5b9b86"), 0, 10, 0), at(spire(1.2, 6, C.gold), 0, 15, 0)), 0, 46, 0));
    g.add(at(t, 0, 0, L * 0.45));
    return g;
  },
  speicherstadt: () => { // brick warehouse rows along a canal, green copper turrets, a little bridge
    const g = new THREE.Group();
    for (const z of [-11, 11]) for (let i = 0; i < 3; i++) {
      const b = G(rbox(14, 16, 10, BRICK, 0.1), windowRows(12, 1, 15, 5, 5, 5.02), at(steppedGable(10, 5, 3, BRICK), 0, 16, 5));
      b.add(at(G(cyl(1, 1, 3, BRICK, 8), at(cone(1.2, 3, "#5b9b86", 8), 0, 3, 0)), 6, 16, 4));
      g.add(at(b, -16 + i * 16, 0, z, z > 0 ? Math.PI : 0));
    }
    g.add(at(box(48, 0.3, 10, "#3f86b5"), 0, -0.2, 0), at(stoneBridge(10, 4, 1.4, 1, BRICK_DARK), 4, 0, 0, Math.PI / 2));
    return g;
  },
  landungsbruecken: (w, d) => { // long hall with two domed towers (one a clock tower), floating pontoons in front
    const L = clamp(Math.max(w, d), 60, 80), g = G(rbox(L, 7, 12, "#c3b08a", 0.1), at(hip(L, 12, 3, "#5b9b86"), 0, 7, 0), windowRows(L * 0.9, 1, 6.5, 2, 20, 6.02));
    for (const x of [-1, 1]) { const t = tower(6, 18, "#c3b08a", { windows: 3, clock: x > 0, clockY: 14 }); t.add(at(dome(3.4, "#5b9b86", 1.3), 0, 18, 0)); g.add(at(t, x * L * 0.3, 0, 0)); }
    for (let i = 0; i < 4; i++) g.add(at(box(L * 0.2, 0.8, 8, "#6f6a62"), -L * 0.36 + i * L * 0.24, -0.3, 16));
    return g;
  },
  binnenalster: () => { // the lake with its tall fountain and white Alster boats
    const g = G(at(cyl(30, 30, 0.2, "#4d9fd3", 32), 0, 0.05, 0));
    g.add(at(cyl(0.3, 1.2, 28, "#eaf6ff", 10), 0, 0, 0), at(sphere(1.6, "#eaf6ff"), 0, 28, 0));
    for (const [x, z, r] of [[-14, 8, 0.4], [12, -10, 1.8], [8, 14, 3]] as const) g.add(at(G(rbox(7, 1.2, 2.6, C.white, 0.4), at(box(3.4, 1.4, 2, "#dfe9f2"), -0.5, 1.2, 0)), x, 0.1, z, r));
    return g;
  },
  chilehaus: (w, d) => { // dark brick, the sharp ship's-bow corner, stepped top floors
    const L = clamp(Math.max(w, d), 50, 60), D = clamp(Math.min(w, d), 20, 26);
    const s = new THREE.Shape([new THREE.Vector2(-L / 2, -D / 2), new THREE.Vector2(L / 2 - 6, -D / 2), new THREE.Vector2(L / 2 + 6, 0), new THREE.Vector2(L / 2 - 6, D / 2), new THREE.Vector2(-L / 2, D / 2)]);
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 20, bevelEnabled: false }), rbox(1, 1, 1, "#6e3528").material);
    body.rotation.x = -Math.PI / 2;
    const g = G(body, windowRows(L * 0.9, 1, 19, 7, 18, D / 2 + 0.02));
    for (let i = 0; i < 3; i++) g.add(at(rbox(L - 8 - i * 8, 2.4, D - 4 - i * 3, "#6e3528", 0.1), -2 - i * 2, 20 + i * 2.4, 0));
    return g;
  },
};

// ============================ KÖLN ============================
const koeln: Record<string, Builder> = {
  dom: (w, d) => { // the dark gothic giant: long nave, flying buttresses, twin 157 m spires
    const L = clamp(Math.max(w, d), 64, 70), W = clamp(Math.min(w, d), 30, 38), st = "#6e6a62";
    const g = G(gothicNave(W * 0.7, L * 0.85, 28, st, "#4a4d52"));
    for (const x of [-1, 1]) for (let i = 0; i < 6; i++) g.add(at(box(1, 22, 3, st), x * (W * 0.35 + 3), 0, -L * 0.35 + i * L * 0.12));
    for (const s of [-1, 1]) {
      const t = tower(9, 50, st, { windows: 6 });
      for (let i = 0; i < 5; i++) t.add(at(gothicWindow(1.2, 6, "#4a4d52"), 0, 8 + i * 8.5, 4.52));
      t.add(at(spire(6, 22, st), 0, 50, 0), at(sphere(0.8, C.gold), 0, 72.5, 0));
      g.add(at(t, s * (W * 0.35 - 1), 0, L * 0.42));
    }
    g.add(at(door(4, 9, "#3a3530"), 0, 0, L * 0.47), at(roseWindow(3.4, "#4a4d52"), 0, 20, L * 0.47));
    return g;
  },
  hohenzollernbruecke: () => { // three steel arches over the rail deck, the equestrian statues at the ends
    const L = 90, g = new THREE.Group();
    for (let a = 0; a < 3; a++) for (const z of [-6, 0, 6]) {
      const pts: THREE.Vector3[] = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector3(-L / 2 + (a + t) * (L / 3), 4 + Math.sin(t * Math.PI) * 9, z)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.5, 6), box(1, 1, 1, "#6d8a92").material));
      for (let i = 1; i < 8; i++) { const t = i / 8; g.add(at(box(0.25, Math.sin(t * Math.PI) * 9, 0.25, "#6d8a92"), -L / 2 + (a + t) * (L / 3), 4, z)); }
    }
    g.add(at(box(L, 1, 14, "#5a5f63"), 0, 3.5, 0));
    for (const x of [-1, 1]) g.add(at(G(rbox(4, 6, 4, SAND), at(statue(3, "#39413f", SAND), 0, 6, 0)), x * (L / 2 + 2), 0, 9));
    return g;
  },
  gross_st_martin: (w, d) => { // Romanesque: short nave, the huge square crossing tower with four turrets
    const L = clamp(Math.max(w, d), 26, 32), W = clamp(Math.min(w, d), 18, 22), st = "#cdbd9a";
    const g = G(roundNave(W * 0.7, L, 12, st, "#4a4d52"));
    const t = tower(12, 30, st, { windows: 4 });
    t.add(at(cone(8, 10, "#4a4d52", 4), 0, 30, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) t.add(at(G(cyl(1.3, 1.3, 6, st, 8), at(cone(1.6, 5, "#4a4d52", 8), 0, 6, 0)), x * 5.4, 28, z * 5.4));
    for (const a of [0, Math.PI / 2, Math.PI]) g.add(at(G(cyl(5, 5, 11, st, 16, undefined), at(dome(5, "#4a4d52", 0.5), 0, 11, 0)), Math.sin(a) * 8, 0, -L * 0.3 + Math.cos(a) * 0 - (a === Math.PI / 2 ? 0 : 0)));
    g.add(at(t, 0, 0, -L * 0.2));
    return g;
  },
  rathaus: (w, d) => { // gothic tower (61 m) with statues, the renaissance loggia in front
    const L = clamp(Math.max(w, d), 34, 44), D = clamp(Math.min(w, d), 18, 24);
    const g = G(rbox(L, 14, D, "#d8cfbd", 0.15), at(hip(L, D, 4, "#4a4d52"), 0, 14, 0), windowsAround(L, D, 1.5, 13, 3, 3, "gothic"));
    const t = tower(9, 26, "#d8cfbd", { windows: 5 });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) t.add(at(statue(1.4, "#8a8274", "#d8cfbd"), -3 + j * 3, 4 + i * 5.5, 4.6));
    t.add(at(G(cyl(3.2, 4.4, 4, "#d8cfbd", 8), at(spire(3.2, 7, "#4a4d52"), 0, 4, 0)), 0, 26, 0));
    g.add(at(t, -L * 0.3, 0, 0), at(arcade(5, 18, 7, 4, "#e6dfcf"), L * 0.1, 0, D / 2 + 2));
    return g;
  },
  schokoladenmuseum: (w, d) => { // glass and steel ship on the Rhine tip, the gold chocolate fountain inside
    const L = clamp(Math.max(w, d), 40, 52), g = G(rbox(L, 8, 16, "#dce3e8", 0.2), at(box(L * 0.8, 6, 14, GLASS), -2, 8, 0));
    const bow = cone(8, 14, "#dce3e8", 4); bow.rotation.z = -Math.PI / 2; bow.scale.set(1, 1, 0.9); g.add(at(bow, L / 2 + 6, 4, 0));
    g.add(at(G(cyl(1.8, 2.2, 3, "#6b3b22", 12), at(cyl(0.8, 1, 2, C.gold, 10), 0, 3, 0)), -6, 8.2, 0));
    return g;
  },
  heumarkt: () => { // the big square with King Friedrich Wilhelm III on his horse on a tall pedestal
    const g = G(plazaDisc(30));
    const ped = G(rbox(7, 9, 7, "#bdb3a1"), at(rbox(8, 1, 8, "#bdb3a1"), 0, 9, 0));
    for (const [x, z] of [[-3.8, 3.8], [3.8, 3.8], [-3.8, -3.8], [3.8, -3.8]] as const) ped.add(at(statue(2.2, "#39413f", "#bdb3a1"), x, 0, z));
    const horse = G(box(1.6, 2.6, 5, "#39413f"), at(box(1.2, 2, 1.4, "#39413f"), 0, 2, 2.4)); for (const x of [-0.5, 0.5]) for (const z of [-1.8, 1.8]) horse.add(at(box(0.4, 2.4, 0.4, "#39413f"), x, -2.4, z));
    ped.add(at(G(horse, at(statue(2.2, "#39413f", "#39413f"), 0, 2.4, 0)), 0, 12.4, 0));
    g.add(ped, at(market(8, 18, "#c83a3a"), 0, 0, 0));
    return g;
  },
  museum_ludwig: () => { // zig-zag shed roofs of zinc next to the Dom
    const g = G(rbox(40, 8, 26, "#c9b6a0", 0.2));
    for (let i = 0; i < 6; i++) { const r = gable(6.4, 26, 3.4, "#9aa3a8"); r.rotation.y = Math.PI / 2; g.add(at(r, -16 + i * 6.4, 8, 0)); }
    g.add(windowRows(36, 1, 7, 2, 12, 13.02));
    return g;
  },
};

// ============================ FRANKFURT ============================
const frankfurt: Record<string, Builder> = {
  roemer: () => { // three stepped gables in pink-red sandstone, the balcony, and the fountain of Justice in front
    const g = new THREE.Group(), cols = ["#e8b6a0", "#e3a891", "#ecc0ad"];
    for (let i = 0; i < 3; i++) {
      const hs = G(rbox(10, 12, 12, cols[i]!, 0.1), windowRows(8.4, 1, 11.5, 3, 4, 6.02, "gothic"), at(steppedGable(10, 9, 5, cols[i]!), 0, 12, 6));
      hs.add(at(gable(10, 12, 9, C.roofDark), 0, 12, 0));
      g.add(at(hs, -10.4 + i * 10.4, 0, 0));
    }
    g.add(at(box(30, 0.4, 2, "#7c5a4a"), 0, 5, 6.8), at(balustrade(30, 0.9, "#8a6a5a"), 0, 5.4, 7.6));
    g.add(at(G(fountain(3.4, 3, "#bdb3a1"), at(statue(2.6, C.gold, "#bdb3a1"), 0, 3.2, 0)), 0, 0, 24));
    return g;
  },
  kaiserdom: (w, d) => { // red sandstone, the 95 m tower with its gothic dome crown
    const L = clamp(Math.max(w, d), 40, 50), W = clamp(Math.min(w, d), 20, 26), st = "#b4524a";
    const g = G(gothicNave(W * 0.7, L * 0.8, 16, st, "#4a4d52"));
    const t = tower(13, 30, st, { windows: 4 });
    t.add(at(cyl(5.4, 6.4, 12, st, 8), 0, 30, 0), at(G(dome(5.4, "#4a4d52", 1.2), at(spire(2.2, 9, "#4a4d52"), 0, 6, 0)), 0, 42, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; t.add(at(spire(0.6, 4, st), Math.cos(a) * 6, 40, Math.sin(a) * 6)); }
    g.add(at(t, 0, 0, L * 0.45));
    return g;
  },
  paulskirche: () => { // the oval red sandstone church, flat dome, the tower in front
    const g = G(cyl(15, 15, 14, "#c46a57", 24), windowsAround(28, 28, 2, 13, 2, 4, "arch"));
    g.children[0]!.scale.z = 0.82;
    g.add(at(dome(15, "#8a8f94", 0.3), 0, 14, 0));
    const t = tower(7, 28, "#c46a57", { windows: 4, clock: true, clockY: 24 }); t.add(at(G(cyl(2.6, 3.2, 4, "#8a8f94", 8), at(dome(2.6, "#8a8f94", 1), 0, 4, 0)), 0, 28, 0));
    g.add(at(t, 0, 0, 14));
    return g;
  },
  eiserner_steg: () => { // the riveted iron footbridge with its bowed truss
    const L = 80, g = G(at(box(L, 0.6, 4, "#5f6e78"), 0, 4, 0));
    for (const z of [-2, 2]) {
      const pts: THREE.Vector3[] = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector3(-L / 2 + t * L, 5 + Math.sin(t * Math.PI) * 5 * (1 - Math.abs(Math.sin(t * Math.PI * 2)) * 0.25), z)); }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.35, 6), box(1, 1, 1, "#5f6e78").material));
      for (let i = 1; i < 16; i++) g.add(at(box(0.2, Math.sin((i / 16) * Math.PI) * 5, 0.2, "#5f6e78"), -L / 2 + (i / 16) * L, 4.6, z));
    }
    for (const x of [-L / 4, L / 4]) g.add(at(rbox(4, 4, 6, SAND), x, 0, 0));
    return g;
  },
  main_tower: () => { // 200 m: a round glass tower beside a square stone one, the red antenna
    const g = G(at(cyl(10, 10, 86, "#8fb4d0", 24), 0, 0, 0), at(glassTower(16, 16, 60, "#b7a893", "#cfc3ae"), -12, 0, 0));
    for (let y = 4; y < 86; y += 4) g.add(at(cyl(10.1, 10.1, 0.3, "#e8eef3", 24), 0, y, 0));
    g.add(at(cyl(0.4, 0.8, 10, "#e03a3a", 8), 0, 86, 0));
    return g;
  },
  alte_oper: (w, d) => { // Italian renaissance opera house: arched facade, Pegasus on the roof
    const L = clamp(Math.max(w, d), 40, 50), D = clamp(Math.min(w, d), 30, 36);
    const g = G(rbox(L, 16, D, "#d9cbaa", 0.15), windowsAround(L, D, 2, 15, 3, 3.4, "arch"), at(mansard(L, D, 5, "#5b9b86"), 0, 16, 0));
    g.add(at(portico(6, 20, 11, "#e0d3b4"), 0, 3, D / 2 + 1.2), at(G(box(3, 1.8, 1.2, C.copper), at(box(2, 1, 0.3, C.copper), 0, 1.4, 0)), 0, 24, D / 2 - 2));
    return g;
  },
  hauptwache: () => { // small baroque guardhouse: red sandstone, mansard roof
    return G(rbox(18, 6, 10, "#c46a57", 0.15), at(mansard(18, 10, 4, "#4a4d52"), 0, 6, 0), windowRows(15, 1, 5.5, 1, 6, 5.02, "arch"), at(door(2, 3.4), 0, 0, 5.02), at(clock(1), 0, 8, 4.4));
  },
};

// ============================ STUTTGART ============================
const stuttgart: Record<string, Builder> = {
  neues_schloss: (w, d) => { // three-winged baroque palace around the cour d'honneur, crown on the centre
    const L = clamp(Math.max(w, d), 64, 76), D = clamp(Math.min(w, d), 40, 50), st = "#e7dcbf";
    const wing = (l: number, dd: number) => G(rbox(l, 14, dd, st, 0.15), at(mansard(l, dd, 5, "#5b6d78"), 0, 14, 0), windowsAround(l, dd, 1.5, 13, 3, 3, "rect"));
    const g = G(at(wing(L, 12), 0, 0, -D / 2 + 6), at(wing(12, D), -L / 2 + 6, 0, 0), at(wing(12, D), L / 2 - 6, 0, 0));
    g.add(at(G(rbox(16, 17, 14, st), at(dome(5, "#5b6d78", 1.2), 0, 17, 0), at(statue(2, C.gold, C.gold), 0, 22, 0)), 0, 0, -D / 2 + 7));
    g.add(at(fountain(3, 3), 0, 0, D * 0.15));
    return g;
  },
  altes_schloss: (w, d) => { // Renaissance castle: round corner towers with pointed caps, arcaded courtyard
    const L = clamp(Math.max(w, d), 40, 48), D = clamp(Math.min(w, d), 34, 40), st = "#e2d6bc";
    const g = new THREE.Group();
    for (const [x, z, l, dd] of [[0, -D / 2 + 5, L, 10], [0, D / 2 - 5, L, 10], [-L / 2 + 5, 0, 10, D], [L / 2 - 5, 0, 10, D]] as const)
      g.add(at(G(rbox(l, 14, dd, st), at(gable(l, dd, 6, C.roofDark), 0, 14, 0)), x, 0, z, 0));
    g.children[2]!.children[1]!.rotation.y = Math.PI / 2; g.children[3]!.children[1]!.rotation.y = Math.PI / 2;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.add(at(G(cyl(4, 4, 18, st, 16), at(cone(4.6, 9, C.roofDark, 16), 0, 18, 0)), x * (L / 2 - 2), 0, z * (D / 2 - 2)));
    g.add(at(arcade(6, L - 22, 9, 2, "#efe6d3"), 0, 0, -D / 2 + 11));
    return g;
  },
  stiftskirche: (w, d) => { // gothic church, two unequal towers: tall one with an octagonal top, short square one
    const L = clamp(Math.max(w, d), 40, 48), W = clamp(Math.min(w, d), 20, 24), st = "#cfbd96";
    const g = G(gothicNave(W * 0.8, L * 0.85, 16, st, C.roofDark));
    const t1 = tower(8, 30, st, { windows: 4 }); t1.add(at(G(cyl(3.2, 4, 10, st, 8), at(cone(3.4, 8, C.roofDark, 8), 0, 10, 0)), 0, 30, 0));
    const t2 = tower(7, 26, st, { windows: 3 }); t2.add(at(hip(7, 7, 4, C.roofDark), 0, 26, 0));
    g.add(at(t1, -W * 0.25, 0, L * 0.44), at(t2, W * 0.3, 0, -L * 0.2));
    return g;
  },
  schlossplatz: () => { // the square: jubilee column with Concordia, two fountains, lawns
    const g = G(plazaDisc(40, "#e7dcc6"));
    for (const [x, z] of [[-20, 12], [20, 12], [-20, -12], [20, -12]] as const) g.add(at(box(14, 0.2, 10, C.green), x, 0.06, z));
    g.add(at(G(rbox(4, 3, 4, "#dcd3c2"), at(cyl(1.3, 1.5, 24, "#dcd3c2", 12), 0, 3, 0), at(statue(3, C.gold, C.gold), 0, 27, 0)), 0, 0, 0));
    for (const x of [-26, 26]) g.add(at(fountain(3, 2.6), x, 0, 0));
    return g;
  },
  koenigsbau: (w, d) => { // long classical building with a colonnade of 26 columns along the square
    const L = clamp(Math.max(w, d), 70, 90), g = G(rbox(L, 14, 16, "#e8dfcb", 0.1), windowRows(L * 0.9, 9, 13.5, 1, 26, 8.02));
    for (let i = 0; i < 26; i++) g.add(at(cyl(0.55, 0.6, 8, C.white, 12), -L / 2 + 1.5 + (i * (L - 3)) / 25, 0, 9.6));
    g.add(at(box(L, 1, 3, "#e8dfcb"), 0, 8, 9.4));
    return g;
  },
  opernhaus: (w, d) => { // classical opera house with a portico, by the lake
    const L = clamp(Math.max(w, d), 44, 52), D = clamp(Math.min(w, d), 30, 36);
    const g = G(rbox(L, 15, D, "#e6dcc4", 0.15), windowsAround(L, D, 2, 14, 2, 3.4, "arch"), at(hip(L, D, 5, "#5b6d78"), 0, 15, 0), at(portico(6, 18, 11), 0, 0, D / 2 + 1.2));
    g.add(at(cyl(14, 14, 0.2, "#4d9fd3", 24), 0, 0.05, D / 2 + 22));
    return g;
  },
  bahnhofsturm: () => { // square station tower with the turning Mercedes star on top
    const t = tower(12, 26, "#cbc2ae", { windows: 5, clock: true, clockY: 21 });
    const star = new THREE.Group();
    star.add(new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 8, 28), box(1, 1, 1, "#dde3e8").material));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; star.add(at(box(0.4, 3, 0.3, "#dde3e8"), Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0, 0)); star.children.at(-1)!.rotation.z = a - Math.PI / 2; }
    t.add(at(G(cyl(0.3, 0.3, 3, "#dde3e8", 6), at(star, 0, 6, 0)), 0, 26, 0));
    return G(t, at(G(rbox(40, 10, 16, "#cbc2ae"), windowRows(36, 1, 9.5, 2, 12, 8.02)), 20, 0, 0));
  },
};

// ============================ DÜSSELDORF ============================
const duesseldorf: Record<string, Builder> = {
  rheinturm: () => tvTower(78, "disc", "#d9dcdf"),
  schlossturm: () => { // the castle tower with a baroque cap, now the shipping museum
    const t = tower(9, 18, "#e6dfcf", { windows: 3 });
    t.add(at(G(cyl(3.6, 4.6, 4, C.roofDark, 8), at(onion(2.6, C.roofDark), 0, 4, 0)), 0, 18, 0));
    return G(t);
  },
  rathaus: (w, d) => { // renaissance town hall with a tower, the Jan Wellem statue on his horse in front
    const L = clamp(Math.max(w, d), 34, 44), D = clamp(Math.min(w, d), 16, 22);
    const g = G(rbox(L, 12, D, "#d8cdb4", 0.15), at(gable(L, D, 5, C.roofDark), 0, 12, 0), windowsAround(L, D, 1.5, 11, 3, 3, "rect"));
    const t = tower(6, 22, "#d8cdb4", { windows: 3, clock: true, clockY: 18 }); t.add(at(onion(3, C.roofDark), 0, 22, 0));
    g.add(at(t, L * 0.3, 0, 0));
    const horse = G(box(1.6, 2.6, 5, "#39413f"), at(box(1.2, 2, 1.4, "#39413f"), 0, 2, 2.4));
    g.add(at(G(rbox(4, 6, 6, "#bdb3a1"), at(G(horse, at(statue(2, "#39413f", "#39413f"), 0, 2.4, 0)), 0, 8.4, 0)), 0, 0, D / 2 + 12));
    return g;
  },
  koenigsallee: () => { // the Kö: a canal lined with chestnut trees, the Triton fountain, shops
    const g = G(at(box(10, 0.3, 90, "#4d9fd3"), 0, -0.1, 0), at(G(fountain(2, 2), at(statue(2.4, C.copper, C.copper), 0, 2, 0)), 0, 0, -40));
    for (const x of [-8, 8]) for (let i = 0; i < 9; i++) g.add(at(lollipop(6), x, 0, -40 + i * 10));
    for (let i = 0; i < 6; i++) g.add(at(toyHouse(12, 8, 4, [C.cream, C.white, C.sand, C.cream, C.plaster, C.white][i]!, C.roofDark), 22, 0, -38 + i * 15, -Math.PI / 2));
    return g;
  },
  lambertus: (w, d) => { // gothic brick hall church with the famous twisted spire
    const L = clamp(Math.max(w, d), 32, 40), W = clamp(Math.min(w, d), 18, 24);
    const g = G(gothicNave(W * 0.8, L * 0.8, 14, "#a8574a", C.roofDark));
    const t = tower(7, 24, "#a8574a", { windows: 3 });
    const sp = spire(4, 22, "#4a4d52"); sp.rotation.y = 0.5; sp.scale.x = 0.9; t.add(at(sp, 0.4, 24, 0));
    g.add(at(t, 0, 0, L * 0.42));
    return g;
  },
  bolkerstrasse: () => { // old town lane of little pubs with tables outside ("the longest bar in the world")
    const g = new THREE.Group(), walls = [C.cream, C.rose, C.ochre, C.white, C.sky, C.salmon];
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) g.add(at(toyHouse(7, 8, 3, walls[(i + (s > 0 ? 3 : 0)) % 6]!, C.roofDark, i % 3 === 0), -18 + i * 7.2, 0, s * 8, s > 0 ? Math.PI : 0));
    for (let i = 0; i < 8; i++) g.add(at(G(cyl(0.7, 0.7, 1, C.timber, 10), at(cyl(1.6, 0.05, 1.2, i % 2 ? "#c83a3a" : C.white, 8), 0, 2.4, 0), at(cyl(0.06, 0.06, 2.4, C.timber, 5), 0, 0, 0)), -18 + i * 5, 0, (i % 2 ? 1 : -1) * 2.6));
    return g;
  },
  rheinufer: () => { // the stepped riverside promenade with benches and plane trees
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) g.add(at(box(90, 0.5, 3, "#d8cdb4"), 0, -i * 0.5, i * 3));
    for (let i = 0; i < 9; i++) g.add(at(lollipop(6), -40 + i * 10, 0, -6), at(box(3, 0.6, 1, C.timber), -35 + i * 10, 0, -2));
    return g;
  },
};

// ============================ DRESDEN ============================
const dresden: Record<string, Builder> = {
  frauenkirche: () => { // the stone bell: square base, corner stair towers, the great dome with its lantern
    const st = "#d8c9a4", g = G(rbox(40, 20, 44, st, 0.4), windowsAround(40, 44, 2, 19, 2, 4.5, "arch"));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) g.add(at(G(cyl(2.4, 2.4, 26, st, 12), at(G(cyl(1.8, 2.2, 4, st, 10), at(dome(1.8, st, 1.6), 0, 4, 0)), 0, 26, 0)), x * 17, 0, z * 19));
    const bell = new THREE.LatheGeometry([new THREE.Vector2(15, 0), new THREE.Vector2(15.5, 6), new THREE.Vector2(13, 16), new THREE.Vector2(8, 24), new THREE.Vector2(6, 27), new THREE.Vector2(0, 27)], 32);
    g.add(at(new THREE.Mesh(bell, rbox(1, 1, 1, st).material), 0, 20, 0));
    g.add(at(G(cyl(4, 4.6, 7, st, 12), at(dome(3.6, st, 1.2), 0, 7, 0), at(cyl(0.3, 0.3, 4, C.gold, 6), 0, 11, 0), at(box(1.6, 0.25, 0.25, C.gold), 0, 14, 0)), 0, 47, 0));
    return g;
  },
  zwinger: () => { // baroque courtyard: galleries around, the Crown Gate with its gold crown, the Wall Pavilion
    const st = "#e3d3aa", g = new THREE.Group(), W = 70, D = 44;
    for (const [x, z, l, r] of [[0, -D / 2, W, 0], [0, D / 2, W, 0], [-W / 2, 0, D, Math.PI / 2], [W / 2, 0, D, Math.PI / 2]] as const)
      g.add(at(G(arcade(Math.round(l / 6), l, 7, 5, st), at(balustrade(l, 1, st), 0, 7, 0)), x, 0, z, r));
    const gate = G(rbox(12, 14, 8, st), at(archWindow(4, 8), 0, 0, 4.02), at(dome(4.6, C.copper, 1.4), 0, 14, 0), at(G(cyl(1.2, 1.2, 1, C.gold, 12), at(sphere(1.4, C.gold), 0, 1.6, 0)), 0, 20, 0));
    g.add(at(gate, 0, 0, D / 2), at(G(rbox(14, 12, 10, st), at(dome(5, C.copper, 0.8), 0, 12, 0), at(statue(2.4, st, st), 0, 16, 0)), -W / 2, 0, 0, Math.PI / 2));
    for (const [x, z] of [[-18, 0], [18, 0]] as const) g.add(at(fountain(3, 2), x, 0, z));
    g.add(at(box(W - 10, 0.1, D - 10, C.green), 0, 0.05, 0));
    return g;
  },
  semperoper: (w, d) => { // curved front, two storeys of arches, the panther quadriga on the entrance
    const st = "#d8c9a4", g = new THREE.Group();
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 20, 32, 1, false, -Math.PI * 0.35, Math.PI * 0.7), rbox(1, 1, 1, st).material);
    g.add(at(curve, 0, 10, -8), at(rbox(40, 22, 30, st, 0.2), 0, 0, -20), at(dome(12, C.copper, 0.35), 0, 22, -20));
    g.add(at(G(rbox(14, 26, 6, st), at(archWindow(6, 16), 0, 4, 3.02), at(G(box(4, 2, 2, C.copper), at(statue(2.2, C.copper, C.copper), 0, 2, 0)), 0, 26, 0)), 0, 0, 16));
    return g;
  },
  residenzschloss: (w, d) => { // Renaissance palace around courtyards, the tall Hausmann tower with a baroque cap
    const L = clamp(Math.max(w, d), 60, 80), D = clamp(Math.min(w, d), 40, 60), st = "#bdb2a0";
    const g = G(rbox(L, 16, D, st, 0.15), windowsAround(L, D, 2, 15, 3, 3.2, "rect"), at(hip(L, D, 6, "#4a4d52"), 0, 16, 0));
    const t = tower(9, 38, st, { windows: 5, clock: true, clockY: 32 });
    t.add(at(G(cyl(3.4, 4.2, 5, "#4a4d52", 8), at(onion(3, "#4a4d52"), 0, 5, 0), at(spire(1, 6, C.gold), 0, 10, 0)), 0, 38, 0));
    g.add(at(t, -L * 0.2, 0, D * 0.2));
    return g;
  },
  hofkirche: (w, d) => { // baroque church with a tall openwork tower and saints on the balustrade
    const L = clamp(Math.max(w, d), 46, 56), W = clamp(Math.min(w, d), 26, 32), st = "#dccda8";
    const g = G(roundNave(W, L * 0.8, 16, st, C.copper), at(balustrade(L * 0.8, 1.2, st), W / 2 - 0.5, 16, 0, Math.PI / 2), at(balustrade(L * 0.8, 1.2, st), -W / 2 + 0.5, 16, 0, Math.PI / 2));
    for (let i = 0; i < 8; i++) for (const x of [-1, 1]) g.add(at(statue(1.8, st, st), x * (W / 2 - 0.5), 17, -L * 0.35 + i * L * 0.1));
    const t = tower(9, 30, st, { windows: 4, clock: true, clockY: 26 });
    t.add(at(G(cyl(3.6, 4.4, 10, st, 8), at(cyl(2.6, 3.4, 8, st, 8), 0, 10, 0), at(onion(2.2, C.copper), 0, 18, 0)), 0, 30, 0));
    g.add(at(t, 0, 0, L * 0.45));
    return g;
  },
  bruehlsche_terrasse: () => { // the terrace high over the Elbe: a long wall, a stair with gilded statues, trees
    const g = G(rbox(90, 7, 16, "#bdb2a0", 0.1), at(balustrade(90, 1, "#dcd3c2"), 0, 7, 8));
    for (let i = 0; i < 9; i++) g.add(at(lollipop(5), -40 + i * 10, 7, -2));
    for (let i = 0; i < 7; i++) g.add(at(box(12, 1, 1.4, "#dcd3c2"), -30, i * 1, 8 + i * 1.3));
    for (const x of [-36, -24]) g.add(at(statue(2.6, C.gold, "#dcd3c2"), x, 7, 9));
    return g;
  },
  fuerstenzug: () => { // the 100 m long wall of porcelain tiles with the parade of princes on horseback
    const g = G(rbox(100, 10, 3, "#bdb2a0", 0.1), at(box(98, 7, 0.2, "#e9eef4"), 0, 1.5, 1.6));
    for (let i = 0; i < 24; i++) g.add(at(G(box(1.2, 1.4, 0.2, "#3f6fb5"), at(box(0.6, 1.2, 0.2, "#3f6fb5"), 0.2, 1.4, 0)), -46 + i * 4, 3, 1.75));
    return g;
  },
};

// ============================ LEIPZIG ============================
const leipzig: Record<string, Builder> = {
  altes_rathaus: (w, d) => { // long Renaissance town hall, arcade, dormer gables, the off-centre tower
    const L = clamp(Math.max(w, d), 80, 94), D = 14, g = G(rbox(L, 11, D, "#efe6cf", 0.1), at(gable(L, D, 7, C.roof), 0, 11, 0), arcade(16, L, 4.5, 3, "#efe6cf"));
    for (let i = 0; i < 6; i++) g.add(at(G(box(5, 5, 1, "#efe6cf"), at(steppedGable(5, 3, 3, "#efe6cf"), 0, 5, 0)), -L / 2 + 8 + i * ((L - 16) / 5), 11, D / 2 - 0.5));
    const t = tower(6, 20, "#efe6cf", { windows: 3, clock: true, clockY: 16 }); t.add(at(G(cyl(2.4, 3, 4, C.copper, 8), at(onion(2.2, C.copper), 0, 4, 0)), 0, 20, 0));
    g.add(at(t, -L * 0.08, 0, D / 2 + 1), windowRows(L * 0.94, 5, 10.5, 2, 30, D / 2 + 0.02));
    return g;
  },
  thomaskirche: (w, d) => { // gothic hall church, the steep roof, the tower with a baroque cap; Bach in front
    const L = clamp(Math.max(w, d), 40, 50), W = clamp(Math.min(w, d), 22, 26);
    const g = G(gothicNave(W * 0.8, L * 0.85, 14, "#e5dbc4", C.roofDark));
    const t = tower(7, 26, "#e5dbc4", { windows: 4, clock: true, clockY: 22 }); t.add(at(G(cyl(3, 3.6, 5, C.copper, 8), at(onion(2.4, C.copper), 0, 5, 0)), 0, 26, 0));
    g.add(at(t, 0, 0, L * 0.44), at(statue(3, "#39413f", "#bdb3a1"), W * 0.6, 0, L * 0.3));
    return g;
  },
  nikolaikirche: (w, d) => { // romanesque-gothic church with a central tower and two smaller ones
    const L = clamp(Math.max(w, d), 40, 48), W = clamp(Math.min(w, d), 24, 28), st = "#dcd0b4";
    const g = G(gothicNave(W * 0.8, L * 0.8, 14, st, C.roofDark));
    const t = tower(8, 30, st, { windows: 4 }); t.add(at(G(cyl(3.2, 3.8, 6, "#5b9b86", 8), at(spire(2.4, 8, "#5b9b86"), 0, 6, 0)), 0, 30, 0));
    g.add(at(t, 0, 0, L * 0.42));
    for (const x of [-1, 1]) g.add(at(G(tower(3.4, 18, st, { windows: 2 }), at(spire(2.2, 6, "#5b9b86"), 0, 18, 0)), x * (W * 0.4), 0, L * 0.32));
    return g;
  },
  city_hochhaus: () => { // 142 m, a tower with a curved top like an open book
    const g = G(glassTower(16, 22, 58, "#c7ccd1", "#e5e8eb"));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 16, 24, 1, false, 0, Math.PI), box(1, 1, 1, "#d8dde2").material);
    top.rotation.z = Math.PI / 2; g.add(at(top, 0, 58, 0), at(cyl(0.3, 0.3, 8, "#e03a3a", 6), 0, 65, 0));
    return g;
  },
  gewandhaus: (w, d) => { // modern concert hall: glass front showing the big ceiling painting
    const L = clamp(Math.max(w, d), 50, 60), D = clamp(Math.min(w, d), 34, 40);
    const g = G(rbox(L, 18, D, "#c9c2b6", 0.2), at(box(L * 0.8, 16, 0.6, "#bcd7ea"), 0, 1, D / 2 + 0.3), at(box(L * 0.6, 8, 0.3, "#e3a24b"), 0, 7, D / 2 + 0.7));
    g.add(at(hip(L, D, 3, "#8a8f94"), 0, 18, 0), at(fountain(4, 2.4), 0, 0, D / 2 + 16));
    return g;
  },
  maedlerpassage: (w, d) => { // glass-roofed shopping arcade, Faust and Mephisto at the entrance of Auerbachs Keller
    const L = clamp(Math.max(w, d), 40, 60), g = G(rbox(L, 16, 20, "#ebdcc0", 0.1), windowsAround(L, 20, 2, 15, 3, 3, "arch"));
    g.add(at(G(barrel(4, L, "#bcd7ea")), 0, 16, 0, Math.PI / 2), at(archWindow(3, 6), 0, 0, 10.02));
    for (const x of [-4, 4]) g.add(at(statue(2.2, "#39413f", "#bdb3a1"), x, 0, 12));
    return g;
  },
  hauptbahnhof: (w, d) => { // the huge station front with two big entrance halls
    const L = clamp(Math.max(w, d), 100, 130), g = G(rbox(L, 16, 20, "#d8cdb4", 0.1), windowRows(L * 0.9, 2, 15, 3, 36, 10.02), at(hip(L, 20, 3, "#8a8f94"), 0, 16, 0));
    for (const x of [-1, 1]) g.add(at(G(rbox(20, 24, 22, "#d8cdb4"), at(archWindow(10, 16), 0, 2, 11.02), at(hip(20, 22, 4, "#8a8f94"), 0, 24, 0), at(clock(1.6), 0, 20, 11.1)), x * L * 0.3, 0, 0));
    for (let i = 0; i < 6; i++) g.add(at(barrel(9, 60, "#9aa3a8"), -L / 2 + 10 + i * ((L - 20) / 5), 8, -40));
    return g;
  },
};

// ============================ HANNOVER ============================
const hannover: Record<string, Builder> = {
  neues_rathaus: (w, d) => { // the palace-like town hall, the big green dome (97 m) with a lantern
    const L = clamp(Math.max(w, d), 80, 100), D = clamp(Math.min(w, d), 40, 50), st = "#d8c9a4";
    const g = G(rbox(L, 20, D, st, 0.2), windowsAround(L, D, 2, 19, 4, 3.4, "arch"), at(hip(L, D, 5, "#5b9b86"), 0, 20, 0));
    g.add(at(G(rbox(24, 12, 24, st), at(cyl(9, 10, 8, st, 16), 0, 12, 0), at(dome(10, "#5b9b86", 1.1), 0, 20, 0), at(G(cyl(1.8, 2.2, 6, st, 10), at(dome(2, "#5b9b86", 1.3), 0, 6, 0)), 0, 30, 0)), 0, 20, 0));
    for (const x of [-1, 1]) g.add(at(G(tower(6, 28, st, { windows: 4 }), at(dome(3.2, "#5b9b86", 1.2), 0, 28, 0)), x * (L / 2 - 6), 0, D / 2 - 5));
    g.add(at(portico(6, 22, 12, "#e6dcc4"), 0, 0, D / 2 + 1.2), at(cyl(26, 26, 0.2, "#4d9fd3", 24), 0, 0.05, -D / 2 - 30));
    return g;
  },
  marktkirche: (w, d) => { // brick gothic hall church, tall square tower with a pointed roof and four small spires
    const L = clamp(Math.max(w, d), 40, 48), W = clamp(Math.min(w, d), 22, 28);
    const g = G(gothicNave(W * 0.8, L * 0.8, 15, BRICK, C.roofDark));
    const t = tower(11, 36, BRICK, { windows: 5, clock: true, clockY: 30 });
    const roof = cone(8, 14, C.roofDark, 4); roof.rotation.y = Math.PI / 4; t.add(at(roof, 0, 36, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) t.add(at(spire(0.9, 7, C.roofDark), x * 4.8, 36, z * 4.8));
    g.add(at(t, 0, 0, L * 0.44));
    return g;
  },
  altes_rathaus: (w, d) => { // brick gothic with pointed stepped gables and a frieze
    const L = clamp(Math.max(w, d), 30, 40), D = clamp(Math.min(w, d), 12, 16);
    const g = G(rbox(L, 11, D, BRICK, 0.1), windowRows(L * 0.9, 1, 10.5, 2, 10, D / 2 + 0.02, "gothic"), at(gable(L, D, 8, C.roofDark), 0, 11, 0));
    for (const x of [-1, 1]) g.add(at(steppedGable(D, 10, 6, BRICK), x * L / 2, 11, 0, Math.PI / 2));
    for (let i = 0; i < 3; i++) g.add(at(steppedGable(6, 5, 3, BRICK), -L / 3 + i * L / 3, 11, D / 2));
    return g;
  },
  leineschloss: (w, d) => { // the classical palace by the river: six-column portico
    const L = clamp(Math.max(w, d), 50, 70), D = clamp(Math.min(w, d), 24, 30);
    return G(rbox(L, 15, D, "#e8dfcb", 0.15), windowsAround(L, D, 2, 14, 3, 3.2, "rect"), at(hip(L, D, 4, "#8a8f94"), 0, 15, 0), at(portico(6, 20, 13), 0, 0, D / 2 + 1.2));
  },
  nanas: () => { // three big, round, colourful dancing women (Niki de Saint Phalle)
    const g = new THREE.Group(), cols: [string, string, string][] = [["#e2463c", "#2a6fd6", "#f2c230"], ["#f2c230", "#e2463c", "#2fa85a"], ["#2a6fd6", "#ea8fb5", "#f2c230"]];
    cols.forEach(([a, b, c], i) => {
      const n = G(at(sphere(2.4, a), 0, 3.4, 0), at(sphere(2, b), 0, 6.6, 0), at(sphere(1, "#6b3b22"), 0, 9, 0));
      for (const s of [-1, 1]) n.add(at(cyl(0.6, 0.7, 3.4, c, 10), s * 1.3, 0, 0), at(cyl(0.45, 0.5, 3.6, c, 10), s * 2.6, 7.6, 0));
      n.children.slice(-2).forEach((arm) => (arm.rotation.z = (i % 2 ? 1 : -1) * 0.7));
      g.add(at(n, -9 + i * 9, 0, 0, i * 0.5));
    });
    return g;
  },
  aegidienkirche: (w, d) => { // the roofless ruin with its tower, left open as a peace memorial
    const L = clamp(Math.max(w, d), 30, 36), W = clamp(Math.min(w, d), 18, 22), st = "#c9bba0", g = new THREE.Group();
    for (const x of [-1, 1]) g.add(at(G(box(1.2, 12, L * 0.8, st)), x * W / 2, 0, 0));
    g.add(at(box(W, 12, 1.2, st), 0, 0, -L * 0.4));
    for (let i = 0; i < 4; i++) for (const x of [-1, 1]) { const w2 = gothicWindow(1.4, 7); w2.position.set(x * (W / 2 + 0.62), 4, -L * 0.3 + i * L * 0.2); w2.rotation.y = x * Math.PI / 2; g.add(w2); }
    const t = tower(7, 26, st, { windows: 3 }); t.add(at(G(cyl(2.6, 3.2, 4, C.copper, 8), at(onion(2.2, C.copper), 0, 4, 0)), 0, 26, 0));
    g.add(at(t, 0, 0, L * 0.45), at(box(W - 2, 0.1, L * 0.8 - 2, C.green), 0, 0.05, 0));
    return g;
  },
  opernhaus: (w, d) => { // classical opera house with a columned porch and a green roof
    const L = clamp(Math.max(w, d), 50, 60), D = clamp(Math.min(w, d), 34, 40);
    return G(rbox(L, 16, D, "#e2d6bc", 0.15), windowsAround(L, D, 2, 15, 3, 3.4, "arch"), at(hip(L, D, 5, "#5b9b86"), 0, 16, 0), at(portico(8, 26, 12), 0, 0, D / 2 + 1.2));
  },
};

// ============================ BREMEN ============================
const bremen: Record<string, Builder> = {
  rathaus: (w, d) => { // gothic hall with the rich Weser Renaissance front: arcade, big central gable, statues
    const L = clamp(Math.max(w, d), 40, 44), D = clamp(Math.min(w, d), 16, 20), st = "#8c6b54";
    const g = G(rbox(L, 14, D, st, 0.1), at(gable(L, D, 9, "#5b9b86"), 0, 14, 0), windowRows(L * 0.9, 6, 13.5, 2, 11, D / 2 + 0.02, "gothic"));
    g.add(at(arcade(11, L, 5, 3, "#d8c9a4"), 0, 0, D / 2 + 1.5), at(balustrade(L, 1, "#d8c9a4"), 0, 5, D / 2 + 3));
    g.add(at(G(box(12, 8, 2, "#d8c9a4"), at(steppedGable(12, 8, 5, "#d8c9a4"), 0, 8, 0), windowRows(10, 1, 7.5, 2, 3, 1.02, "arch")), 0, 14, D / 2 - 1));
    for (let i = 0; i < 8; i++) g.add(at(statue(1.6, "#d8c9a4", "#d8c9a4"), -L / 2 + 3 + i * ((L - 6) / 7), 5.4, D / 2 + 3));
    return g;
  },
  roland: () => { // the 10 m stone knight with sword and eagle shield, under a little canopy
    const g = G(rbox(3.4, 1.6, 3.4, "#bdb3a1"), at(G(box(1.6, 5, 1.2, "#cfc6b3"), at(sphere(0.8, "#cfc6b3"), 0, 5.6, 0)), 0, 1.6, 0));
    g.add(at(box(0.3, 4.4, 0.2, "#9aa3a8"), 0.9, 3, 0.8), at(box(1.4, 1.8, 0.2, "#e2c14b"), -0.5, 3.6, 0.72));
    g.add(at(G(box(2.4, 0.4, 2.4, "#bdb3a1"), at(cone(1.6, 2.4, "#bdb3a1", 4), 0, 0.4, 0)), 0, 8.2, 0));
    return g;
  },
  dom: (w, d) => { // brick cathedral with two tall green spires
    const L = clamp(Math.max(w, d), 46, 56), W = clamp(Math.min(w, d), 24, 30);
    const g = G(gothicNave(W * 0.8, L * 0.8, 17, "#a45a47", "#5b9b86"));
    for (const s of [-1, 1]) { const t = tower(7, 34, "#a45a47", { windows: 5 }); t.add(at(spire(4.4, 13, "#5b9b86"), 0, 34, 0)); g.add(at(t, s * (W * 0.3), 0, L * 0.44)); }
    g.add(at(roseWindow(3, "#5b3a2e"), 0, 16, L * 0.47));
    return g;
  },
  stadtmusikanten: () => { // bronze donkey, dog, cat and rooster stacked up, on a little plinth
    const br = "#5a5245", g = G(rbox(3, 0.8, 2, "#bdb3a1"));
    const donkey = G(box(1.2, 1.4, 2.8, br), at(box(0.8, 1, 1.2, br), 0, 1, 1.6)); for (const x of [-0.4, 0.4]) for (const z of [-1, 1]) donkey.add(at(box(0.3, 1.6, 0.3, "#c9a24b"), x, -1.6, z)); // the shiny, touched legs
    const dog = G(box(0.9, 0.9, 1.8, br), at(box(0.6, 0.6, 0.7, br), 0, 0.6, 1));
    const cat = G(box(0.6, 0.8, 1, br), at(sphere(0.4, br), 0, 0.8, 0.4));
    const rooster = G(box(0.4, 0.6, 0.6, br), at(box(0.2, 0.4, 0.2, "#c83a3a"), 0, 0.6, 0.2));
    g.add(at(donkey, 0, 2.4, 0), at(dog, 0, 3.8, 0), at(cat, 0, 5.1, 0), at(rooster, 0, 6.3, 0));
    return g;
  },
  boettcherstrasse: () => { // expressionist red-brick lane: the golden Light Bringer relief at the entrance, the carillon
    const g = new THREE.Group();
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) g.add(at(G(rbox(10, 14, 8, BRICK_DARK, 0.1), windowRows(8, 1, 13, 4, 3, 4.02, "arch"), at(steppedGable(8, 4, 3, BRICK_DARK), 0, 14, 4)), -12 + i * 12, 0, s * 7, s > 0 ? Math.PI : 0));
    g.add(at(box(6, 6, 0.4, C.gold), -18, 5, 0, Math.PI / 2));
    for (let i = 0; i < 10; i++) g.add(at(cyl(0.3, 0.45, 0.6, "#f4f1ea", 8), -3 + (i % 5) * 1.4, 12 + Math.floor(i / 5) * 1.2, 3.2)); // porcelain bells
    return g;
  },
  schnoor: () => { // the oldest quarter: tiny crooked houses along a narrow lane
    const g = new THREE.Group(), walls = [C.cream, C.rose, C.sky, C.yellow, C.mint, C.white, C.salmon];
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) g.add(at(toyHouse(5, 5.4, 2, walls[(i + (s > 0 ? 3 : 0)) % 7]!, i % 2 ? C.roof : C.roofDark, i % 3 === 0), -18 + i * 6, 0, s * 4.8, (s > 0 ? Math.PI : 0) + (i % 3 - 1) * 0.06));
    return g;
  },
  schuetting: (w, d) => { // the merchants' guild house: Flemish Renaissance front with a big ornate gable
    const L = clamp(Math.max(w, d), 26, 32), D = 14;
    return G(rbox(L, 12, D, "#c9b48a", 0.1), windowRows(L * 0.9, 1, 11.5, 3, 8, D / 2 + 0.02), at(gable(L, D, 7, C.roofDark), 0, 12, 0), at(steppedGable(12, 9, 5, "#c9b48a"), 0, 12, D / 2), at(door(2.4, 4), 0, 0, D / 2 + 0.02));
  },
};

export const LANDMARK_MODELS_DE: Record<string, Record<string, Builder>> = { berlin, hamburg, koeln, frankfurt, stuttgart, duesseldorf, dresden, leipzig, hannover, bremen };
