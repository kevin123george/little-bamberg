"""public/world/world.json: the one big map -- all seven cities on a single compressed Bavaria you can walk and drive across.

Layout: cities at their real directions, 20 game units per real km between them ("short hops": Erlangen->Nuernberg ~20 s by
truck, Muenchen->Nuernberg ~2-3 min), each city's own map (1 unit = 2.2 m, +-296 units) placed whole. Where real cities
are closer than their maps are wide (Erlangen/Nuernberg), they are pushed apart; a smooth warp moves the countryside with
them, so the rivers, motorways and towns still meet each city where they really do.

Countryside (real, coarse): heights from the AWS Terrain Tiles (Terrarium, Mapzen; SRTM/EU-DEM and others), 1 unit =
12 m vertically; rivers, big lakes, motorways and towns (place=town/city) from OpenStreetMap; link roads from each city's
edge to its nearest motorway. The Bavarian sights (Neuschwanstein, Zugspitze, ...) stand at their real places.

Usage: python3 scripts/build_world.py   (needs numpy, pillow, requests; caches downloads in .cache/world)
Map data (c) OpenStreetMap contributors, ODbL. Terrain Tiles: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
"""
import base64
import hashlib
import io
import json
import math
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "world"
LAT0, LON0 = 48.92, 11.41
K = 20.0                  # game units per real km between the cities
VM = 12.0                 # real metres per game unit, vertically, in the countryside
REF_M = 300.0             # height 0 in the world
CITY_HALF = 296
MIN_CITY_GAP = 800        # centre-to-centre, so two city maps never touch
STEP = 16                 # countryside height grid spacing (the game refines to 8)
KX, KZ = 111.32 * math.cos(math.radians(LAT0)) * K, 110.574 * K
UA = {"User-Agent": "little-bamberg/1.0 (personal game; map data from OpenStreetMap)"}

CITIES = {"bamberg": (49.89168, 10.88681), "muenchen": (48.1374, 11.5755), "nuernberg": (49.45369, 11.07734),
          "wuerzburg": (49.7932, 9.9315), "regensburg": (49.0195, 12.0960), "erlangen": (49.5970, 11.0045),
          "augsburg": (48.3689, 10.8990)}
SIGHTS = {"neuschwanstein": (47.5575, 10.7495), "zugspitze": (47.4212, 10.9863), "koenigssee": (47.5444, 12.9720),
          "walhalla": (49.0311, 12.2240), "rothenburg": (49.3773, 10.1790), "herrenchiemsee": (47.8604, 12.4023),
          "passau": (48.5743, 13.4655)}
RIVERS = {"Donau": 7, "Main": 6, "Inn": 5, "Isar": 4, "Lech": 4, "Regnitz": 3.5, "Altmühl": 3, "Naab": 3, "Iller": 3.5,
          "Salzach": 4, "Regen": 3, "Pegnitz": 2.5, "Wörnitz": 2.5, "Fränkische Saale": 2.5, "Amper": 2.5, "Vils": 2.5}
LAKES = ["Chiemsee", "Starnberger See", "Ammersee", "Tegernsee", "Königssee", "Walchensee", "Kochelsee", "Staffelsee",
         "Forggensee", "Großer Brombachsee", "Schliersee", "Waginger See", "Simssee", "Großer Alpsee", "Obersee", "Hopfensee",
         "Wörthsee", "Pilsensee", "Altmühlsee", "Rothsee", "Riegsee"]


def proj(lat, lon):
    return np.array([(lon - LON0) * KX, -(lat - LAT0) * KZ])


def unproj(p):
    return LAT0 - p[1] / KZ, LON0 + p[0] / KX


# ---------------- layout: push overlapping cities apart, then a smooth warp that carries the countryside along
real_c = {k: proj(*v) for k, v in CITIES.items()}
pos = {k: v.copy() for k, v in real_c.items()}
for it in range(400):
    for a in pos:
        for b in pos:
            if a >= b:
                continue
            d = pos[b] - pos[a]
            L = float(np.hypot(*d)) or 1e-6
            if L < MIN_CITY_GAP:
                push = (MIN_CITY_GAP - L) / 2 * d / L
                pos[a] -= push * 0.5; pos[b] += push * 0.5
    for k in pos:  # a weak pull back to the real place
        pos[k] += (real_c[k] - pos[k]) * 0.002
DELTA = {k: pos[k] - real_c[k] for k in pos}
R_WARP = 300.0


