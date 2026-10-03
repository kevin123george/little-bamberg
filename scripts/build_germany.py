"""public/world/world.json: one Germany you can walk and drive across -- 17 cities with real streets, the countryside in
between, and you can see the next city from the edge of the last.

Layout: cities at their real directions, 20 game units per real km between them (Koeln<->Duesseldorf ~40 s by truck,
Muenchen<->Berlin ~10 min on the Autobahn); each city's own map (1 unit = 2.2 m, +-half) placed whole. Cities closer
than their maps are wide are pushed apart and a smooth warp carries the countryside along, so rivers and roads still
meet each city where they really do.

Countryside (static, reliable sources -- the public Overpass servers kept timing out):
  heights: AWS Terrain Tiles (Terrarium, Mapzen; SRTM/EU-DEM ...), zoom 8, 1 unit = 12 m vertically, 0 = sea level
  rivers, lakes, motorways, country borders: Natural Earth 10m (public domain)
  towns: GeoNames cities15000 (CC BY 4.0), Germany, 15,000+ people
Usage: python3 scripts/build_germany.py   (needs numpy, pillow, requests, pyshp; data in .cache/germany)
"""
import base64
import json
import math
import time
from pathlib import Path

import numpy as np
import requests
import shapefile
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / ".cache" / "germany"
LAT0, LON0 = 51.1, 10.4
K = 20.0
VM = 12.0
REF_M = 0.0
STEP = 20
KX, KZ = 111.32 * math.cos(math.radians(LAT0)) * K, 110.574 * K

CFG = json.loads((ROOT / "scripts" / "cities.json").read_text())
CITIES = {"bamberg": {"center": [49.89168, 10.88681], "half": 290}}
for k, v in CFG.items():
    CITIES[k] = {"center": v["center"], "half": v.get("half", 290)}
SIGHTS = {"neuschwanstein": (47.5575, 10.7495), "zugspitze": (47.4212, 10.9863), "koenigssee": (47.5444, 12.9720),
          "walhalla": (49.0311, 12.2240), "rothenburg": (49.3773, 10.1790), "herrenchiemsee": (47.8604, 12.4023),
          "passau": (48.5743, 13.4655)}
RIVER_W = {"Rhine": 9, "Rhein": 9, "Elbe": 8, "Danube": 8, "Donau": 8, "Oder": 7, "Main": 6, "Weser": 6, "Mosel": 5, "Moselle": 5,
           "Neckar": 5, "Inn": 5, "Havel": 4, "Saale": 4, "Spree": 4, "Ems": 4, "Isar": 4, "Lech": 4, "Fulda": 3.5, "Werra": 3.5}


def proj(lat, lon):
    return np.stack([(np.asarray(lon) - LON0) * KX, -(np.asarray(lat) - LAT0) * KZ], -1)


def unproj(p):
    return LAT0 - p[..., 1] / KZ, LON0 + p[..., 0] / KX


# ---------------- layout
names = list(CITIES)
real_c = {k: proj(*CITIES[k]["center"]) for k in names}
half = {k: CITIES[k]["half"] + 6 for k in names}
pos = {k: v.copy() for k, v in real_c.items()}
for it in range(600):
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            d = pos[b] - pos[a]; L = float(np.hypot(*d)) or 1e-6
            need = (half[a] + half[b]) * 1.15 + 180
            if L < need:
                push = (need - L) / 2 * d / L
                pos[a] -= push * 0.5; pos[b] += push * 0.5
    for k in names:
        pos[k] += (real_c[k] - pos[k]) * 0.002
DELTA = {k: pos[k] - real_c[k] for k in names}
R_WARP = 320.0
C_POS = np.array([pos[k] for k in names]); C_DEL = np.array([DELTA[k] for k in names]); C_HALF = np.array([half[k] for k in names])


def disp(w):
    """Displacement at warped points w (...,2): a city's own shift inside its square, fading to 0 away from all."""
    w = np.asarray(w, float)
    d = np.abs(w[..., None, :] - C_POS)                     # (..., n, 2)
    cheb = np.maximum(0, d.max(-1) - C_HALF)                # (..., n)
    g = np.exp(-(cheb / R_WARP) ** 2)
    num = (g[..., None] * C_DEL).sum(-2)
    return num / np.maximum(1.0, g.sum(-1))[..., None]


