// Detailed toy models of every collectable landmark, built from toykit parts after reference photos (Wikipedia /
// Wikimedia Commons, looked at 2026-09-30). Units: 1 ≈ 2.2 m. +z is the main facade, the origin is the footprint
// centre on the ground. Each builder gets the real footprint's oriented size (w along the facade, d deep) when the map
// has one, so the model fills the real outline; heights follow the real buildings (a little exaggerated, toy-style).
import * as THREE from "three";
import {
  C, mat, rbox, box, cyl, cone, sphere, at, gable, hip, steppedGable, spire, onion, haube, dome, tower, clock,
  window_, archWindow, gothicWindow, roseWindow, windowRows, windowsAround, door, arcade, timberBox, statue, lion,
  fountain, balustrade, battlements, flag, flowerBox, stoneBridge,
} from "./toykit";

type Builder = (w: number, d: number) => THREE.Group;
const G = (...o: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...o); return g; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------- shared pieces ----------
/** A gothic hall church: nave with steep roof, buttresses, pointed windows. Front (west) at +z. */
function gothicNave(w: number, d: number, wallH: number, wall: string, roof: string): THREE.Group {
  const g = G(rbox(w, wallH, d, wall, 0.15), at(gable(d, w, wallH * 0.75, roof), 0, wallH, 0));
  g.children[1]!.rotation.y = Math.PI / 2;
  for (const side of [-1, 1]) {
    const n = Math.max(3, Math.round(d / 3.2));
    for (let i = 0; i < n; i++) {
      const z = -d / 2 + (d * (i + 0.5)) / n;
      const win = gothicWindow(1.1, wallH * 0.62); win.position.set(side * (w / 2 + 0.02), wallH * 0.5, z); win.rotation.y = side * Math.PI / 2; g.add(win);
      if (i < n - 1) g.add(at(rbox(0.6, wallH * 0.85, 0.7, wall, 0.08), side * (w / 2 + 0.25), 0, -d / 2 + (d * (i + 1)) / n));
    }
  }
  return g;
}
/** A romanesque/baroque church body with round windows. */
function roundNave(w: number, d: number, wallH: number, wall: string, roof: string): THREE.Group {
  const g = G(rbox(w, wallH, d, wall, 0.15));
  const r = gable(d, w, wallH * 0.6, roof); r.rotation.y = Math.PI / 2; g.add(at(r, 0, wallH, 0));
  for (const side of [-1, 1]) {
    const n = Math.max(3, Math.round(d / 3.4));
    for (let i = 0; i < n; i++) {
      const win = archWindow(1.0, wallH * 0.45); win.position.set(side * (w / 2 + 0.02), wallH * 0.55, -d / 2 + (d * (i + 0.5)) / n); win.rotation.y = side * Math.PI / 2; g.add(win);
    }
  }
  return g;
}
/** Baroque tower with onion (or haube) top; returns group, total height ~ h + cap. */
function baroqueTower(w: number, h: number, color: string, cap: "onion" | "haube" | "spire" | "pyramid" = "onion", capColor = C.copper): THREE.Group {
  const g = tower(w, h, color, { clock: true });
  if (cap === "onion") g.add(at(onion(w * 0.55, capColor), 0, h, 0));
  else if (cap === "haube") g.add(at(haube(w * 0.55, capColor), 0, h, 0));
  else if (cap === "spire") g.add(at(spire(w * 0.62, w * 2.6, capColor), 0, h, 0));
  else { const p = cone(w * 0.75, w * 1.1, capColor, 4); p.rotation.y = Math.PI / 4; g.add(at(p, 0, h, 0)); }
  return g;
}
/** Simple pastel house with gable roof and windows -- used in rows (Klein Venedig, Fuggerei, Rothenburg). */
export function toyHouse(w: number, d: number, floors: number, wall: string, roof: string, timber = false): THREE.Group {
  const h = floors * 2.6; // door 2.4 > a 2-unit person
  const body = timber ? timberBox(w, h, d, wall) : rbox(w, h, d, wall, 0.14);
  const g = G(body, at(gable(w, d, Math.min(3.2, d * 0.55), roof), 0, h, 0));
  g.add(windowRows(w * 0.82, 0.6, h - 0.2, floors, Math.max(1, Math.round(w / 1.8)), d / 2 + 0.01));
  g.add(at(door(1.3, 2.4), w * 0.22, 0, d / 2 + 0.01));
  return g;
}
function market(n: number, spread: number, roof: string): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = spread * (0.35 + 0.5 * ((i * 7) % 5) / 5);
    const stall = G(box(2.2, 1.0, 1.4, C.timber), at(gable(2.4, 1.8, 0.8, i % 2 ? roof : C.white, 0.2), 0, 1.6, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) stall.add(at(cyl(0.06, 0.06, 1.6, C.timber, 5), x * 1.05, 0, z * 0.7));
    g.add(at(stall, Math.cos(a) * r, 0, Math.sin(a) * r, -a));
  }
  return g;
}
function plazaDisc(r: number, color = "#e7dcc6"): THREE.Mesh {
  const m = cyl(r, r, 0.12, color, 28);
  m.receiveShadow = true;
  return m;
}
function lollipop(h = 3): THREE.Group {
  return G(cyl(0.18, 0.24, h * 0.5, "#8a5a3c", 6), at(sphere(h * 0.32, C.green), 0, h * 0.35, 0));
}

