// Little Bamberg -- local dev server. Bun's HTML import handles bundling
// the client TS automatically (with HMR in dev); this file just adds the
// leaderboard API (SQLite) and a WebSocket relay for live player
// positions -- replacing what the Claude Artifact's `db`/`room`
// capabilities did.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import index from "./public/index.html";
import gallery from "./public/gallery.html";

const PORT = Number(process.env.PORT || 3300);
const DATA_DIR = join(import.meta.dir, "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "leaderboard.sqlite"));
db.run(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    collected TEXT NOT NULL DEFAULT '[]',
    updatedAt INTEGER NOT NULL
  )
`);

interface PlayerRow {
  id: string;
  name: string;
  score: number;
  collected: string;
  updatedAt: number;
}

function getPlayer(id: string): PlayerRow | null {
  return (db.query("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow) || null;
}

function upsertPlayer(id: string, name: string, score: number, collected: string[]) {
  db.run(
    `INSERT INTO players (id, name, score, collected, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, score = excluded.score, collected = excluded.collected, updatedAt = excluded.updatedAt`,
    [id, name, score, JSON.stringify(collected), Date.now()]
  );
}

function topPlayers(limit: number) {
  return db.query("SELECT id, name, score FROM players ORDER BY score DESC LIMIT ?").all(limit) as Pick<PlayerRow, "id" | "name" | "score">[];
}

// Every connected client broadcasts its own position; the server just fans
// it out to everyone else under one shared topic. No server-side state
// kept beyond the socket list -- presence is ephemeral by design.
const ROOM_TOPIC = "presence";
type ClientMsg = { type: "presence"; x: number; z: number; rotY: number; name: string; city?: string };

const server = Bun.serve<{ id: string }>({
  port: PORT,
  routes: {
    "/": index,
    "/gallery": gallery, // dev: all landmark models side by side
  },
  async fetch(req, server) {
    const url = new URL(req.url);

    // one Germany: the world layout and every city's map
    const data = url.pathname.match(/^\/(world|maps)\/([a-z-]+)\.json$/);
    if (data) {
      const file = data[2] === "bamberg-map-data" ? join(import.meta.dir, "public", "bamberg-map-data.json") : join(import.meta.dir, "public", data[1]!, data[2] + ".json");
      const f = Bun.file(file);
      return (await f.exists()) ? new Response(f, { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } }) : new Response("Not found", { status: 404 });
    }
    const terrain = url.pathname.match(/^\/terrain\/([a-z]+)\.json$/); // real ground, water and bridges per city
    if (terrain) {
      const f = Bun.file(join(import.meta.dir, "public", "terrain", terrain[1] + ".json"));
      return (await f.exists()) ? new Response(f, { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } }) : new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/ws") {
      const id = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { id } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/leaderboard" && req.method === "GET") {
      const rows = topPlayers(12).map((r) => ({ id: r.id, name: r.name, score: r.score }));
      return Response.json(rows);
    }

    if (url.pathname === "/api/player" && req.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return new Response("missing id", { status: 400 });
      const row = getPlayer(id);
      if (!row) return Response.json({ exists: false });
      return Response.json({ exists: true, name: row.name, score: row.score, collected: JSON.parse(row.collected) });
    }

    if (url.pathname === "/api/player" && req.method === "POST") {
      const body = (await req.json()) as { id: string; name: string; score: number; collected: string[] };
      if (!body || typeof body.id !== "string" || typeof body.name !== "string") {
        return new Response("bad request", { status: 400 });
      }
      upsertPlayer(body.id, body.name.slice(0, 18), Math.max(0, body.score | 0), Array.isArray(body.collected) ? body.collected : []);
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/models/") && !url.pathname.includes("..")) {
      const file = Bun.file(join(import.meta.dir, "public", url.pathname));
      if (await file.exists()) {
        const headers = url.pathname.endsWith(".glb") ? { "Content-Type": "model/gltf-binary" } : undefined;
        return new Response(file, { headers });
      }
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe(ROOM_TOPIC);
    },
    message(ws, raw) {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "presence") {
        // ws.publish reaches every OTHER player; server.publish also echoed your own position back to you, which drew
        // a second copy of you following yourself around
        ws.publish(
          ROOM_TOPIC,
          JSON.stringify({ type: "presence", id: ws.data.id, x: msg.x, z: msg.z, rotY: msg.rotY, name: msg.name, city: typeof msg.city === "string" ? msg.city.slice(0, 24) : "bamberg" })
        );
      }
    },
    close(ws) {
      ws.unsubscribe(ROOM_TOPIC);
      server.publish(ROOM_TOPIC, JSON.stringify({ type: "leave", id: ws.data.id }));
    },
  },
  development: {
    // game.ts is one big imperative script (canvas, WebSocket, scene, all
    // created at module scope) with no dispose/cleanup hooks, so HMR
    // re-running it on save doesn't replace anything -- it ADDS a second
    // canvas and a second WebSocket connection on top of the first, which
    // is exactly what showed up as "duplicate characters". A full reload
    // on change is correct for a script built this way.
    hmr: false,
    console: true,
  },
});

console.log(`Little Bamberg running at ${server.url}`);
