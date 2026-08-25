# Geomerge

> Topology-preserving offline sync for shared polygon edges — the cleanest, most uncontested whitespace in the set, and the weakest business case.

**Domain:** Edge & sync · **Tier:** 4 (long-horizon & capital-gated) · **Composite score:** 2.4/5

## Why this matters
Genuinely uncontested. Two 2025–2026 academic papers (Geo-CRDT; Geometry-Aware CRDTs, IJGI) propose workable architectures using geometric vector clocks and minimum bounding rectangles, but neither is a shipped library. General CRDT libraries (Automerge, Yjs, Loro) have no topology-aware primitive — a naive field-by-field merge of shared vertices silently produces a self-intersecting polygon.

## Market signal
No market sizing exists for this sub-niche; too new to be tracked separately from general local-first sync.

## Feasibility & time-to-MVP
Genuinely novel, not an integration exercise. A research-grade MVP for one feature type (shared polygons only): 6–9 months. A robust general solution handling shared topology between adjacent features: 18–36 months.

## Existing players to differentiate from
None commercial. Academic only.

## Core risk to de-risk first
Placemark — the closest commercial analog, a collaborative web-based geo editor — shut down in Nov 2023, with its founder stating plainly he "couldn't find a way to make it work as a sustainable bootstrapped startup." That predates the CRDT approach specifically, but it's a real signal that the buyer pool (offline-first multi-user GIS editing, mostly utility/telecom field crews) has proven narrow and hard to monetize even without the harder technical problem.

## Scoring snapshot

| Dimension | Score |
|---|---|
| Whitespace | 5/5 |
| Market signal | 1/5 |
| Feasibility | 2/5 |
| Capital efficiency | 3/5 |
| Buyer readiness | 1/5 |

## Status
This is a fresh scaffold, not a validated product yet. Start with `VALIDATION.md` before writing more than a thin prototype.

## Architecture

**`src/crdt/`** — the engine: an operation-based CRDT. Vertices have stable
ids (the id of the op that created them), positions are last-writer-wins
registers keyed by a Lamport clock, and ring order is an RGA (a list CRDT)
so vertices can be inserted and deleted, not just moved. Layered on top,
`PolygonDocument.materialize()` is the topology guarantee: whatever
combination of ops came in, it always returns a simple polygon — reverting
exactly the edited vertices whose combination crossed an edge back to their
last known-valid position, and reporting them, rather than silently handing
back self-intersecting geometry. A vertex with no prior valid position
(freshly inserted) can't be reverted, so if it's the only thing implicated
in a crossing, `materialize()` says so (`valid: false`) instead of guessing;
the same honesty applies to a delete that would drop a ring below 3
vertices. The repair is conservative, not minimal — see the docstring on
`PolygonDocument` for exactly what that trade-off means.

The actual product primitive — two neighboring parcels *sharing* boundary
vertices — is `VertexStore`: two `PolygonDocument`s constructed against the
same store and referencing the same vertex id are sharing that vertex's
geometry. Move it through either parcel's op stream and both see the new
position; there's no separate reconciliation step because there was never a
second copy of the edge to reconcile.

**`src/store/`** — persistence. `OpLogStore` is an append-only, per-document
op log on SQLite (`node:sqlite`, no native dependency to build). Every push
is tagged with a batch number, because `materialize()`'s checkpoint history
has to be rebuilt the same incremental way it was built live — see the
docstring on `OpLogStore` for why a single flat replay after a restart isn't
equivalent. `DocumentStore` ties the log to `PolygonDocument`: `create`,
`push`, `materialize`, `opsSince`.

**`src/server/`** — the HTTP API, and the actual sync transport: a device
pulls everything after the highest seq it's seen (`GET .../ops?since=`),
applies those ops locally in any order (the CRDT is what makes that safe),
and pushes its own new ops back (`POST .../ops`). Bearer-token auth against
a static key list (`GEOMERGE_API_KEYS`), structured JSON errors, request
logging.

**`src/client/device.ts`** — a reference client for that loop. Building it
surfaced two real correctness bugs, both now covered by
`tests/client-sync.test.ts` (which spins up an actual `http.Server` and
proves two independent devices converge to identical state): a push
response can't be trusted to mean "I'm caught up," only a pull can; and ops
must be deduped by id before applying, because reapplying an `insert` isn't
safe the way reapplying a `move` is (the RGA has no duplicate-id guard).

**`src/merge.ts`** — a separate, simpler convenience path for when you only
have two GeoJSON snapshots and no operation history: a one-shot diff against
a common base. No stable vertex ids, no insert/delete. Good enough for a
one-off comparison; not the real engine, and not persisted.

## Running it

```bash
npm install
npm test               # 53 tests: RGA/LWW convergence, topology repair, persistence-across-restart, real HTTP sync
npm run typecheck

npm run demo           # concurrent moves: two crews drag opposite ends of a shared notch
npm run demo:insert    # concurrent inserts: two crews add a point on the same edge
npm run demo:shared    # two parcels sharing a boundary vertex stay consistent across a move
npm run merge -- fixtures/base.geojson fixtures/crew-a.geojson fixtures/crew-b.geojson

GEOMERGE_API_KEYS=dev-key npm run server   # API on :8787, sqlite at ./geomerge.sqlite
```

With the server running:

```bash
curl -X POST localhost:8787/v1/documents \
  -H "Authorization: Bearer dev-key" -H "Content-Type: application/json" \
  -d '{"id":"parcel-1","feature":{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}}}'

curl localhost:8787/v1/documents/parcel-1 -H "Authorization: Bearer dev-key"
```

CI (`.github/workflows/ci.yml`) runs typecheck + the full test suite on
every push and PR.

## Known limitations, honestly

- **No interior rings or multi-polygon geometry.** Single outer ring only.
- **No real IAM.** `GEOMERGE_API_KEYS` is a flat bearer-token list — no
  scoping, rotation, or tenant isolation. Fine for a pilot, not for
  multiple customers on one deployment.
- **No horizontal scaling.** One SQLite file, one process. Real multi-node
  replication (or even just "two app servers behind a load balancer talking
  to one DB") isn't built.
- **RGA tie-break is the standard sibling-of-one-origin rule**, not the
  deeper interleaving-free ordering some list CRDTs add for heavily
  concurrent many-actor editing — fine for a handful of crews on one
  boundary, worth revisiting past that.
- **Ops are assumed delivered at most once per replica.** The client dedupes
  by id to protect against re-pulling its own already-applied ops, but
  there's no general exactly-once transport guarantee baked in below that.
