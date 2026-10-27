# Little Bamberg (3D driving game)

> Shared rules for all projects: `~/Projects/AGENTS.md` (worktrees, decision records, verification, secrets, money).
> Read `~/Projects/homelab-wiki/README.md`, the central `homelab-wiki/decisions/` and this repo's `docs/decisions/` first.

## What it is
A toy-town 3D game for Malayalis in Germany: walk and drive a truck through one streamed map of Germany with 17 real
cities and their landmarks; Malayalam/English; leaderboard.

## Where it runs
Umbrel `~/little-bamberg`, `http://umbrel:3300` (Tailscale MagicDNS) — **Tailscale only**. Leaderboard in SQLite volume
`little-bamberg_data` (`data/` is never synced — don't create test players on the live leaderboard).

## Stack
Bun (`server.ts`, gzipped JSON data routes) + three.js + cannon-es physics. Data built in Python (`scripts/`, env `.venv`,
inputs cached in `.cache/`; both git- and docker-ignored).

## Layout
`public/game.ts` (game loop, travel menu, lazy city build) · `public/world.ts` (streamed countryside chunks, far tiles,
sea) · `public/terrain.ts` (city terrain, water, bridges) · `public/landmarks.ts` + `landmarks_de.ts` (models) ·
`public/toykit.ts` (modelling kit) · `scripts/build_cities.py`, `build_terrain.py`, `build_germany.py` · `scripts/cities.json`.

## Run & test
`bun run dev` (dev server); browser tests in `.cache/tests/*.mjs` drive headless Chrome over CDP (port 9333, dev server
3301). Check visually with screenshots, tab foregrounded.

## Deploy
`./deploy.sh` (rsync without `data/`, `.cache`, `.venv`; writes the server `.env` with the Tailscale IP).

## Conventions
- Use Bun everywhere (`bun <file>`, `bun test`, `bun install`, `Bun.serve()`, `bun:sqlite`); local binaries only
  (`bun x --bun`, `./node_modules/.bin/tsc`), never bare `bunx`/`npx`.
- Scale: 20 units/km between cities, 1 unit = 12 m vertically in the countryside; city maps 1 unit = 2.2 m.
- Physics bodies only near the truck; detailed houses built on approach (far = merged blocks).

## Gotchas
Real Chrome tabs report hidden and pause animation — use screenshots. Overpass needs mirror rotation + cache.
Closed rings collapse when simplified (use `wring()`). Depth fighting: sea plane −0.6, near 0.5 (5 in map view).

## Decisions
Project: `docs/decisions/0001` one Germany map. Full history in the homelab wiki's Little Bamberg row.