def disp(w):
    """Displacement at warped point w: exactly a city's shift inside its square, fading to 0 away from all cities."""
    num, den = np.zeros(2), 0.0
    for k, c in pos.items():
        dx = max(0.0, max(abs(w[0] - c[0]), abs(w[1] - c[1])) - CITY_HALF)
        g = math.exp(-(dx / R_WARP) ** 2)
        num += g * DELTA[k]; den += g
    return num / max(1.0, den)


def to_world(r):
    """Real (projected) point -> warped world point: solve w = r + disp(w)."""
    w = np.array(r, float)
    for _ in range(25):
        w = np.array(r) + disp(w)
    return w


def to_real(w):
    return np.array(w) - disp(np.array(w))


# ---------------- elevation: Terrarium tiles, zoom 9 (~200 m per pixel here)
Z = 9


def tile_xy(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


_tiles = {}


def tile(tx, ty):
    if (tx, ty) not in _tiles:
        CACHE.mkdir(parents=True, exist_ok=True)
        p = CACHE / f"terrarium-{Z}-{tx}-{ty}.png"
        if not p.exists():
            r = requests.get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png", timeout=60)
            r.raise_for_status(); p.write_bytes(r.content)
        a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
        _tiles[(tx, ty)] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    return _tiles[(tx, ty)]


def elevation(lat, lon):
    x, y = tile_xy(lat, lon)
    px, py = x * 256 - 0.5, y * 256 - 0.5
    x0, y0 = math.floor(px), math.floor(py)
    fx, fy = px - x0, py - y0
    def at(ix, iy):
        return tile(ix // 256, iy // 256)[iy % 256, ix % 256]
    return ((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy)


# ---------------- OpenStreetMap
def overpass(ql):
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"overpass-{hashlib.sha1(ql.encode()).hexdigest()[:16]}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    mirrors = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
               "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
    for attempt in range(12):
        try:
            r = requests.post(mirrors[attempt % len(mirrors)], data={"data": ql}, timeout=400, headers=UA)
        except requests.RequestException as e:
            print(f"  overpass {e.__class__.__name__}, next mirror", flush=True); continue
        if r.ok and r.headers.get("content-type", "").startswith("application/json"):
            els = r.json()["elements"]
            cached.write_text(json.dumps(els))
            return els
        print(f"  overpass {r.status_code} at {mirrors[attempt % len(mirrors)].split('/')[2]}, next", flush=True)
        time.sleep(10 * (attempt // len(mirrors) + 1))
    raise RuntimeError("Overpass failed")


BY = 'area["ISO3166-2"="DE-BY"][admin_level=4]->.by;'


def simplify(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    d = b - a; L = float(np.hypot(*d)) or 1e-9
    dists = [abs(d[1] * (p[0] - a[0]) - d[0] * (p[1] - a[1])) / L for p in pts[1:-1]]
    i = int(np.argmax(dists)) + 1
    if dists[i - 1] <= eps:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], eps)[:-1] + simplify(pts[i:], eps)


def chain(segs):
    segs = [list(s) for s in segs if len(s) >= 2]
    out = []
    while segs:
        line = segs.pop(0)
        grew = True
        while grew:
            grew = False
            for i, s in enumerate(segs):
                if s[0] == line[-1]: line += s[1:]
                elif s[-1] == line[-1]: line += s[::-1][1:]
                elif s[-1] == line[0]: line = s[:-1] + line
                elif s[0] == line[0]: line = s[::-1][:-1] + line
                else: continue
                segs.pop(i); grew = True; break
        out.append(line)
    return out


def wring(geom, eps=1.5):
    """Closed OSM outline -> world ring: simplify the two halves split at the point farthest from the start
    (plain Douglas-Peucker collapses a ring whose first and last points are the same)."""
    pts = [tuple(np.round(to_world(proj(g["lat"], g["lon"])), 1)) for g in geom if g]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 4:
        return [list(p) for p in pts]
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    a = simplify(pts[:far + 1], eps); b = simplify(pts[far:] + [pts[0]], eps)
    return [list(p) for p in a[:-1] + b[:-1]]


def wline(geom, eps=2.0):
    """OSM geometry -> world polyline (warped units), simplified."""
    pts = [tuple(np.round(to_world(proj(g["lat"], g["lon"])), 1)) for g in geom if g]
    return [list(p) for p in simplify(pts, eps)]


def inside_city(p, pad=0):
    return any(max(abs(p[0] - c[0]), abs(p[1] - c[1])) <= CITY_HALF + pad for c in pos.values())


def main():
    t0 = time.time()
    # --- bounds from Bavaria's outline (the game's bavaria.json), warped
    outline_ll = json.loads((ROOT / "public" / "bavaria.json").read_text())
    outline = [list(np.round(to_world(proj(la, lo)), 1)) for la, lo in outline_ll]
    xs, zs = [p[0] for p in outline], [p[1] for p in outline]
    x0, x1 = math.floor(min(xs) / STEP) * STEP - 320, math.ceil(max(xs) / STEP) * STEP + 320
    z0, z1 = math.floor(min(zs) / STEP) * STEP - 320, math.ceil(max(zs) / STEP) * STEP + 320
    nx, nz = (x1 - x0) // STEP + 1, (z1 - z0) // STEP + 1
    print(f"world {x1 - x0} x {z1 - z0} units, grid {nx} x {nz}", flush=True)

    # --- countryside heights (world units, 0 = 300 m)
    grid = np.zeros((nz, nx), np.float32)
    for iz in range(nz):
        for ix in range(nx):
            w = np.array([x0 + ix * STEP, z0 + iz * STEP], float)
            la, lo = unproj(to_real(w))
            grid[iz, ix] = (elevation(la, lo) - REF_M) / VM
        if iz % 100 == 0:
            print(f"  heights row {iz}/{nz} ({time.time() - t0:.0f}s)", flush=True)

    # --- cities and sights
    cities = {}
    for k in CITIES:
        terr = json.loads((ROOT / "public" / "terrain" / f"{k}.json").read_text())
        cities[k] = {"x": round(float(pos[k][0]), 1), "z": round(float(pos[k][1]), 1),
                     "y": round((terr["base_m"] - REF_M) / VM, 2), "moved_km": round(float(np.hypot(*DELTA[k])) / K, 1)}
    sights = {k: [round(float(v), 1) for v in to_world(proj(*ll))] for k, ll in SIGHTS.items()}

    # --- rivers
    bb = f"{min(la for la, lo in outline_ll) - 0.05},{min(lo for la, lo in outline_ll) - 0.05},{max(la for la, lo in outline_ll) + 0.05},{max(lo for la, lo in outline_ll) + 0.05}"
    names = "|".join(RIVERS)
    els = overpass(f'[out:json][timeout:300];way["waterway"="river"]["name"~"^({names})$"]({bb});out geom;')
    by_name = {}
    for e in els:
        by_name.setdefault(e["tags"]["name"], []).append([(g["lat"], g["lon"]) for g in e.get("geometry", [])])
    rivers = []
    for name, segs in by_name.items():
        for line in chain(segs):
            pts = wline([{"lat": a, "lon": b} for a, b in line], 1.5)
            # cut out the parts inside a city map: the city draws its own water there
            run = []
            for p in pts + [None]:
                if p is not None and not inside_city(p, -4):
                    run.append(p)
                else:
                    if len(run) >= 2:
                        rivers.append({"name": name, "hw": RIVERS[name], "line": run})
                    run = [] if p is None else []
    print(f"  rivers: {len(rivers)} runs", flush=True)

    # --- lakes
    lnames = "|".join(LAKES)
    els = overpass(f'[out:json][timeout:300];(way["natural"="water"]["name"~"^({lnames})$"]({bb});relation["natural"="water"]["name"~"^({lnames})$"]({bb}););out geom;')
    lakes, seen = [], set()
    for e in els:
        nm = e["tags"].get("name")
        if e["type"] == "way":
            rings = [e.get("geometry", [])]
        else:
            rings = [r for r in chain([[(g["lat"], g["lon"]) for g in m["geometry"]] for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")])]
            rings = [[{"lat": a, "lon": b} for a, b in r] for r in rings]
        for r in rings:
            ring = wring(r, 1.5)
            if len(ring) < 3:
                continue
            area = abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2
            key = (nm, round(ring[0][0]), round(ring[0][1]))
            if area > 40 and key not in seen:
                seen.add(key)
                lakes.append({"name": nm, "ring": ring[:-1] if ring[0] == ring[-1] else ring})
    print(f"  lakes: {len(lakes)}", flush=True)

    # --- motorways, fetched in tiles (one query for all of Bavaria times out)
    la0, lo0, la1, lo1 = [float(v) for v in bb.split(",")]
    mways = []
    T = 8  # small tiles, geometry only: bigger queries time out on the public servers
    for i in range(T):
        for j in range(T):
            tb = f"{la0 + (la1 - la0) * i / T},{lo0 + (lo1 - lo0) * j / T},{la0 + (la1 - la0) * (i + 1) / T},{lo0 + (lo1 - lo0) * (j + 1) / T}"
            mways += overpass(f'[out:json][timeout:120];way["highway"="motorway"]({tb});out skel geom qt;')
    by_ref = {"A": [[(g["lat"], g["lon"]) for g in e.get("geometry", [])] for e in {e["id"]: e for e in mways}.values()]}
    motorways = []
    kept_pts = []
    for ref, segs in by_ref.items():
        for line in chain(segs):
            pts = wline([{"lat": a, "lon": b} for a, b in line], 2.5)
            if len(pts) < 2:
                continue
            # both carriageways are separate OSM ways ~30 m apart: keep one (skip lines already covered)
            if kept_pts and sum(1 for p in pts if min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in kept_pts[-4000:]) < 4) > 0.6 * len(pts):
                continue
            kept_pts += pts
            motorways.append({"ref": ref, "line": pts})
    print(f"  motorways: {len(motorways)} lines", flush=True)

    # --- link roads: from each city's edge (toward its nearest motorway) and from each sight to the nearest motorway
    mpts = [(p, m["ref"]) for m in motorways for p in m["line"]]
    links = []
    def nearest_m(p, exclude_city=True):
        best = None
        for q, _ in mpts:
            if exclude_city and inside_city(q, 20):
                continue
            d = math.hypot(q[0] - p[0], q[1] - p[1])
            if best is None or d < best[0]:
                best = (d, q)
        return best
    for k, c in cities.items():
        for side in range(2):  # two links per city, toward the two nearest motorway stretches in different directions
            b = nearest_m([c["x"], c["z"]])
            if b is None:
                continue
            q = b[1]
            if side == 1:  # second link: nearest motorway point more than 90 degrees away from the first
                a0 = math.atan2(q[1] - c["z"], q[0] - c["x"])
                cands = [(math.hypot(p[0] - c["x"], p[1] - c["z"]), p) for p, _ in mpts if not inside_city(p, 20)
                         and abs((math.atan2(p[1] - c["z"], p[0] - c["x"]) - a0 + math.pi) % (2 * math.pi) - math.pi) > math.pi / 2]
                if not cands:
                    continue
                q = min(cands)[1]
            ang = math.atan2(q[1] - c["z"], q[0] - c["x"])
            t = CITY_HALF / max(abs(math.cos(ang)), abs(math.sin(ang)))
            edge = [c["x"] + math.cos(ang) * (t - 1), c["z"] + math.sin(ang) * (t - 1)]
            links.append({"city": k, "line": [[round(edge[0], 1), round(edge[1], 1)], [round(q[0], 1), round(q[1], 1)]]})
    for k, s in sights.items():
        b = nearest_m(s)
        if b and b[0] < 1600:
            links.append({"sight": k, "line": [s, [round(b[1][0], 1), round(b[1][1], 1)]]})

    # --- towns and smaller cities (not our seven)
    els = overpass(f'[out:json][timeout:300];{BY}node(area.by)["place"~"^(town|city)$"];out;')
    towns = []
    for e in els:
        p = to_world(proj(e["lat"], e["lon"]))
        if inside_city(p, 60):
            continue
        pop = int(str(e["tags"].get("population", "5000")).replace(".", "").split()[0] or 5000) if str(e["tags"].get("population", "")).replace(".", "").split() and str(e["tags"].get("population", "")).replace(".", "").split()[0].isdigit() else 5000
        towns.append({"name": e["tags"].get("name", ""), "x": round(float(p[0]), 1), "z": round(float(p[1]), 1),
                      "big": e["tags"]["place"] == "city", "pop": pop})
    print(f"  towns: {len(towns)}", flush=True)

    out = {"note": "One Bavaria: 20 units per km between cities, city maps whole (1 unit = 2.2 m). Heights: world units, 1 = 12 m, 0 = 300 m. "
                   "Map data (c) OpenStreetMap contributors, ODbL; heights: Terrain Tiles (Mapzen/AWS, SRTM, EU-DEM...).",
           "K": K, "vm": VM, "ref_m": REF_M, "city_half": CITY_HALF,
           "grid": {"x0": x0, "z0": z0, "nx": nx, "nz": nz, "step": STEP,
                    "h16": base64.b64encode(np.round(grid * 10).astype("<i2").tobytes()).decode()},
           "cities": cities, "sights": sights, "outline": outline, "rivers": rivers, "lakes": lakes,
           "motorways": motorways, "links": links, "towns": towns}
    path = ROOT / "public" / "world" / "world.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"world.json {path.stat().st_size // 1024} KB in {time.time() - t0:.0f}s; cities moved (km): "
          + ", ".join(f"{k} {v['moved_km']}" for k, v in cities.items()), flush=True)


if __name__ == "__main__":
    main()
