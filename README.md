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

## Prototype

Two things exist here now:

**`src/crdt/`** — the real architecture: an operation-based CRDT engine.
Vertices have stable ids (the id of the op that created them), positions are
last-writer-wins registers keyed by a Lamport clock, and ring order is an RGA
(a list CRDT) so vertices can be inserted and deleted, not just moved.
Layered on top, `PolygonDocument.materialize()` is the topology guarantee:
whatever combination of ops came in, it always returns a simple polygon —
reverting exactly the edited vertices whose combination crossed an edge back
to their last known-valid position, and reporting them, rather than silently
handing back a self-intersecting shape. A vertex with no prior valid
position (freshly inserted) can't be reverted, so if it's the only thing
implicated in a crossing, `materialize()` says so (`valid: false`) instead of
guessing.

The actual product primitive — two neighboring parcels *sharing* boundary
vertices — is `VertexStore`: two `PolygonDocument`s constructed against the
same store and referencing the same vertex id are sharing that vertex's
geometry. Move it through either parcel's op stream and both see the new
position; there's no separate reconciliation step because there was never a
second copy of the edge to reconcile.

**`src/merge.ts`** — a simpler, separate convenience path for when you only
have two GeoJSON snapshots and no operation history: a one-shot diff against
a common base. No stable vertex ids, no insert/delete, just three matching
rings. Good enough for a one-off comparison; not the real engine.

```bash
npm install
npm run demo          # concurrent moves: two crews drag opposite ends of a shared notch
npm run demo:insert   # concurrent inserts: two crews add a point on the same edge
npm run demo:shared   # two parcels sharing a boundary vertex stay consistent across a move
npm test               # 25 tests: RGA/LWW convergence, topology repair, shared-vertex consistency
npm run merge -- fixtures/base.geojson fixtures/crew-a.geojson fixtures/crew-b.geojson
```

Known limitations, honestly: no holes or multi-polygons; the RGA's
concurrent-insert tie-break is the standard sibling-of-one-origin rule, not
the deeper interleaving-free ordering some list CRDTs add for many-actor
editing; ops are assumed applied at most once, in causal order (no network
transport or op-log persistence yet — that's the next real piece of work).
See the docstrings in `src/crdt/` for where each of these lives in the code.