// ============================ BAMBERG ============================
const bamberg: Record<string, Builder> = {
  rathaus: (w, d) => { // on its island in the Regnitz: baroque body with frescoes, gate tower, half-timbered Rottmeisterhaus
    const L = clamp(w, 14, 22), D = clamp(d, 6, 9);
    const g = new THREE.Group();
    g.add(at(rbox(L + 3, 1.6, D + 2.5, C.sandstone, 0.2), 0, -1.2, 0)); // island pier
    const body = rbox(L * 0.62, 7, D, "#f3d6b7"); g.add(at(body, -L * 0.1, 0.4, 0));
    for (const s of [1, -1]) { // painted facades: pastel fresco panels
      for (let i = 0; i < 4; i++) g.add(at(box(1.6, 2.2, 0.06, i % 2 ? "#e8b39a" : "#b9d1c6"), -L * 0.1 - L * 0.24 + i * 2.2, 2.4, s * (D / 2 + 0.03)));
      const wr = windowRows(L * 0.55, 1.2, 7.2, 2, 5, D / 2 + 0.05, "arch"); wr.rotation.y = s > 0 ? 0 : Math.PI; wr.position.x = -L * 0.1; g.add(wr);
    }
    const roof = gable(L * 0.62, D, 3.2, C.roof); g.add(at(roof, -L * 0.1, 7.4, 0));
    const t = baroqueTower(4.2, 12, "#f3d6b7", "onion", C.slate); g.add(at(t, L * 0.22, 0.4, 0));
    g.add(at(box(2.4, 3.2, D + 0.6, "#3b312a"), L * 0.22, 0.4, 0)); // gate through the tower
    const rott = G(at(timberBox(L * 0.26, 4.2, D * 0.9), 0, 3.2, 0), at(rbox(L * 0.26, 3.2, D * 0.9, C.sandstone), 0, 0, 0), at(gable(L * 0.26, D * 0.9, 2.6, C.roof), 0, 7.4, 0));
    g.add(at(rott, L * 0.45, 0.4, 0));
    for (const s of [-1, 1]) { // the bridge through the tower
      const br = stoneBridge(12, 3.2, 1.4, 2); br.rotation.y = Math.PI / 2; g.add(at(br, L * 0.22, -0.9, s * (D / 2 + 6)));
    }
    return g;
  },
  dom: (w, d) => { // romanesque cathedral, four towers with green needle spires
    const L = clamp(Math.max(w, d), 30, 45), W = clamp(Math.min(w, d), 10, 14);
    const g = new THREE.Group();
    const nave = roundNave(W * 0.7, L * 0.72, 11, C.sandstone, C.slate); nave.rotation.y = Math.PI / 2; g.add(nave);
    for (const ex of [-1, 1]) for (const s of [-1, 1]) {
      const t = tower(3.6, 24, C.sandstone, { windows: 5 });
      t.add(at(spire(2.7, 10, C.copper), 0, 24, 0));
      g.add(at(t, ex * L * 0.4, 0, s * W * 0.32));
    }
    for (const ex of [-1, 1]) g.add(at(rbox(4.6, 12, W * 0.64, C.sandstone), ex * L * 0.4, 0, 0)); // choirs between the towers
    g.add(at(door(2.2, 4.2), 0, 0, W * 0.35 + 0.05)); // Fürstenportal
    return g;
  },
  venedig: () => { // Klein Venedig: fishermen's houses on the river, half-timbered, balconies, little gardens
    const g = new THREE.Group();
    const cols = [C.rose, C.plaster, C.ochre, C.sky, C.salmon, C.mint];
    for (let i = 0; i < 6; i++) {
      const hs = toyHouse(4.2, 4.6, 2 + (i % 2), cols[i]!, i % 3 ? C.roof : C.roofDark, true);
      hs.add(at(box(4.6, 0.25, 1.2, C.timber), 0, 2.2, 2.9)); // balcony over the water
      hs.add(at(balustrade(4.4, 0.6, C.timber), 0, 2.45, 3.4));
      hs.add(at(flowerBox(3.4), 0, 2.45, 3.5));
      g.add(at(hs, -13 + i * 5.2, 0, 0));
    }
    return g;
  },
  schlenkerla: () => { // dark half-timbered tavern, blue shutters, flower boxes, stone ground floor
    const g = new THREE.Group();
    g.add(rbox(8, 2.6, 6.5, "#d9d4c8"));
    g.add(at(timberBox(8, 5, 6.5, "#f2ece0", "#3a2a1e"), 0, 2.6, 0));
    g.add(at(gable(8, 6.5, 3.6, C.roofDark), 0, 7.6, 0));
    const wr = windowRows(7, 2.8, 7.4, 2, 4, 3.27); g.add(wr);
    for (let i = 0; i < 4; i++) { g.add(at(box(0.3, 1.2, 0.08, "#3d6f8e"), -3.4 + i * 1.75 - 0.55, 3.2, 3.3), at(box(0.3, 1.2, 0.08, "#3d6f8e"), -3.4 + i * 1.75 + 0.55, 3.2, 3.3)); g.add(at(flowerBox(1.2), -2.6 + i * 1.75, 3.0, 3.4)); }
    g.add(at(door(1.3, 2.3, "#2f5d78"), 1.8, 0, 3.27));
    g.add(at(box(0.12, 0.12, 1.6, C.timber), -2, 2.5, 4.0), at(box(1.3, 0.9, 0.1, C.gold), -2, 1.9, 4.8)); // hanging sign
    g.add(at(box(0.9, 1.6, 0.9, "#8a8a8a"), 3, 10.2, -1)); // chimney
    return g;
  },
  rosengarten: (w, d) => { // baroque rose garden: lawn, rose beds, pavilion, fountain, statues, lindens
    const W = clamp(w, 16, 30), D = clamp(d, 14, 26);
    const g = new THREE.Group();
    g.add(at(rbox(W, 0.4, D, "#e2d6bb", 0.1), 0, 0, 0));
    g.add(at(box(W * 0.8, 0.12, D * 0.8, C.green), 0, 0.4, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(at(cyl(1.4, 1.4, 0.5, C.flower, 12), Math.cos(a) * W * 0.28, 0.4, Math.sin(a) * D * 0.28)); g.add(at(statue(2.2, C.white, C.white), Math.cos(a + 0.4) * W * 0.4, 0.4, Math.sin(a + 0.4) * D * 0.4)); }
    g.add(at(fountain(2.4, 1.2), 0, 0.4, 0));
    const pav = G(cyl(2.6, 2.6, 0.4, C.white, 12)); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; pav.add(at(cyl(0.18, 0.18, 3, C.white, 8), Math.cos(a) * 2.2, 0.4, Math.sin(a) * 2.2)); }
    pav.add(at(dome(2.6, C.copper, 0.7), 0, 3.4, 0)); g.add(at(pav, W * 0.35, 0.4, -D * 0.35));
    for (let i = 0; i < 5; i++) g.add(at(lollipop(4), -W * 0.45, 0.4, -D * 0.4 + i * D * 0.2));
    return g;
  },
  concordia: (w, d) => { // Wasserschloss Concordia: ochre baroque palace on the river bank
    const L = clamp(Math.max(w, d), 12, 18), D = clamp(Math.min(w, d), 6, 10);
    const g = G(rbox(L + 1, 1.2, D + 3, C.sandstoneDark, 0.1), at(rbox(L, 8, D, C.ochre), 0, 1.2, 0));
    g.add(at(windowsAround(L, D, 2, 9, 3, 2.1, "rect"), 0, 0, 0));
    g.add(at(hip(L, D, 3.4, C.roof), 0, 9.2, 0));
    g.add(at(balustrade(L, 0.8, C.sandstone), 0, 1.2, D / 2 + 1.3));
    for (let i = 0; i < 3; i++) g.add(at(box(0.9, 1.1, 0.9, C.roof), -L / 3 + i * L / 3, 10.2, D * 0.18)); // dormers
    return g;
  },
  maxplatz: () => { // Maximiliansbrunnen on Maxplatz: basin, pillar with the king on top, four figures around
    const g = G(plazaDisc(12), at(fountain(4.2, 0), 0, 0.12, 0));
    g.add(at(cyl(0.9, 1.1, 5.5, C.stoneGrey, 8), 0, 1, 0), at(statue(2.4, "#56685e", C.stoneGrey), 0, 6.5, 0));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.add(at(statue(1.8, "#56685e"), Math.cos(a) * 2.6, 1, Math.sin(a) * 2.6)); }
    g.add(at(market(6, 10, C.roof), 0, 0.12, 0));
    return g;
  },
};

