"""public/terrain/<city>.json: real ground heights for every city map, from the Bavarian survey's bare-earth terrain model
(DGM1: 1 m grid, no buildings or trees; open data, CC BY 4.0, Bayerische Vermessungsverwaltung, www.geodaten.bayern.de).

The game map is a square of ±296 units around the city centre (1 unit = 2.2 m, see build_cities.py). This samples it
every 4 units (8.8 m, averaging the 1 m cells around each point) and stores metres above the river's water level (or,
without a river, above the low ground), so the game can scale them the same way it scales the map.

Also the real water (OSM river/lake areas with their islands, plus river and canal lines where no area is mapped),
each with its water level from the DGM, and the road and footpath bridges that cross it.
Map data (c) OpenStreetMap contributors, ODbL.

Usage: python3 scripts/build_terrain.py [city ...]   (all when none given). Needs numpy, tifffile, imagecodecs, requests.
Tiles are cached in $DGM_CACHE (default .cache/dgm).
"""
import base64
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import requests
import tifffile

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("DGM_CACHE", ROOT / ".cache" / "dgm"))
M_PER_UNIT = 2.2
STEP, HALF = 4, 296
N = HALF * 2 // STEP + 1
CENTERS = {"bamberg": (49.89168, 10.88681)}  # Bamberg's map predates cities.json: its origin is the Altes Rathaus centroid (fitted to the OSM water)
MAPS = {"bamberg": ROOT / "public" / "bamberg-map-data.json"}


