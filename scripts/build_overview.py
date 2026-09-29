"""public/maps/bayern.json: the drivable overview of Bavaria ("Road trip"): the state outline, the Alps, the Danube and
the Main, motorways between the cities, a gate per city (drive in -> that city), and 7 sights to collect.

Scale: all of Bavaria (~355 x 366 km) fits in the game's ±600 units, so 1 unit ≈ 327 m. Positions of the sights and of
the river towns are real (OpenStreetMap, looked up 2026-09-29); the rivers are drawn through those towns, the hills are
stylised. Needs public/bavaria.json (scripts/build_bavaria.py) and the city maps' meta (scripts/cities.json).
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAT0, LON0 = 48.92, 11.41
F = 1120 / 366000                     # units per metre
KX = 111320 * math.cos(math.radians(LAT0)) * F
KZ = 110574 * F


def P(lat, lon):
    return [round((lon - LON0) * KX, 2), round(-(lat - LAT0) * KZ, 2)]


CITIES = {  # the gates: the same centre points the city maps use
    "bamberg": (49.8918, 10.8869), "muenchen": (48.1374, 11.5755), "nuernberg": (49.45369, 11.07734),
    "wuerzburg": (49.7932, 9.9315), "regensburg": (49.0195, 12.0960), "erlangen": (49.5970, 11.0045), "augsburg": (48.3689, 10.8990),
}
SIGHTS = [  # id, kind, points, (lat, lon), en, ml
    ("neuschwanstein", "fairy_castle", 25, (47.5575, 10.7495), ("Neuschwanstein", "The fairy-tale castle of King Ludwig II."),
     ("നോയ്ഷ്വാൻസ്റ്റൈൻ", "ലുഡ്വിഗ് രണ്ടാമൻ രാജാവിന്റെ യക്ഷിക്കഥ പോലുള്ള കോട്ട.")),
    ("zugspitze", "summit", 20, (47.4212, 10.9863), ("Zugspitze", "Germany's highest mountain: 2,962 metres."),
     ("സുഗ്ഷ്പിറ്റ്സെ", "ജർമനിയിലെ ഏറ്റവും ഉയരമുള്ള പർവ്വതം: 2,962 മീറ്റർ.")),
    ("koenigssee", "lake_chapel", 20, (47.5444, 12.9720), ("Königssee", "A clear alpine lake with the red-domed church of St. Bartholomä."),
     ("ക്യോണിഗ്സീ", "ചുവന്ന താഴികക്കുടങ്ങളുള്ള സെന്റ് ബർത്തലോമിയോ പള്ളിയുള്ള തെളിഞ്ഞ ആൽപ്സ് തടാകം.")),
    ("walhalla", "temple", 15, (49.0311, 12.2240), ("Walhalla", "A Greek-style temple above the Danube honouring famous Germans."),
     ("വാൽഹല്ല", "പ്രശസ്ത ജർമ്മൻകാരെ ആദരിക്കുന്ന, ഡാന്യൂബിന് മുകളിലെ ഗ്രീക്ക് ശൈലി ക്ഷേത്രം.")),
    ("rothenburg", "walled_town", 15, (49.3773, 10.1790), ("Rothenburg ob der Tauber", "A medieval town still inside its old town wall."),
     ("റോട്ടൻബുർഗ്", "ഇപ്പോഴും പഴയ നഗരമതിലിനുള്ളിലുള്ള മധ്യകാല പട്ടണം.")),
    ("herrenchiemsee", "island_palace", 15, (47.8604, 12.4023), ("Herrenchiemsee", "King Ludwig's copy of Versailles on an island in the Chiemsee."),
     ("ഹെരൻകീംസീ", "കീംസീ തടാകത്തിലെ ദ്വീപിൽ ലുഡ്വിഗ് രാജാവിന്റെ 'വെഴ്സായ്'.")),
    ("passau", "three_rivers", 15, (48.5743, 13.4655), ("Passau", "The city where three rivers meet."),
     ("പസ്സൗ", "മൂന്ന് നദികൾ ചേരുന്ന നഗരം.")),
]
DANUBE = [(48.3985, 9.9912), (48.72, 10.55), (48.718, 10.7807), (48.735, 11.18), (48.763, 11.425), (48.9185, 11.8723),
          (49.0195, 12.0960), (48.95, 12.35), (48.882, 12.5697), (48.8334, 12.962), (48.70, 13.20), (48.5743, 13.4655), (48.58, 13.55)]
MAIN = [(49.9738, 9.1447), (50.00, 9.45), (49.9614, 9.7642), (49.7932, 9.9315), (49.7381, 10.1601), (49.90, 10.22),
        (50.0451, 10.2341), (50.0319, 10.5066), (49.93, 10.85), (50.1462, 11.0638), (50.10, 11.40), (49.9446, 11.5744)]
LAKES = [  # (lat, lon, rx, rz) in units -- Chiemsee, Königssee, Ammersee, Starnberger See, Bodensee corner
    (47.8811, 12.4407, 22, 16), (47.5551, 12.9792, 4, 12), (47.99, 11.13, 5, 12), (47.90, 11.31, 5, 14), (47.55, 9.70, 14, 8)]
MOTORWAYS = [("wuerzburg", "nuernberg"), ("nuernberg", "regensburg"), ("nuernberg", "muenchen"), ("muenchen", "augsburg"),
             ("wuerzburg", "bamberg"), ("bamberg", "erlangen"), ("erlangen", "nuernberg"), ("regensburg", "muenchen"),
             ("regensburg", "passau"), ("augsburg", "neuschwanstein"), ("muenchen", "zugspitze"), ("muenchen", "herrenchiemsee"),
             ("herrenchiemsee", "koenigssee"), ("wuerzburg", "rothenburg"), ("rothenburg", "nuernberg"), ("regensburg", "walhalla")]


def main():
    rnd = random.Random(7)
    outline_ll = json.loads((ROOT / "public" / "bavaria.json").read_text())
    outline = [P(la, lo) for la, lo in outline_ll]
    pts = {k: P(*v) for k, v in CITIES.items()}
    pts.update({s[0]: P(*s[3]) for s in SIGHTS})

    def inside(x, z):
        c = False
        for i in range(len(outline)):
            (x1, z1), (x2, z2) = outline[i], outline[i - 1]
            if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
                c = not c
        return c

    # ---- hills: the Alps along the southern border, the Bavarian Forest, Fichtelgebirge, Rhön; Zugspitze tallest
    hills = []
    for la, lo in outline_ll:
        if la < 47.72 and 10.05 < lo < 13.1:
            x, z = P(la, lo)
            for _ in range(2):
                hx, hz = x + rnd.uniform(-10, 10), z - rnd.uniform(8, 40)
                if inside(hx, hz):
                    hills.append({"cx": round(hx, 1), "cz": round(hz, 1), "r": rnd.randint(22, 34), "h": rnd.randint(16, 30), "snow": True})
    zx, zz = pts["zugspitze"]
    hills.append({"cx": zx, "cz": zz, "r": 34, "h": 46, "snow": True})
    for la, lo, n, h in [(49.05, 13.25, 7, 11), (50.02, 11.85, 3, 9), (50.40, 9.98, 3, 8)]:
        cx, cz = P(la, lo)
        for _ in range(n):
            hills.append({"cx": round(cx + rnd.uniform(-30, 30), 1), "cz": round(cz + rnd.uniform(-18, 18), 1), "r": rnd.randint(20, 30), "h": rnd.randint(h - 3, h + 3)})

    # ---- a village of small houses around every gate and some of the sights
    scatter = []
    for cid, (x, z) in pts.items():
        big = cid in ("muenchen", "nuernberg")
        n = 26 if big else 14 if cid in CITIES else 0
        placed = 0
        while placed < n:
            a, d = rnd.uniform(0, math.tau), rnd.uniform(11, 26 if big else 20)
            hx, hz = x + math.cos(a) * d, z + math.sin(a) * d
            w, dd = rnd.uniform(2.2, 3.8), rnd.uniform(2.2, 3.4)
            rot = rnd.uniform(0, math.pi)
            corners = [(-w, -dd), (w, -dd), (w, dd), (-w, dd)]
            fp = [[round(hx + cx * math.cos(rot) - cz * math.sin(rot), 2), round(hz + cx * math.sin(rot) + cz * math.cos(rot), 2)] for cx, cz in corners]
            scatter.append({"footprint": fp})
            placed += 1

    def dense(a, b, step=8):  # a point every 8 units, so the road can follow the hills
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        return [[round(a[0] + (b[0] - a[0]) * i / n, 2), round(a[1] + (b[1] - a[1]) * i / n, 2)] for i in range(n + 1)]
    roads = [{"line": dense(pts[a], pts[b]), "width": 4.2} for a, b in MOTORWAYS]

    meta = {
        "id": "bayern", "name_en": "Bavaria", "name_ml": "ബവേറിയ", "latlon": [LAT0, LON0], "overview": True,
        "m_per_unit": round(1 / F, 1), "river_half_width": 3.2, "hills": hills,
        "outline": outline, "rivers": [[P(*p) for p in MAIN]],
        "lakes": [{"cx": P(la, lo)[0], "cz": P(la, lo)[1], "rx": rx, "rz": rz} for la, lo, rx, rz in LAKES],
        "portals": [{"id": k, "x": v[0], "z": v[1]} for k, v in pts.items() if k in CITIES],
        "landmarks": [{"id": s[0], "kind": s[1], "points": s[2], "label_en": s[4][0], "flavor_en": s[4][1], "label_ml": s[5][0], "flavor_ml": s[5][1]} for s in SIGHTS],
    }
    out = {"scale_note": f"Bavaria overview: 1 unit = {1 / F:.0f} m real, origin ({LAT0}, {LON0}); x east, z south. "
                         "Map data (c) OpenStreetMap contributors, ODbL.",
           "meta": meta, "landmarks": {s[0]: {"center": pts[s[0]]} for s in SIGHTS},
           "river_polyline": [P(*p) for p in DANUBE], "scatter_buildings": scatter, "roads": roads}
    path = ROOT / "public" / "maps" / "bayern.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    xs = [p[0] for p in outline]; zs = [p[1] for p in outline]
    print(f"bayern: outline x {min(xs):.0f}..{max(xs):.0f}, z {min(zs):.0f}..{max(zs):.0f}; {len(hills)} hills, {len(scatter)} houses, "
          f"{len(roads)} motorways, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