// ============================ MÜNCHEN ============================
const muenchen: Record<string, Builder> = {
  neues_rathaus: (w, d) => { // neo-gothic, dark stone, arcades, pinnacles, 85 m tower with the Glockenspiel
    const L = clamp(Math.max(w, d), 30, 44), D = clamp(Math.min(w, d), 12, 20);
    const g = new THREE.Group(), st = "#bcae98";
    g.add(rbox(L, 14, D, st));
    g.add(at(arcade(9, L * 0.8, 3.2, 1.2, st), 0, 0, D / 2 + 0.3));
    g.add(windowRows(L * 0.9, 4, 13.5, 3, 12, D / 2 + 0.02, "gothic"));
    const r = gable(L, D, 5.5, C.slate); g.add(at(r, 0, 14, 0));
    for (let i = 0; i < 9; i++) { g.add(at(spire(0.5, 3.2, "#9d917d"), -L / 2 + (L * (i + 0.5)) / 9, 14, D / 2)); } // pinnacles
    for (const x of [-1, 1]) g.add(at(steppedGable(6, 6, 5, st), x * L * 0.3, 14, D / 2 - 0.4));
    const t = tower(5.5, 34, st, { windows: 6 });
    t.add(at(box(4.6, 5, 0.6, "#8fb6c9"), 0, 22, 2.6)); // Glockenspiel oriel
    t.add(at(clock(1.3), 0, 29, 2.8));
    t.add(at(spire(3, 8, C.copper), 0, 34, 0));
    g.add(at(t, 0, 0, D * 0.15));
    return g;
  },
  frauenkirche: (w, d) => { // brick hall church, huge red roof, twin towers with green "welsche Hauben"
    const L = clamp(Math.max(w, d), 36, 48), W = clamp(Math.min(w, d), 16, 20), brick = "#a9583f";
    const g = new THREE.Group();
    const nave = gothicNave(W, L * 0.78, 15, brick, C.roof); nave.rotation.y = Math.PI / 2; nave.position.x = -L * 0.08; g.add(nave);
    for (const s of [-1, 1]) {
      const t = tower(6.2, 34, brick, { windows: 6, cornice: "#b86a4e" });
      t.add(at(haube(3.3, C.copper), 0, 34, 0));
      g.add(at(t, L * 0.36, 0, s * 3.4));
    }
    return g;
  },
  peterskirche: (w, d) => { // Alter Peter: white tower with clocks and a tiered green cap, church behind
    const g = new THREE.Group();
    const body = roundNave(9, clamp(Math.max(w, d), 16, 24) * 0.8, 10, C.cream, C.roof); body.rotation.y = Math.PI / 2; g.add(at(body, -4, 0, 0));
    const t = tower(5.4, 24, C.cream, { windows: 5, clock: true, clockY: 20 });
    t.add(at(cyl(2.3, 2.9, 3, C.cream, 8), 0, 24, 0));
    t.add(at(onion(2.4, C.copper), 0, 27, 0));
    t.add(at(cyl(1.2, 1.4, 2, C.cream, 8), 0, 31, 0), at(onion(1.2, C.copper), 0, 33, 0));
    g.add(at(t, 7, 0, 0));
    return g;
  },
  altes_rathaus: (w, d) => { // white gothic hall with stepped gable + the red-roofed tower
    const L = clamp(Math.max(w, d), 14, 22), D = clamp(Math.min(w, d), 7, 10);
    const g = G(rbox(L, 8, D, C.white));
    g.add(windowRows(L * 0.8, 1.5, 7.8, 2, 5, D / 2 + 0.02, "gothic"));
    const r = gable(L, D, 5, C.roof); g.add(at(r, 0, 8, 0));
    for (const x of [-1, 1]) { const sg = steppedGable(D, 5.4, 6, C.white); sg.rotation.y = Math.PI / 2; g.add(at(sg, x * L / 2, 8, 0)); g.add(at(spire(0.5, 3, C.copper), x * L / 2, 13.2, 0)); }
    const t = tower(4.6, 16, C.white, { windows: 3, clock: true, clockY: 13 });
    t.add(at(box(2.6, 3, 4.8, "#3b312a"), 0, 0, 0));
    const cap = spire(3.2, 7.5, C.roof); t.add(at(cap, 0, 16, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) t.add(at(spire(0.55, 2.4, C.roof), x * 2.2, 15.6, z * 2.2));
    g.add(at(t, L / 2 + 2.6, 0, 0));
    return g;
  },
  viktualienmarkt: () => { // market stalls with green roofs, the blue-white maypole, beer-garden benches, a big chestnut
    const g = G(plazaDisc(16, "#e9dfca"), market(12, 13, "#3f8a55"));
    const pole = G(cyl(0.25, 0.32, 16, "#ffffff", 8));
    for (let i = 0; i < 8; i++) pole.add(at(cyl(0.27, 0.27, 0.8, "#3b82c4", 8), 0, 1 + i * 1.8, 0));
    for (let i = 0; i < 4; i++) pole.add(at(box(1.8, 0.6, 0.08, C.white), (i % 2 ? 1 : -1) * 1, 5 + i * 2.2, 0));
    pole.add(at(cone(1.2, 1.2, C.green, 10), 0, 16, 0));
    g.add(pole);
    for (let i = 0; i < 4; i++) g.add(at(G(box(3, 0.8, 0.8, C.timber), at(box(3, 0.15, 0.4, C.timber), 0, 0.3, 1)), 5 + (i % 2) * 4, 0.12, -4 + i * 1.8));
    g.add(at(lollipop(7), 6, 0.12, -7));
    return g;
  },
  hofbraeuhaus: (w, d) => { // cream neo-renaissance: arched ground floor, corner oriel, scrolled gables, red roof
    const L = clamp(Math.max(w, d), 14, 22), D = clamp(Math.min(w, d), 10, 16);
    const g = G(rbox(L, 11, D, C.cream));
    g.add(at(arcade(5, L * 0.8, 3, 0.8, C.cream, 0.7), 0, 0, D / 2 + 0.2));
    g.add(windowRows(L * 0.85, 3.6, 10.8, 3, 7, D / 2 + 0.02, "arch"));
    g.add(at(gable(L, D, 5, C.roof), 0, 11, 0));
    for (const x of [-1, 0, 1]) g.add(at(steppedGable(3.4, 4.4, 4, C.cream), x * L * 0.3, 11, D / 2 - 0.5));
    const oriel = G(cyl(1.6, 1.6, 7, C.cream, 8), at(onion(1.6, C.copper, false), 0, 7, 0));
    g.add(at(oriel, -L / 2 + 1.4, 4, D / 2 + 0.3));
    g.add(at(box(2.6, 2.6, 0.2, "#3b6fb0"), 0, 8.6, D / 2 + 0.12), at(box(1.6, 1.6, 0.25, C.white), 0, 9.1, D / 2 + 0.16)); // HB crest
    return g;
  },
  feldherrnhalle: () => { // loggia with three big arches, balustrade with urns, two lions, steps
    const g = new THREE.Group(), st = "#e3d7c1";
    g.add(rbox(20, 1, 9, st, 0.08));
    const lo = arcade(3, 18, 10, 7, st, 1.6); g.add(at(lo, 0, 1, 0));
    g.add(at(box(19, 1.4, 8, st), 0, 11.4, 0));
    g.add(at(balustrade(19, 1, st), 0, 12.8, 3.6));
    for (let i = 0; i < 5; i++) g.add(at(sphere(0.45, st), -8 + i * 4, 13.8, 3.6));
    for (const x of [-1, 1]) g.add(at(lion(2.6, "#9a8f7c"), x * 7, 1, 5.5));
    g.add(at(statue(3.2, "#5c6e62", st), -2.5, 1, 1), at(statue(3.2, "#5c6e62", st), 2.5, 1, 1));
    for (let i = 0; i < 3; i++) g.add(at(box(20 - i * 0.6, 0.33, 1, st), 0, 0, 5 + i));
    return g;
  },
};

// ============================ NÜRNBERG ============================
const nuernberg: Record<string, Builder> = {
  hauptmarkt: () => G(plazaDisc(16, "#e8ddc7"), market(12, 13, "#d23a3a")), // Christmas-market stalls, red-white
  schoener_brunnen: () => { // 19 m gothic spire fountain, gold and colours, inside an iron fence
    const g = G(plazaDisc(8), at(cyl(3.2, 3.4, 1, C.stoneGrey, 8), 0, 0.12, 0));
    g.add(at(cyl(2.9, 2.9, 0.1, "", 8, mat(C.water, { rough: 0.1, metal: 0.2 })), 0, 1.02, 0));
    const tiers = [[2.1, 2.8, C.gold], [1.6, 2.4, "#3f7a4e"], [1.2, 2.2, C.gold], [0.8, 1.8, "#b93b3b"]] as const;
    let y = 1.1;
    for (const [r, h, col] of tiers) { const t = cyl(r * 0.8, r, h, col, 8); g.add(at(t, 0, y, 0)); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(at(spire(0.18, h * 0.7, C.gold), Math.cos(a) * r, y + h * 0.4, Math.sin(a) * r)); } y += h; }
    g.add(at(spire(0.5, 3.6, C.gold), 0, y, 0));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.add(at(cyl(0.05, 0.05, 1.6, "#2b2b2b", 4), Math.cos(a) * 3.8, 0.12, Math.sin(a) * 3.8)); }
    return g;
  },
  frauenkirche: (w, d) => { // stepped sandstone front, golden clock with the Männleinlaufen, porch
    const L = clamp(Math.max(w, d), 12, 18), W = clamp(Math.min(w, d), 9, 12), st = "#b7735c";
    const g = gothicNave(W, L, 10, st, C.roof); g.rotation.y = 0;
    const front = steppedGable(W, 9, 7, st, 1); g.add(at(front, 0, 10, L / 2));
    g.add(at(rbox(W * 0.55, 5, 1.8, st), 0, 0, L / 2 + 0.9));
    g.add(at(door(2.2, 3.8), 0, 0, L / 2 + 1.82));
    g.add(at(roseWindow(1.4, "#caa084"), 0, 6.8, L / 2 + 0.55));
    g.add(at(clock(1.2), 0, 14, L / 2 + 0.6), at(box(1.6, 1.4, 0.4, C.gold), 0, 16.2, L / 2 + 0.5));
    g.add(at(spire(0.8, 3.4, st), 0, 19, L / 2));
    return g;
  },
  sebald: (w, d) => G(churchTwinSpires(w, d, "#b86f58", C.roof, C.copper)),
  lorenz: (w, d) => { const g = churchTwinSpires(w, d, "#b86f58", C.roofDark, C.copper); g.add(at(roseWindow(2.4, "#caa084"), 0, 12, clamp(Math.max(w, d), 30, 44) * 0.5 + 0.1)); return g; },
  kaiserburg: () => { // castle on its rock: round Sinwell tower, pentagon tower, palas, walls
    const g = new THREE.Group(), st = "#b86f58";
    g.add(rbox(34, 3, 16, "#a58a6c", 0.4));
    g.add(at(rbox(16, 8, 7, st), -6, 3, 1), at(hip(16, 7, 3.4, C.roofDark), -6, 11, 1));
    g.add(at(windowRows(14, 4, 10, 2, 6, 3.52, "arch"), -6, 0, 1));
    const sin = G(cyl(2.6, 2.8, 16, "#c9b79a", 12), at(cyl(3.1, 3.1, 1.6, C.timber, 12), 0, 16, 0), at(cone(3.4, 5, C.roof, 12), 0, 17.6, 0));
    g.add(at(sin, 7, 3, 1));
    const pent = tower(4, 12, st, { windows: 2 }); pent.add(at(gable(4, 4, 3, C.roof), 0, 12, 0)); g.add(at(pent, 14, 3, -3));
    g.add(at(battlements(30, st), 0, 3, 7.8), at(battlements(30, st), 0, 3, -7.8));
    g.add(at(flag(5), 7, 25.5, 1));
    return g;
  },
  duerer: (w, d) => { // half-timbered upper floors on a sandstone ground floor, big roof with dormers
    const L = clamp(Math.max(w, d), 9, 13), D = clamp(Math.min(w, d), 7, 10);
    const g = G(rbox(L, 3.2, D, "#b86f58"), at(timberBox(L, 5.4, D, C.white, "#9b2f2a"), 0, 3.2, 0));
    g.add(at(windowRows(L * 0.85, 3.4, 8.4, 2, 5, D / 2 + 0.02), 0, 0, 0));
    g.add(at(gable(L, D, 6.5, C.roofDark), 0, 8.6, 0));
    for (const x of [-1, 1]) g.add(at(G(box(1.5, 1.6, 1.6, C.white), at(gable(1.5, 1.6, 1, C.roofDark), 0, 1.6, 0)), x * L * 0.25, 10.2, D * 0.25));
    g.add(at(door(1.3, 2.4), -L * 0.2, 0, D / 2 + 0.01));
    return g;
  },
};
function churchTwinSpires(w: number, d: number, st: string, roof: string, spireC: string): THREE.Group {
  const L = clamp(Math.max(w, d), 30, 44), W = clamp(Math.min(w, d), 12, 17);
  const nave = gothicNave(W, L * 0.85, 13, st, roof); nave.position.z = -L * 0.07;
  const g = G(nave);
  for (const s of [-1, 1]) {
    const t = tower(4.6, 27, st, { windows: 5 });
    t.add(at(spire(3.1, 12, spireC), 0, 27, 0));
    g.add(at(t, s * (W / 2 - 1.6), 0, L * 0.4));
  }
  g.add(at(door(2.6, 4.6), 0, 0, L * 0.4 + 2.35));
  return g;
}

