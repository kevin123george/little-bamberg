"""public/bavaria.json: Bavaria's border (OSM relation 2145268), simplified to ~200 points, as [[lat, lon], ...] for
the travel map. Map data (c) OpenStreetMap contributors, ODbL."""
import json, math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_cities import overpass, chain, simplify_ring, ROOT

els = overpass("[out:json][timeout:170];relation(2145268);out geom;")
rel = els[0]
segs = [[(round(g["lat"], 5), round(g["lon"], 5)) for g in m["geometry"]] for m in rel["members"] if m.get("role") == "outer" and m.get("geometry")]
rings = chain([[list(p) for p in s] for s in segs])
ring = max(rings, key=len)
# simplify in a locally-metric space (lon scaled by cos(lat))
k = math.cos(math.radians(49))
pts = [[p[1] * k, p[0]] for p in ring]
out = simplify_ring(pts[:-1] if pts[0] == pts[-1] else pts, 0.012)
out = [[round(y, 4), round(x / k, 4)] for x, y in out]
(ROOT / "public" / "bavaria.json").write_text(json.dumps(out))
print(len(ring), "->", len(out), "points")