def utm32(lat, lon):
    """WGS84/ETRS89 -> UTM zone 32N (Krüger series, mm-accurate here)."""
    a, f = 6378137.0, 1 / 298.257222101
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64)
    al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    phi, lam = math.radians(lat), math.radians(lon - 9)
    e = math.sqrt(f * (2 - f))
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi, eta = math.atan2(t, math.cos(lam)), math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    x = eta + sum(al[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(3))
    y = xi + sum(al[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(3))
    return 500000 + 0.9996 * A * x, 0.9996 * A * y


_tiles = {}


def tile(e_km, n_km):
    key = (e_km, n_km)
    if key not in _tiles:
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"{e_km}_{n_km}.tif"
        if not path.exists():
            r = requests.get(f"https://download1.bayernwolke.de/a/dgm/dgm1/{e_km}_{n_km}.tif", timeout=120)
            r.raise_for_status()
            path.write_bytes(r.content)
        a = tifffile.imread(path).astype(np.float32)
        a[a < -1000] = np.nan
        _tiles[key] = a  # row 0 = north edge (n_km + 1) km
    return _tiles[key]


def height(E, N_, r=4):
    """Mean ground height in a (2r+1) m square around (E, N)."""
    vals = []
    for dE in (-r, r):
        for dN in (-r, r):
            tile(int((E + dE) // 1000), int((N_ + dN) // 1000))
    e_km, n_km = int(E // 1000), int(N_ // 1000)
    t = tile(e_km, n_km)
    col, row = int(E - e_km * 1000), int((n_km + 1) * 1000 - N_)
    if r <= col < 1000 - r and r <= row < 1000 - r:
        return float(np.nanmean(t[row - r:row + r + 1, col - r:col + r + 1]))
    for dE in range(-r, r + 1, 2):  # window crosses a tile edge: sample point by point
        for dN in range(-r, r + 1, 2):
            e2, n2 = E + dE, N_ + dN
            t2 = tile(int(e2 // 1000), int(n2 // 1000))
            vals.append(t2[min(999, int((int(n2 // 1000) + 1) * 1000 - n2)), min(999, int(e2 - int(e2 // 1000) * 1000))])
    return float(np.nanmean(vals))


def overpass(ql):
    import hashlib
    cached = CACHE / f"overpass-{hashlib.sha1(ql.encode()).hexdigest()[:16]}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    for attempt in range(6):
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": ql}, timeout=180,
                          headers={"User-Agent": "little-bamberg/1.0 (personal game; map data from OpenStreetMap)"})
        if r.ok:
            CACHE.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(r.json()["elements"]))
            return r.json()["elements"]
        time.sleep(20 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {r.status_code}")


def join_rings(segs):
    """Join way geometries (lists of points) into closed rings."""
    segs, rings = [list(s) for s in segs if len(s) >= 2], []
    while segs:
        ring = segs.pop(0)
        while ring[0] != ring[-1]:
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]
                elif s[-1] == ring[-1]: ring += s[::-1][1:]
                else: continue
                segs.pop(i)
                break
            else:
                break  # open ring (members missing from the download): unusable, closing it would cut across the map
        if ring[0] == ring[-1]:
            rings.append(ring[:-1])
    return [r for r in rings if len(r) >= 3]


def clip(ring, h):
    """Sutherland-Hodgman clip of a ring to the square |x|,|z| <= h."""
    for axis, sign in ((0, 1), (0, -1), (1, 1), (1, -1)):
        inside = lambda p: sign * p[axis] <= h
        out = []
        for i, p in enumerate(ring):
            q = ring[i - 1]
            if inside(p) != inside(q):
                t = (h - sign * q[axis]) / (sign * p[axis] - sign * q[axis])
                out.append([round(q[0] + (p[0] - q[0]) * t, 2), round(q[1] + (p[1] - q[1]) * t, 2)])
            if inside(p):
                out.append(p)
        ring = out
        if not ring:
            break
    return ring


def in_ring(x, z, ring):
    c = False
    for i in range(len(ring)):
        (x1, z1), (x2, z2) = ring[i], ring[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c


def water_and_bridges(lat0, lon0, to_utm, base):
    F = 1 / M_PER_UNIT
    kx, kz = 111320 * math.cos(math.radians(lat0)) * F, 110574 * F
    P = lambda g: [round((g["lon"] - lon0) * kx, 2), round(-(g["lat"] - lat0) * kz, 2)]
    dlat, dlon = (HALF + 40) / kz, (HALF + 40) / kx
    bb = f"{lat0 - dlat},{lon0 - dlon},{lat0 + dlat},{lon0 + dlon}"
    els = overpass(f'[out:json][timeout:150];(way["natural"="water"]({bb});relation["natural"="water"]({bb});'
                   f'way["waterway"="riverbank"]({bb});relation["waterway"="riverbank"]({bb});'
                   f'way["waterway"~"^(river|canal)$"]({bb});way["bridge"]["highway"]({bb}););out geom;')
    areas = []  # (outer rings, inner rings)
    lines, bridge_ways = [], []
    for e in els:
        t = e.get("tags", {})
        if e["type"] == "way" and "bridge" in t and "highway" in t and t.get("bridge") not in ("no",):
            bridge_ways.append(e)
        elif e["type"] == "way" and t.get("waterway") in ("river", "canal") and "natural" not in t:
            lines.append((t["waterway"], [P(g) for g in e["geometry"]]))
        elif e["type"] == "way" and len(e.get("geometry", [])) >= 4 and e["geometry"][0] == e["geometry"][-1]:
            areas.append(([[P(g) for g in e["geometry"][:-1]]], []))
        elif e["type"] == "relation":
            outer = join_rings([[P(g) for g in m["geometry"]] for m in e["members"] if m.get("role") != "inner" and m.get("geometry")])
            inner = join_rings([[P(g) for g in m["geometry"]] for m in e["members"] if m.get("role") == "inner" and m.get("geometry")])
            areas.append((outer, inner))
    water = []

    def level_of(rings, holes):
        pts = [(x, z) for x in range(-HALF, HALF + 1, 4) for z in range(-HALF, HALF + 1, 4)
               if any(in_ring(x, z, r) for r in rings) and not any(in_ring(x, z, r) for r in holes)]
        if not pts:
            pts = [(sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)) for r in rings]
        pts = pts[:: max(1, len(pts) // 300)]
        return round(float(np.nanpercentile([height(*to_utm(x, z), r=2) for x, z in pts], 25)) - base, 2)

    for outer, inner in areas:
        rings = [c for c in (clip(r, HALF) for r in outer) if len(c) >= 3]
        holes = [c for c in (clip(r, HALF) for r in inner) if len(c) >= 3]
        area = lambda r: abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2
        # a ring that swallows most of the map is an outline clipped around the whole square, not water we can draw
        rings = [r for r in rings if 30 < area(r) < 0.5 * (2 * HALF) ** 2]
        if rings:
            water.append({"rings": rings, "holes": holes, "level": level_of(rings, holes)})
    # river/canal centre lines where no area is mapped: a band of typical width
    in_area = lambda x, z: any(any(in_ring(x, z, r) for r in w.get("rings", [])) for w in water)
    for kind, line in lines:
        run = []
        for p in line + [None]:
            if p is not None and abs(p[0]) <= HALF + 10 and abs(p[1]) <= HALF + 10 and not in_area(*p):
                run.append(p)
            elif len(run) >= 2:
                water.append({"line": run, "half_w": 5 if kind == "river" else 7, "level": round(float(np.nanpercentile([height(*to_utm(x, z), r=2) for x, z in run], 25)) - base, 2)})
                run = []
            else:
                run = []
    # bridges: highway ways marked bridge that cross water
    def wet(x, z):
        for w in water:
            if "rings" in w and any(in_ring(x, z, r) for r in w["rings"]) and not any(in_ring(x, z, r) for r in w["holes"]):
                return True
            if "line" in w and any(math.hypot(x - px, z - pz) < w["half_w"] + 1 for px, pz in w["line"]):
                return True
        return False
    bridges = []
    for e in bridge_ways:
        line = [P(g) for g in e["geometry"]]
        if not all(abs(x) <= HALF and abs(z) <= HALF for x, z in line):
            continue
        samples = [(line[i][0] + (line[i + 1][0] - line[i][0]) * t / 6, line[i][1] + (line[i + 1][1] - line[i][1]) * t / 6)
                   for i in range(len(line) - 1) for t in range(7)]
        if not any(wet(x, z) for x, z in samples):
            continue
        hw = e["tags"]["highway"]
        w = 3.2 if hw in ("primary", "secondary", "tertiary", "trunk") else 2.4 if hw in ("residential", "unclassified", "living_street", "pedestrian", "service") else 1.5
        bridges.append({"line": line, "half_w": round(w / 2 + 0.3, 2), "name": e["tags"].get("name", "")})
    return water, bridges


def build(cid, lat0, lon0, map_path):
    F = 1 / M_PER_UNIT
    kx, kz = 111320 * math.cos(math.radians(lat0)) * F, 110574 * F
    to_utm = lambda x, z: utm32(lat0 - z / kz, lon0 + x / kx)
    grid = np.zeros((N, N), np.float32)  # [row = z index][col = x index]
    for iz in range(N):
        for ix in range(N):
            grid[iz, ix] = height(*to_utm(-HALF + ix * STEP, -HALF + iz * STEP))
    river = json.loads(map_path.read_text()).get("river_polyline") or []
    on_river = [height(*to_utm(x, z), r=6) for x, z in river if abs(x) < HALF and abs(z) < HALF]
    base = float(np.median(on_river)) if on_river else float(np.nanpercentile(grid, 10))
    rel = np.round(grid - base, 1)
    water, bridges = water_and_bridges(lat0, lon0, to_utm, base)
    out = {"note": "Ground height in decimetres (h16: int16 little-endian, base64, rows along x, z rising) above the water level (or low ground), sampled every step units over +-half. "
                   "Source: DGM1, Bayerische Vermessungsverwaltung, www.geodaten.bayern.de, CC BY 4.0.",
           "step": STEP, "half": HALF, "n": N, "m_per_unit": M_PER_UNIT, "base_m": round(base, 1),
           # int16 decimetres, little-endian, row by row (z from -half, x from -half), base64
           "h16": base64.b64encode(np.nan_to_num(rel * 10).astype("<i2").tobytes()).decode(),
           "water": water, "bridges": bridges}
    path = ROOT / "public" / "terrain" / f"{cid}.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{cid}: base {base:.1f} m, relief {float(np.nanmin(rel)):.1f} .. {float(np.nanmax(rel)):.1f} m, "
          f"{len(water)} water, {len(bridges)} bridges, {len(_tiles)} tiles loaded, {path.stat().st_size // 1024} KB", flush=True)


if __name__ == "__main__":
    cities = json.loads((ROOT / "scripts" / "cities.json").read_text())
    ids = sys.argv[1:] or ["bamberg", *cities]
    for cid in ids:
        lat0, lon0 = CENTERS.get(cid) or cities[cid]["center"]
        build(cid, lat0, lon0, MAPS.get(cid, ROOT / "public" / "maps" / f"{cid}.json"))
        _tiles.clear()