// ============================ WÜRZBURG ============================
const wuerzburg: Record<string, Builder> = {
  residenz: (w, d) => { // U-shaped baroque palace around the cour d'honneur, central pavilion, mansard roofs
    const L = clamp(Math.max(w, d), 50, 76), D = clamp(Math.min(w, d), 30, 44), st = "#e4c793";
    const g = new THREE.Group();
    const wing = (len: number, dep: number) => G(rbox(len, 10, dep, st), at(hip(len, dep, 4, C.slate), 0, 10, 0), windowsAround(len, dep, 1.2, 9.4, 3, 2.4, "rect"));
    g.add(at(wing(L, 9), 0, 0, -D / 2 + 4.5));
    g.add(at(wing(9, D), -L / 2 + 4.5, 0, 0), at(wing(9, D), L / 2 - 4.5, 0, 0));
    const cp = G(rbox(16, 13, 11, st), at(hip(16, 11, 4.5, C.slate), 0, 13, 0));
    const ped = new THREE.Shape([new THREE.Vector2(-7, 0), new THREE.Vector2(7, 0), new THREE.Vector2(0, 2.6)]);
    cp.add(at(new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 0.6, bevelEnabled: false }), mat(st)), 0, 11, 5.4));
    for (let i = 0; i < 6; i++) cp.add(at(cyl(0.4, 0.45, 9, C.white, 10), -5.5 + i * 2.2, 1.6, 5.8));
    g.add(at(cp, 0, 0, -D / 2 + 7));
    for (let i = 0; i < 5; i++) g.add(at(statue(1.6, st, st), -6 + i * 3, 13, -D / 2 + 12.6));
    g.add(at(fountain(3.2, 3), 0, 0, D * 0.2));
    return g;
  },
  mainbruecke: (w, d) => { // stone bridge, 8 arches, statues of saints on both parapets
    const L = Math.max(w, d, 40), g = new THREE.Group();
    g.add(stoneBridge(L, 4.4, 1.8, 8, "#c9b184"));
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) g.add(at(statue(2.4, "#b5a88e", "#c9b184"), -L * 0.35 + (i * L * 0.7) / 5, 2.4, s * 1.9));
    return g;
  },
  kilian: (w, d) => { // romanesque cathedral with twin west towers and dark pointed caps
    const L = clamp(Math.max(w, d), 36, 50), W = clamp(Math.min(w, d), 14, 20);
    const g = roundNave(W * 0.8, L * 0.8, 12, C.white, C.roof);
    for (const s of [-1, 1]) { const t = tower(4.6, 24, "#d9cdb8", { windows: 5 }); t.add(at(spire(3.2, 9, C.slate), 0, 24, 0)); g.add(at(t, s * (W * 0.4 - 1.6), 0, L * 0.42)); }
    g.add(at(door(2.4, 4.2), 0, 0, L * 0.42 + 2.35));
    return g;
  },
  marienkapelle: (w, d) => { // red-and-white gothic chapel with an openwork red spire
    const L = clamp(Math.max(w, d), 18, 28), W = clamp(Math.min(w, d), 8, 12);
    const g = gothicNave(W, L, 11, C.white, C.roof);
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.MeshStandardMaterial).color?.getHexString?.() === "fffaf0") m.material = mat("#c24a3a"); });
    const t = tower(4, 18, "#c24a3a", { windows: 4 }); t.add(at(spire(2.6, 14, "#c24a3a"), 0, 18, 0)); t.add(at(sphere(0.6, C.gold, { metal: 0.6 }), 0, 32.3, 0));
    g.add(at(t, 0, 0, -L / 2 - 1.4));
    return g;
  },
  falkenhaus: (w, d) => { // yellow rococo facade with white stucco curls and curvy gables
    const L = clamp(Math.max(w, d), 12, 18), D = clamp(Math.min(w, d), 8, 12);
    const g = G(rbox(L, 9, D, "#f4d88a"), at(gable(L, D, 4, C.roof), 0, 9, 0));
    g.add(windowRows(L * 0.85, 1, 8.8, 3, 7, D / 2 + 0.02));
    for (let i = 0; i < 7; i++) for (let r = 0; r < 3; r++) g.add(at(sphere(0.32, C.white), -L * 0.425 + (L * 0.85 * (i + 0.5)) / 7, 3.2 + r * 2.6, D / 2 + 0.1)); // stucco crowns
    for (const x of [-1, 0, 1]) { const cg = G(rbox(3.4, 3, 0.6, "#f4d88a", 0.25)); cg.add(at(sphere(0.7, C.white), 0, 3, 0), at(sphere(0.4, C.white), -1.4, 2.4, 0), at(sphere(0.4, C.white), 1.4, 2.4, 0)); g.add(at(cg, x * L * 0.32, 9, D / 2 - 0.3)); }
    g.add(at(arcade(4, L * 0.6, 2.4, 0.6, "#f4d88a", 0.6), 0, 0, D / 2 + 0.3));
    return g;
  },
  neumuenster: (w, d) => { // red sandstone baroque front, green dome with lantern, two small onion towers
    const L = clamp(Math.max(w, d), 20, 30), W = clamp(Math.min(w, d), 10, 16), st = "#d4876c";
    const g = roundNave(W, L, 12, st, C.roof);
    const fr = G(rbox(W + 1, 15, 2, st), windowRows(W * 0.7, 2, 14, 2, 3, 1.02, "arch"));
    for (let i = 0; i < 4; i++) fr.add(at(cyl(0.35, 0.35, 13, C.white, 8), -W / 2 + 0.8 + i * (W - 1.6) / 3, 0, 1.1));
    fr.add(at(door(2.2, 4), 0, 0, 1.05));
    g.add(at(fr, 0, 0, L / 2));
    g.add(at(G(cyl(4, 4, 3, st, 16), at(dome(4, C.copper, 1.1), 0, 3, 0), at(onion(1.2, C.copper), 0, 7.2, 0)), 0, 12, -L * 0.1));
    for (const s of [-1, 1]) g.add(at(G(cyl(1.3, 1.3, 4, st, 8), at(onion(1.2, C.copper), 0, 4, 0)), s * (W / 2 + 0.2), 12, L / 2 - 0.6));
    return g;
  },
  grafeneckart: (w, d) => { // yellow baroque town-hall courtyard building + romanesque tower with small spire
    const L = clamp(Math.max(w, d), 16, 26), D = clamp(Math.min(w, d), 8, 12);
    const g = G(rbox(L, 10, D, "#f0cf7c"), at(hip(L, D, 4, C.slate), 0, 10, 0), windowsAround(L, D, 1.2, 9.6, 3, 2.3));
    const t = tower(4.4, 20, "#e2cfa7", { windows: 4, clock: true, clockY: 16 }); t.add(at(spire(2.4, 5, C.slate), 0, 20, 0));
    g.add(at(t, L / 2 - 2.6, 0, -D / 2 + 2.2));
    for (let i = 0; i < 4; i++) g.add(at(flag(4, i % 2 ? "#ffffff" : "#c8102e", i % 2 ? "#3b82c4" : "#ffd100"), -L * 0.35 + i * L * 0.23, 0, D / 2 + 2));
    return g;
  },
};

