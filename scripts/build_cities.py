"""Build public/maps/<city>.json for every city in scripts/cities.json from OpenStreetMap (Overpass API).

Same format and scale as the original public/bamberg-map-data.json: local metres compressed by 1/2.2, origin = the
city's centre point, x = east, z = south (north is -z). Plus a "meta" block with the city's names, landmark texts
(ml/en), points and kinds, river half-width and hills, so the game needs no per-city code.

Usage: python3 scripts/build_cities.py [city ...]   (all cities when none given). Needs `requests`.
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
F = 1 / 2.2                    # compression, same as Bamberg
HALF_REAL = 290 / F            # ~640 m each way: the game's map half-extent
UA = {"User-Agent": "little-bamberg/1.0 (personal game; map data from OpenStreetMap)"}
MAX_BUILDINGS = 420
ROAD_WIDE = {"primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"}
ROAD_ALL = ROAD_WIDE | {"residential", "unclassified", "living_street", "pedestrian"}


def overpass(ql):
    for attempt in range(4):
        r = requests.post("https://overpass-api.de/api/interpreter", data={"data": ql}, headers=UA, timeout=180)
        if r.ok:
            return r.json()["elements"]
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {r.status_code} {r.text[:200]}")


class Proj:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320 * math.cos(math.radians(lat0)) * F
        self.kz = 110574 * F

    def __call__(self, lat, lon):
        return [round((lon - self.lon0) * self.kx, 2), round(-(lat - self.lat0) * self.kz, 2)]


def simplify(pts, eps):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    (x1, z1), (x2, z2) = pts[0], pts[-1]
    dx, dz = x2 - x1, z2 - z1
    L = math.hypot(dx, dz) or 1e-9
    best, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x, z = pts[i]
        d = abs(dz * x - dx * z + x2 * z1 - z2 * x1) / L
        if d > best:
            best, idx = d, i
    if best <= eps:
        return [pts[0], pts[-1]]
    return simplify(pts[:idx + 1], eps)[:-1] + simplify(pts[idx:], eps)


def simplify_ring(poly, eps):
    """Simplify a closed outline: split at the point farthest from the first one, simplify both halves."""
    if len(poly) <= 4:
        return poly
    far = max(range(len(poly)), key=lambda i: math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]))
    a = simplify(poly[:far + 1], eps)
    b = simplify(poly[far:] + [poly[0]], eps)
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else poly


def area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2


def centroid(poly):
    return [round(sum(p[0] for p in poly) / len(poly), 2), round(sum(p[1] for p in poly) / len(poly), 2)]


def ring(geom, proj):
    pts = [proj(g["lat"], g["lon"]) for g in geom]
    if len(pts) > 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def outer_ring(el, proj):
    if el["type"] == "way":
        return ring(el.get("geometry") or [], proj)
    if el["type"] == "relation":  # join the outer members into one ring (good enough for building outlines)
        pts = []
        for m in el.get("members", []):
            if m.get("role") in ("outer", "") and m.get("geometry"):
                seg = ring(m["geometry"], proj)
                if pts and seg and seg[-1] == pts[-1]:
                    seg = seg[::-1]
                pts += seg
        return pts
    return []


def inside(p, half=289):
    return abs(p[0]) <= half and abs(p[1]) <= half


def clip_line(line, half=289):
    """Split a polyline into the runs that stay inside the square map."""
    runs, cur = [], []
    for p in line:
        if inside(p, half):
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def chain(segments):
    """Join way segments that share endpoints into longer lines."""
    segs = [list(s) for s in segments if len(s) >= 2]
    out = []
    while segs:
        line = segs.pop(0)
        grew = True
        while grew:
            grew = False
            for i, s in enumerate(segs):
                if s[0] == line[-1]:
                    line += s[1:]
                elif s[-1] == line[-1]:
                    line += s[::-1][1:]
                elif s[-1] == line[0]:
                    line = s[:-1] + line
                elif s[0] == line[0]:
                    line = s[::-1][:-1] + line
                else:
                    continue
                segs.pop(i)
                grew = True
                break
        out.append(line)
    return out


def build(city_id, cfg):
    lat0, lon0 = cfg["center"]
    proj = Proj(lat0, lon0)
    dlat = HALF_REAL * 1.05 / 110574
    dlon = HALF_REAL * 1.05 / (111320 * math.cos(math.radians(lat0)))
    bbox = f"{lat0 - dlat},{lon0 - dlon},{lat0 + dlat},{lon0 + dlon}"
    river = cfg.get("river")
    lm_q = "".join(f'{ {"w": "way", "r": "relation", "n": "node"}[l["osm"][0]] }({l["osm"][1:]});' for l in cfg["landmarks"])
    ql = (f"[out:json][timeout:170];("
          f'way["building"]({bbox});relation["building"]["type"="multipolygon"]({bbox});'
          f'way["highway"~"^({"|".join(sorted(ROAD_ALL))})$"]({bbox});'
          + (f'way["waterway"="river"]["name"="{river["name"]}"]({bbox});' if river else "")
          + lm_q + ");out geom;")
    print(f"{city_id}: downloading…", flush=True)
    els = overpass(ql)
    by_id = {f'{e["type"][0]}{e["id"]}': e for e in els}

    # ---- landmarks
    landmarks, lm_polys = {}, []
    for l in cfg["landmarks"]:
        e = by_id.get(l["osm"])
        if not e:
            raise SystemExit(f"{city_id}: landmark {l['id']} ({l['osm']}) not in the download")
        if e["type"] == "node":
            landmarks[l["id"]] = {"center": proj(e["lat"], e["lon"])}
            continue
        poly = outer_ring(e, proj)
        if l["kind"] == "square" and e["type"] == "way" and (e.get("geometry") or [{}])[0] != (e.get("geometry") or [{}])[-1]:
            # a named street, not an area: just its middle point
            mid = poly[len(poly) // 2]
            landmarks[l["id"]] = {"center": mid}
            continue
        poly = simplify_ring(poly, 0.35)
        entry = {"footprint": poly, "center": centroid(poly)}
        landmarks[l["id"]] = entry
        lm_polys.append(poly)
    far = [k for k, v in landmarks.items() if not inside(v["center"], 280)]
    if far:
        raise SystemExit(f"{city_id}: landmarks outside the map: {far}")

    lm_ids = {int(l["osm"][1:]) for l in cfg["landmarks"]}

    # ---- buildings (scatter): simplified outlines, biggest + nearest first, capped for frame rate
    cands = []
    for e in els:
        if "building" not in e.get("tags", {}) or e["id"] in lm_ids or e["type"] not in ("way", "relation"):
            continue
        poly = outer_ring(e, proj)
        if len(poly) < 3 or not all(inside(p) for p in poly):
            continue
        poly = simplify_ring(poly, 0.45)
        if len(poly) < 3:
            continue
        a = area(poly)
        if a < 6 or a > 2600:  # sheds / whole blocks
            continue
        if len(poly) > 14:
            poly = simplify_ring(poly, 1.2)
        c = centroid(poly)
        if any(abs(c[0] - lc[0]) < 4 and abs(c[1] - lc[1]) < 4 for lc in (v["center"] for v in landmarks.values())):
            continue
        cands.append((math.hypot(*c) / (a ** 0.35), {"footprint": poly}))
    cands.sort(key=lambda t: t[0])
    scatter = [b for _, b in cands[:MAX_BUILDINGS]]

    # ---- roads
    roads = []
    for e in els:
        hw = e.get("tags", {}).get("highway")
        if e["type"] != "way" or hw not in ROAD_ALL or e.get("tags", {}).get("area") == "yes":
            continue
        line = [proj(g["lat"], g["lon"]) for g in e.get("geometry", [])]
        for run in clip_line(line):
            run = simplify(run, 0.6)
            roads.append({"line": run, "width": 3.2 if hw in ROAD_WIDE else 2.2})
    roads.sort(key=lambda r: min(math.hypot(*p) for p in r["line"]))
    roads = roads[:420]

    # ---- river: the longest joined centreline run of the named river
    river_line = []
    if river:
        segs = [[proj(g["lat"], g["lon"]) for g in e.get("geometry", [])] for e in els
                if e["type"] == "way" and e.get("tags", {}).get("waterway") == "river"]
        runs = [r for line in chain(segs) for r in clip_line(line, 300)]
        if runs:
            river_line = simplify(max(runs, key=len), 1.0)

    hills = []
    for h in cfg.get("hills", []):
        x, z = proj(*h["at"])
        hills.append({"cx": x, "cz": z, "r": h["r"], "h": h["h"]})

    meta = {"id": city_id, "name_en": cfg["name_en"], "name_ml": cfg["name_ml"], "latlon": cfg["center"],
            "river_half_width": (river or {}).get("half_width", 0), "hills": hills,
            "landmarks": [{"id": l["id"], "kind": l["kind"], "points": l["points"], "label_en": l["en"][0], "flavor_en": l["en"][1],
                           "label_ml": l["ml"][0], "flavor_ml": l["ml"][1]} for l in cfg["landmarks"]]}
    out = {"scale_note": f"local meters, compressed by factor {F} from real-world OSM meters, origin = {cfg['name_en']} centre "
                         f"({lat0}, {lon0}). Map data (c) OpenStreetMap contributors, ODbL.",
           "meta": meta, "landmarks": landmarks, "river_polyline": river_line, "scatter_buildings": scatter, "roads": roads}
    path = ROOT / "public" / "maps" / f"{city_id}.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"{city_id}: {len(scatter)} buildings (of {len(cands)}), {len(roads)} roads, river {len(river_line)} pts, "
          f"{path.stat().st_size // 1024} KB", flush=True)


if __name__ == "__main__":
    cities = json.loads((ROOT / "scripts" / "cities.json").read_text())
    for cid in (sys.argv[1:] or list(cities)):
        build(cid, cities[cid])
        time.sleep(5)
