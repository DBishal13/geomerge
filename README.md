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