// ============================ REGENSBURG ============================
const regensburg: Record<string, Builder> = {
  dom: (w, d) => { // two openwork gothic spires, pale stone
    const L = clamp(Math.max(w, d), 36, 52), W = clamp(Math.min(w, d), 16, 22), st = "#d6d0c4";
    const nave = gothicNave(W, L * 0.85, 16, st, C.slate); nave.position.z = -L * 0.06;
    const g = G(nave);
    for (const s of [-1, 1]) {
      const t = tower(5.6, 30, st, { windows: 6 });
      const sp = spire(3.6, 18, st); t.add(at(sp, 0, 30, 0));
      for (const x of [-1, 1]) for (const z of [-1, 1]) t.add(at(spire(0.4, 3.4, st), x * 2.6, 30, z * 2.6));
      g.add(at(t, s * (W / 2 - 2.4), 0, L * 0.42));
    }
    g.add(at(door(3, 5.5), 0, 0, L * 0.42 + 2.85), at(steppedGable(W * 0.4, 8, 6, st), 0, 16, L * 0.42 + 2));
    return g;
  },
  steinerne_bruecke: (w, d) => { // 16 low arches over the Danube, with the bridge tower at the old-town end
    const L = Math.max(w, d, 60), g = new THREE.Group();
    g.add(stoneBridge(L, 4.4, 1.6, 12, "#c7b393"));
    const t = tower(5, 11, "#d9c7a5", { windows: 2, clock: true, clockY: 8.5 });
    t.add(at(hip(5, 5, 3.6, C.roofDark), 0, 11, 0), at(box(2.6, 3.4, 5.2, "#3b312a"), 0, 0, 0));
    t.rotation.y = Math.PI / 2;
    g.add(at(t, -L / 2 + 2.5, 1.6, 0));
    return g;
  },
  wurstkuchl: () => { // tiny green house, red tiled roof, smoking chimney, striped awning, benches
    const g = G(rbox(8, 3, 5, "#9fc7a2"), at(gable(8, 5, 2.6, C.roof), 0, 3, 0));
    g.add(at(box(1, 3.4, 1, "#a09a90"), 1.6, 3.6, -0.6));
    g.add(windowRows(6.5, 0.8, 2.8, 1, 4, 2.52));
    for (let i = 0; i < 6; i++) g.add(at(box(8.4 / 6, 0.12, 1.6, i % 2 ? "#c83a3a" : C.white), -3.5 + i * 1.4, 2.3, 3.2));
    for (let i = 0; i < 3; i++) g.add(at(G(box(3, 0.7, 0.9, C.timber), at(box(3, 0.4, 0.3, C.timber), 0, 0, 0.9), at(box(3, 0.4, 0.3, C.timber), 0, 0, -0.9)), -3 + i * 3.2, 0, 5.5));
    return g;
  },
  altes_rathaus: (w, d) => { // yellow gothic hall, steep roof with dormers, gothic oriel, the town-hall tower
    const L = clamp(Math.max(w, d), 14, 22), D = clamp(Math.min(w, d), 8, 12);
    const g = G(rbox(L, 8, D, "#f1cf6e"), at(gable(L, D, 7, "#7a6a5a"), 0, 8, 0), windowRows(L * 0.8, 1.2, 7.6, 2, 6, D / 2 + 0.02, "gothic"));
    for (let i = 0; i < 3; i++) g.add(at(G(box(1.6, 1.6, 1.4, "#7a6a5a"), at(gable(1.6, 1.4, 1, "#7a6a5a"), 0, 1.6, 0)), -L * 0.3 + i * L * 0.3, 9.4, D * 0.25));
    g.add(at(G(box(2.4, 3.2, 1.2, C.white), at(cone(1.4, 1.6, C.slate, 4), 0, 3.2, 0)), 1, 4, D / 2 + 0.6)); // oriel
    const t = tower(4.4, 22, "#e8dcc4", { windows: 4 }); t.add(at(hip(4.4, 4.4, 3, C.roofDark), 0, 22, 0));
    g.add(at(t, L / 2 + 2.4, 0, 0));
    return g;
  },
  goldener_turm: () => { // tall sandstone patrician tower, paired arched windows, red pyramid roof with a gold ball
    const t = tower(5.2, 26, "#d8c8a4", { windows: 6, cornice: "#d8c8a4" });
    const cap = cone(3.9, 4.2, C.roof, 4); cap.rotation.y = Math.PI / 4; t.add(at(cap, 0, 26, 0), at(sphere(0.5, C.gold, { metal: 0.6 }), 0, 30.4, 0));
    return G(at(rbox(9, 9, 8, "#efe3c7"), -4, 0, 1), at(gable(9, 8, 3.4, C.roof), -4, 9, 1), t);
  },
  neupfarrkirche: (w, d) => { // white renaissance church alone on its square, two towers with baroque caps
    const L = clamp(Math.max(w, d), 18, 26), W = clamp(Math.min(w, d), 10, 14);
    const g = roundNave(W, L, 11, C.white, C.roof);
    for (const s of [-1, 1]) { const t = tower(3.8, 18, C.white, { windows: 3, clock: s > 0 }); t.add(at(onion(1.9, C.slate), 0, 18, 0)); g.add(at(t, s * (W / 2 - 1.4), 0, -L / 2 - 1)); }
    return g;
  },
  haidplatz: () => { // Justitia fountain in front of the red "Goldenes Kreuz" with its little tower
    const g = G(plazaDisc(13), at(fountain(3.2, 3.6), 0, 0.12, 0), at(statue(2.2, "#c9a24b"), 0, 5, 0));
    const h = G(rbox(14, 9, 7, "#c9594a"), at(hip(14, 7, 3.4, C.roof), 0, 9, 0), windowRows(12, 1, 8.6, 3, 6, 3.52));
    const tw = tower(3.6, 16, "#c9594a", { windows: 3 }); tw.add(at(steppedGable(3.6, 3, 4, "#c9594a"), 0, 16, 0));
    h.add(at(tw, -5, 0, 0));
    g.add(at(h, 0, 0, -9));
    return g;
  },
};