def to_world(r):
    r = np.asarray(r, float); w = r.copy()
    for _ in range(25):
        w = r + disp(w)
    return w


def to_real(w):
    return np.asarray(w) - disp(w)


# ---------------- heights: Terrarium z8 mosaic
Z = 8


def tile_xy(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / np.pi) / 2 * n
    return x, y


def mosaic(lat0, lat1, lon0, lon1):
    (xa, ya), (xb, yb) = tile_xy(lat1, lon0), tile_xy(lat0, lon1)
    tx0, ty0, tx1, ty1 = int(xa), int(ya), int(xb), int(yb)
    H = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            f = DATA / f"terrarium-{Z}-{tx}-{ty}.png"
            for attempt in range(6):
                if f.exists():
                    break
                try:
                    r = requests.get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png", timeout=60)
                    r.raise_for_status(); f.write_bytes(r.content)
                except requests.RequestException:
                    time.sleep(3 * (attempt + 1))
            a = np.asarray(Image.open(f).convert("RGB"), dtype=np.float64)
            H[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    def sample(lat, lon):
        x, y = tile_xy(lat, lon)
        px, py = (x - tx0) * 256 - 0.5, (y - ty0) * 256 - 0.5
        x0 = np.clip(np.floor(px).astype(int), 0, H.shape[1] - 2); y0 = np.clip(np.floor(py).astype(int), 0, H.shape[0] - 2)
        fx, fy = np.clip(px - x0, 0, 1), np.clip(py - y0, 0, 1)
        return (H[y0, x0] * (1 - fx) + H[y0, x0 + 1] * fx) * (1 - fy) + (H[y0 + 1, x0] * (1 - fx) + H[y0 + 1, x0 + 1] * fx) * fy
    return sample


# ---------------- vector data
def shapes(name, keep=lambda d, sh: True):
    r = shapefile.Reader(str(DATA / name / f"{name}.shp"), encoding="latin1")
    f = [x[0] for x in r.fields[1:]]
    for rec, sh in zip(r.iterRecords(), r.iterShapes()):
        d = dict(zip(f, rec))
        if keep(d, sh):
            yield d, sh


def parts(sh):
    idx = list(sh.parts) + [len(sh.points)]
    return [sh.points[idx[i]:idx[i + 1]] for i in range(len(idx) - 1)]


def simplify(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); d = b - a; L = float(np.hypot(*d)) or 1e-9
    P = np.array(pts[1:-1])
    dist = np.abs(d[1] * (P[:, 0] - a[0]) - d[0] * (P[:, 1] - a[1])) / L
    i = int(np.argmax(dist)) + 1
    if dist[i - 1] <= eps:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], eps)[:-1] + simplify(pts[i:], eps)


def wring(lonlat, eps):
    """Closed ring: simplify the two halves split at the point farthest from the start (plain Douglas-Peucker would
    collapse a ring whose first and last points are the same)."""
    ll = np.array(lonlat)
    w = [tuple(p) for p in to_world(proj(ll[:, 1], ll[:, 0]))]
    if len(w) > 1 and w[0] == w[-1]:
        w = w[:-1]
    if len(w) < 4:
        return [[round(float(x), 1), round(float(z), 1)] for x, z in w]
    far = max(range(len(w)), key=lambda i: math.hypot(w[i][0] - w[0][0], w[i][1] - w[0][1]))
    out = simplify(w[:far + 1], eps)[:-1] + simplify(w[far:] + [w[0]], eps)[:-1]
    return [[round(float(x), 1), round(float(z), 1)] for x, z in out]


def wline(lonlat, eps):
    ll = np.array(lonlat)
    w = to_world(proj(ll[:, 1], ll[:, 0]))
    return [[round(float(x), 1), round(float(z), 1)] for x, z in simplify([tuple(p) for p in w], eps)]