// ============================ ERLANGEN ============================
const erlangen: Record<string, Builder> = {
  schloss: (w, d) => { // long sandstone baroque palace, central projection with pediment and roof statues
    const L = clamp(Math.max(w, d), 36, 50), D = clamp(Math.min(w, d), 10, 16), st = "#d7bf8d";
    const g = G(rbox(L, 12, D, st), at(hip(L, D, 4, C.slate), 0, 12, 0), windowsAround(L, D, 1.2, 11.4, 3, 2.3));
    const c = G(rbox(12, 13.5, D + 1, st), at(hip(12, D + 1, 4, C.slate), 0, 13.5, 0));
    const ped = new THREE.Shape([new THREE.Vector2(-6, 0), new THREE.Vector2(6, 0), new THREE.Vector2(0, 2.4)]);
    c.add(at(new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 0.6, bevelEnabled: false }), mat(st)), 0, 13, D / 2 + 0.2));
    for (let i = 0; i < 5; i++) c.add(at(statue(1.6, st, st), -4.8 + i * 2.4, 13.5, D / 2));
    g.add(c, at(statue(3.4, "#5c6e62"), 0, 0, D / 2 + 5));
    return g;
  },
  orangerie: (w, d) => { // curved yellow orangery around its garden, white arched windows, red roof
    const g = new THREE.Group(), R = clamp(Math.max(w, d) * 0.55, 14, 22), n = 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.1 + (0.8 * i) / (n - 1)), seg = G(rbox(4.2, 6, 5, "#f2c35d"), at(gable(4.2, 5, 2.2, C.roof), 0, 6, 0), at(archWindow(1.5, 3.4), 0, 2.6, 2.52));
      g.add(at(seg, Math.cos(a) * R, 0, -Math.sin(a) * R + R * 0.5, Math.PI / 2 - a));
    }
    g.add(at(fountain(3, 1), 0, 0, R * 0.2));
    return g;
  },
  hugenottenbrunnen: () => { // baroque fountain: a rocky pyramid crowded with figures, big basin
    const g = G(plazaDisc(10, "#dfe6c8"), at(fountain(6, 0), 0, 0.12, 0));
    const pyr = cone(3, 7, "#8e8a80", 7); g.add(at(pyr, 0, 1, 0));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = 2.2 - (i % 3) * 0.6; g.add(at(statue(1.6, "#9c9689", "#8e8a80"), Math.cos(a) * r, 1 + (i % 3) * 2, Math.sin(a) * r)); }
    g.add(at(statue(2.2, "#9c9689", "#8e8a80"), 0, 7.6, 0));
    return g;
  },
  hugenottenkirche: (w, d) => { // sandstone church with the tall front tower and green onion top
    const L = clamp(Math.max(w, d), 16, 26), W = clamp(Math.min(w, d), 10, 16), st = "#dcb996";
    const g = G(rbox(W, 9, L, st), at(hip(W, L, 4, C.roof), 0, 9, 0), windowsAround(W, L, 1.4, 8.6, 2, 3, "arch"));
    const t = tower(4.2, 20, st, { windows: 4, clock: true, clockY: 17 }); t.add(at(onion(2.1, C.copper), 0, 20, 0));
    g.add(at(t, 0, 0, L / 2 + 1.8));
    return g;
  },
  neustaedter_kirche: (w, d) => { // baroque sandstone church, tower with onion
    const L = clamp(Math.max(w, d), 18, 26), W = clamp(Math.min(w, d), 11, 15), st = "#d1b089";
    const g = roundNave(W, L, 11, st, C.roof);
    const t = tower(4.4, 22, st, { windows: 4, clock: true, clockY: 19 }); t.add(at(onion(2.2, C.copper), 0, 22, 0));
    g.add(at(t, 0, 0, -L / 2 - 1.8));
    return g;
  },
  marktplatz: () => { // market square with the Paulibrunnen and stalls in front of the palace
    const g = G(plazaDisc(14), at(fountain(2.8, 2.4), 0, 0.12, 0), at(statue(2, "#5c6e62"), 0, 3.4, 0), market(8, 11, C.roof));
    return g;
  },
  hugenottenplatz: () => { // the square: fountain, benches, lindens, a baroque palais
    const g = G(plazaDisc(14), at(fountain(2.4, 1.6), 0, 0.12, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(at(lollipop(5), Math.cos(a) * 9, 0.12, Math.sin(a) * 9)); }
    const p = G(rbox(18, 10, 7, "#dcd2bd"), at(hip(18, 7, 3.6, C.roofDark), 0, 10, 0), windowRows(16, 1, 9.6, 3, 8, 3.52));
    for (let i = 0; i < 6; i++) p.add(at(G(box(1.2, 1.4, 1.2, C.roofDark)), -6 + i * 2.4, 11, 1.2));
    g.add(at(p, 0, 0, -12));
    return g;
  },
};

// ============================ AUGSBURG ============================
const augsburg: Record<string, Builder> = {
  rathaus: (w, d) => { // white renaissance town hall, gable with the golden imperial eagle, two onion towers
    const L = clamp(Math.max(w, d), 22, 34), D = clamp(Math.min(w, d), 14, 20);
    const g = G(rbox(L, 20, D, C.white), windowsAround(L, D, 1, 19.4, 6, 3.2, "rect")); // windows on every side, like the real one
    for (const y of [6.4, 13]) g.add(at(box(L + 0.3, 0.45, D + 0.3, "#e3d3b0"), 0, y, 0)); // stone floor bands
    g.add(at(hip(L, D, 3, C.slate), 0, 20, 0));
    const ped = new THREE.Shape([new THREE.Vector2(-L * 0.28, 0), new THREE.Vector2(L * 0.28, 0), new THREE.Vector2(0, 7)]);
    g.add(at(new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: 1, bevelEnabled: false }), mat(C.white)), 0, 20, D / 2 - 1));
    g.add(at(G(box(3.2, 2.6, 0.3, "#1c1c1c"), at(box(2.2, 1.8, 0.35, C.gold), 0, 0.4, 0)), 0, 22.4, D / 2 + 0.1)); // eagle
    for (const s of [-1, 1]) { const t = G(cyl(3, 3, 8, C.white, 8), windowRows(3.4, 2, 7.6, 2, 2, 3.02, "arch"), at(onion(3, C.copper), 0, 8, 0)); g.add(at(t, s * L * 0.33, 20, 0)); }
    g.add(at(door(2.4, 4.2), 0, 0, D / 2 + 0.02));
    return g;
  },
  perlachturm: () => { // 70 m bell tower: grey base, white shaft with clocks, tiered green onion
    const t = tower(5.2, 30, C.white, { windows: 7, clock: true, clockY: 22 });
    t.add(at(box(5.6, 9, 5.6, "#8f8b85"), 0, 0, 0));
    t.add(at(cyl(2.6, 3, 3, C.white, 8), 0, 30, 0), at(onion(2.5, C.copper), 0, 33, 0));
    return G(t, at(G(rbox(8, 8, 9, "#e9e2d2"), at(gable(8, 9, 4, C.roof), 0, 8, 0)), -6.4, 0, 0));
  },
  dom: (w, d) => { // gothic cathedral, red roofs, two slim romanesque towers with green spires
    const L = clamp(Math.max(w, d), 36, 52), W = clamp(Math.min(w, d), 14, 20);
    const g = gothicNave(W, L * 0.85, 13, C.white, C.roof);
    for (const s of [-1, 1]) { const t = tower(4, 24, "#d9c19a", { windows: 5 }); t.add(at(spire(2.8, 10, C.copper), 0, 24, 0)); g.add(at(t, s * 3.6, 0, 0)); }
    return g;
  },
  fuggerei: (w, d) => { // the world's oldest social housing: ochre row houses with red roofs along little lanes, a gate
    const W = clamp(Math.max(w, d), 30, 60), D = clamp(Math.min(w, d), 24, 40), g = new THREE.Group();
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) g.add(at(toyHouse(4.4, 5, 2, i % 3 === 1 ? "#f0b95a" : "#f3c86d", C.roof), -W * 0.4 + i * (W * 0.8) / 5, 0, -D * 0.35 + r * D * 0.35));
    const gate = G(rbox(8, 8, 4, "#f0b95a"), at(gable(8, 4, 3, C.roof), 0, 8, 0), at(box(3, 4, 4.2, "#3b312a"), 0, 0, 0), at(archWindow(0.9, 1.4), -2.4, 5.4, 2.02), at(archWindow(0.9, 1.4), 2.4, 5.4, 2.02));
    g.add(at(gate, 0, 0, D / 2));
    return g;
  },
  augustusbrunnen: () => { // bronze Augustus on a tall pedestal, four river gods, fenced basin
    const g = G(plazaDisc(10), at(fountain(5, 0), 0, 0.12, 0), at(cyl(1, 1.3, 6, C.stoneGrey, 8), 0, 1, 0), at(statue(2.6, "#4b5c50"), 0, 7, 0));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; g.add(at(statue(1.8, "#4b5c50"), Math.cos(a) * 3.2, 1, Math.sin(a) * 3.2)); }
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.add(at(cyl(0.05, 0.05, 1.3, "#2b2b2b", 4), Math.cos(a) * 5.6, 0.12, Math.sin(a) * 5.6)); }
    return g;
  },
  herkulesbrunnen: () => { // Hercules fighting the hydra atop a tall pedestal, bronze figures, big basin
    const g = G(plazaDisc(10), at(fountain(5.4, 0), 0, 0.12, 0), at(rbox(2.2, 6.5, 2.2, "#d8cfbc", 0.1), 0, 1, 0), at(statue(3, "#3e4d44"), 0, 7.5, 0));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.add(at(statue(1.8, "#3e4d44"), Math.cos(a) * 2.4, 1, Math.sin(a) * 2.4)); }
    return g;
  },
};