def main():
    t0 = time.time()
    # --- Germany outline (largest polygon of the country)
    de = next(sh for d, sh in shapes("ne_10m_admin_0_countries", lambda d, sh: d.get("ADM0_A3") == "DEU"))
    ring = max(parts(de), key=len)
    outline = wring(ring, 3)
    bb = (min(p[1] for p in ring) - 0.4, max(p[1] for p in ring) + 0.4, min(p[0] for p in ring) - 0.5, max(p[0] for p in ring) + 0.5)
    inbb = lambda sh: sh.bbox[0] < bb[3] and sh.bbox[2] > bb[2] and sh.bbox[1] < bb[1] and sh.bbox[3] > bb[0]
    xs, zs = [p[0] for p in outline], [p[1] for p in outline]
    x0, x1 = math.floor(min(xs) / STEP) * STEP - 600, math.ceil(max(xs) / STEP) * STEP + 600
    z0, z1 = math.floor(min(zs) / STEP) * STEP - 600, math.ceil(max(zs) / STEP) * STEP + 600
    nx, nz = (x1 - x0) // STEP + 1, (z1 - z0) // STEP + 1
    print(f"world {x1 - x0} x {z1 - z0} units, grid {nx} x {nz}", flush=True)

    # --- heights, vectorised row by row; the sea comes from Natural Earth's ocean (the elevation data alone can't tell the
    # marshes by Bremen and Hamburg, at or just below 0 m, from the North Sea)
    import shapely
    from shapely.geometry import shape as shp, box as sbox
    oc = shapefile.Reader(str(DATA / "ne_10m_ocean" / "ne_10m_ocean.shp"))
    ocean = shapely.intersection(shapely.unary_union([shp(s.__geo_interface__) for s in oc.shapes()]), sbox(bb[2] - 2, bb[0] - 2, bb[3] + 2, bb[1] + 2))
    shapely.prepare(ocean)
    sample = mosaic(bb[0] - 1, bb[1] + 1, bb[2] - 1, bb[3] + 1)
    grid = np.zeros((nz, nx), np.float32)
    X = x0 + np.arange(nx) * STEP
    for iz in range(nz):
        W = np.stack([X, np.full(nx, z0 + iz * STEP)], -1)
        la, lo = unproj(to_real(W))
        h = (np.maximum(sample(la, lo), -5) - REF_M) / VM
        sea = shapely.contains_xy(ocean, lo, la)
        grid[iz] = np.where(sea, np.minimum(h, -0.5), np.maximum(h, 0.06))
    print(f"  heights done ({time.time() - t0:.0f}s)", flush=True)

    cities = {}
    for k in names:
        tf = ROOT / "public" / "terrain" / f"{k}.json"
        base = json.loads(tf.read_text())["base_m"] if tf.exists() else float(sample(np.array(CITIES[k]["center"][0]), np.array(CITIES[k]["center"][1])))
        cities[k] = {"x": round(float(pos[k][0]), 1), "z": round(float(pos[k][1]), 1), "y": round((base - REF_M) / VM, 2),
                     "half": half[k], "moved_km": round(float(np.hypot(*DELTA[k])) / K, 1)}
    sights = {k: [round(float(v), 1) for v in to_world(proj(*ll))] for k, ll in SIGHTS.items()}

    def inside_city(p, pad=0):
        return any(max(abs(p[0] - c["x"]), abs(p[1] - c["z"])) <= c["half"] + pad for c in cities.values())

    # --- rivers
    rivers = []
    for src in ("ne_10m_rivers_lake_centerlines", "ne_10m_rivers_europe"):
        for d, sh in shapes(src, lambda d, sh: inbb(sh) and d.get("featurecla", "").startswith("River")):
            nm = d.get("name") or ""
            hw = RIVER_W.get(nm, 3 if (d.get("scalerank") or 9) >= 9 else 3.5)
            for part in parts(sh):
                line = wline(part, 2)
                run = []
                for p in line + [None]:
                    if p is not None and not inside_city(p, -4):
                        run.append(p)
                    else:
                        if len(run) >= 2:
                            rivers.append({"name": nm, "hw": hw, "line": run})
                        run = []
    lakes = []
    for src in ("ne_10m_lakes", "ne_10m_lakes_europe"):
        for d, sh in shapes(src, lambda d, sh: inbb(sh)):
            for part in parts(sh):
                r = wring(part, 2)
                if len(r) >= 3 and abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2 > 200:
                    lakes.append({"name": d.get("name") or "", "ring": r})
    motorways = []
    for d, sh in shapes("ne_10m_roads", lambda d, sh: inbb(sh) and d.get("type") == "Major Highway"):
        for part in parts(sh):
            line = wline(part, 2.5)
            if len(line) >= 2:
                motorways.append({"ref": d.get("name") or "", "line": line})
    print(f"  rivers {len(rivers)}, lakes {len(lakes)}, motorways {len(motorways)} ({time.time() - t0:.0f}s)", flush=True)

    # --- link roads: each city's edge to its nearest motorway stretches (two directions); sights too
    mp = np.array([p for m in motorways for p in m["line"]])
    mp = mp[[not inside_city(p, 20) for p in mp]]
    links = []
    for k, c in cities.items():
        cxz = np.array([c["x"], c["z"]]); d = np.hypot(*(mp - cxz).T)
        order = np.argsort(d)
        firsts = []
        for i in order[:4000]:
            q = mp[i]; a = math.atan2(q[1] - c["z"], q[0] - c["x"])
            if all(abs((a - b + math.pi) % (2 * math.pi) - math.pi) > math.pi / 2 for b in firsts):
                firsts.append(a)
                t = c["half"] / max(abs(math.cos(a)), abs(math.sin(a)))
                edge = [round(c["x"] + math.cos(a) * (t - 1), 1), round(c["z"] + math.sin(a) * (t - 1), 1)]
                links.append({"city": k, "line": [edge, [round(float(q[0]), 1), round(float(q[1]), 1)]]})
                if len(firsts) == 2:
                    break
    for k, s in sights.items():
        d = np.hypot(*(mp - np.array(s)).T); i = int(np.argmin(d))
        if d[i] < 1600:
            links.append({"sight": k, "line": [s, [round(float(mp[i][0]), 1), round(float(mp[i][1]), 1)]]})

    # --- towns (GeoNames, Germany, 15,000+)
    towns = []
    for line in (DATA / "cities15000.txt").read_text(encoding="utf-8").splitlines():
        f = line.split("\t")
        if f[8] != "DE":
            continue
        p = to_world(proj(float(f[4]), float(f[5])))
        if inside_city(p, 120):
            continue
        pop = int(f[14] or 0)
        towns.append({"name": f[1], "x": round(float(p[0]), 1), "z": round(float(p[1]), 1), "big": pop >= 100000, "pop": pop})
    print(f"  towns {len(towns)}", flush=True)

    out = {"note": "One Germany: 20 units per km between cities, city maps whole (1 unit = 2.2 m). Heights: world units, 1 = 12 m, 0 = sea level. "
                   "Terrain Tiles (Mapzen/AWS: SRTM, EU-DEM...); Natural Earth (public domain); GeoNames (CC BY 4.0); city maps (c) OpenStreetMap contributors, ODbL.",
           "K": K, "vm": VM, "ref_m": REF_M, "city_half": 296,
           "grid": {"x0": x0, "z0": z0, "nx": nx, "nz": nz, "step": STEP,
                    "h16": base64.b64encode(np.round(grid * 10).clip(-32000, 32000).astype("<i2").tobytes()).decode()},
           "cities": cities, "sights": sights, "outline": outline, "rivers": rivers, "lakes": lakes,
           "motorways": motorways, "links": links, "towns": towns}
    path = ROOT / "public" / "world" / "world.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"world.json {path.stat().st_size // 1024} KB in {time.time() - t0:.0f}s; moved (km): "
          + ", ".join(f"{k} {v['moved_km']}" for k, v in cities.items() if v["moved_km"] > 0.5), flush=True)


if __name__ == "__main__":
    main()