// ============================ BAVARIA (overview sights, big icons) ============================
const bayern: Record<string, Builder> = {
  neuschwanstein: () => { // white castle on its rock: slim towers with slate spires, the tall keep
    const g = G(at(cone(16, 10, "#8f9a7f", 9), 0, 0, 0));
    const white = "#f4f1ea", sl = "#5b6f86";
    g.add(at(G(rbox(18, 10, 6, white), at(gable(18, 6, 5, sl), 0, 10, 0), windowRows(16, 1.5, 9.6, 3, 8, 3.02, "arch")), 0, 9, 0));
    for (const [x, z, h, r] of [[-9, 0, 20, 1.6], [9, 1.5, 16, 1.4], [3, -4, 24, 1.8], [-3, 4, 14, 1.2], [12, -3, 18, 1.3]] as const) {
      g.add(at(G(cyl(r, r, h, white, 12), at(spire(r * 1.2, r * 4, sl), 0, h, 0)), x, 9, z));
    }
    g.add(at(flag(4), 3, 9 + 24 + 7, -4));
    return g;
  },
  zugspitze: () => G(at(rbox(4, 1, 4, "#9a948a"), 0, 0, 0), at(box(0.5, 7, 0.5, C.gold), 0, 1, 0), at(box(3.4, 0.5, 0.5, C.gold), 0, 5.8, 0)), // summit cross
  koenigssee: () => { // St. Bartholomä: white chapel with red onion domes on its lake shore
    const g = G(rbox(10, 5, 8, C.white), at(hip(10, 8, 2.4, C.roof), 0, 5, 0));
    for (const [x, z, r] of [[-3.2, 0, 2.4], [2.6, -2, 1.8], [2.6, 2, 1.8]] as const) g.add(at(G(cyl(r * 0.8, r * 0.8, 2, C.white, 12), at(onion(r, "#b8483a"), 0, 2, 0)), x, 5, z));
    return g;
  },
  walhalla: () => { // greek temple high above the Danube on stepped terraces
    const g = new THREE.Group(), m = "#ece8df";
    for (let i = 0; i < 4; i++) g.add(at(rbox(40 - i * 5, 2.6, 24 - i * 3, m, 0.1), 0, i * 2.6, 0));
    const t = G(rbox(24, 1, 12, m));
    for (let i = 0; i < 9; i++) for (const z of [-5.4, 5.4]) t.add(at(cyl(0.7, 0.8, 8, m, 12), -10.4 + i * 2.6, 1, z));
    t.add(at(rbox(22, 1.6, 12, m), 0, 9, 0), at(gable(22, 12, 3.4, "#8c8579", 0.2), 0, 10.6, 0));
    g.add(at(t, 0, 10.4, 0));
    return g;
  },
  rothenburg: () => { // the Plönlein: a yellow half-timbered house between two gate towers, town wall
    const g = new THREE.Group();
    g.add(at(G(timberBox(8, 7, 7, "#f2d27a"), at(gable(8, 7, 5, C.roof), 0, 7, 0), windowRows(7, 0.8, 6.6, 2, 3, 3.52)), 0, 0, 0));
    for (const [x, z, h] of [[-9, -3, 16], [9, -5, 13]] as const) { const t = tower(4.2, h, "#e3d3b0", { windows: 3, clock: x < 0 }); t.add(at(hip(4.2, 4.2, 4, C.roof), 0, h, 0)); t.add(at(box(2.2, 3, 4.4, "#3b312a"), 0, 0, 0)); g.add(at(t, x, 0, z)); }
    g.add(at(G(box(30, 5, 1.4, "#e3d3b0"), at(battlements(30, "#e3d3b0"), 0, 5, 0)), 0, 0, -9));
    return g;
  },
  herrenchiemsee: () => { // Ludwig's Versailles on the island: long palace, gold trim, fountain garden
    const g = G(cyl(18, 19, 0.6, C.green, 24));
    const p = G(rbox(26, 7, 7, "#f1e4c6"), windowRows(24, 1, 6.6, 2, 12, 3.52, "arch"), at(box(26.4, 0.6, 7.4, C.gold), 0, 7, 0), at(balustrade(26, 0.8, "#f1e4c6"), 0, 7.6, 3.4));
    for (const x of [-1, 1]) p.add(at(G(rbox(5, 7, 12, "#f1e4c6"), windowRows(10, 1, 6.6, 2, 4, 2.52, "arch")), x * 11, 0, 4.5));
    g.add(at(p, 0, 0.6, -4));
    for (const x of [-1, 1]) g.add(at(fountain(3, 2), x * 6, 0.6, 9));
    return g;
  },
  passau: () => { // St. Stephan: white baroque front, two towers with green onions, the green crossing dome
    const g = G(rbox(12, 12, 22, C.white), at(gable(12, 22, 4, C.roof), 0, 12, 0));
    g.children[1]!.rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) { const t = tower(4.6, 22, C.white, { windows: 4, clock: true, clockY: 18 }); t.add(at(onion(2.4, C.copper), 0, 22, 0)); g.add(at(t, s * 5, 0, 11)); }
    g.add(at(G(cyl(4, 4, 3, C.white, 16), at(dome(4, C.copper, 1.1), 0, 3, 0), at(onion(1.2, C.copper), 0, 7.2, 0)), 0, 12, -3));
    return g;
  },
};

export const LANDMARK_MODELS: Record<string, Record<string, Builder>> = { bamberg, muenchen, nuernberg, wuerzburg, regensburg, erlangen, augsburg, bayern };

/** Neue Residenz (Bamberg) -- not collectable, but the Rosengarten's backdrop. */
export function neueResidenz(w: number, d: number): THREE.Group {
  const L = clamp(Math.max(w, d), 30, 60), D = clamp(Math.min(w, d), 8, 12), st = "#e6cfa0";
  return G(rbox(L, 11, D, st), at(hip(L, D, 4, C.roof), 0, 11, 0), windowsAround(L, D, 1.2, 10.6, 3, 2.4));
}
export { window_ };
