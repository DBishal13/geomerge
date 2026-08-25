import { readFileSync } from "node:fs";
import { naiveMerge, safeMerge } from "./merge.js";
import { featureFromRing, ringFromFeature } from "./geojson.js";
import { isSimplePolygon } from "./topology.js";
import type { Ring } from "./types.js";
import type { PolygonDocument, DocumentMergeResult } from "./crdt/document.js";

function readRing(path: string): Ring {
  const feature = JSON.parse(readFileSync(path, "utf8"));
  return ringFromFeature(feature);
}

function reportSnapshot(base: Ring, a: Ring, b: Ring): void {
  const naive = naiveMerge(base, a, b);
  const safe = safeMerge(base, a, b);

  console.error(`naive merge:  ${isSimplePolygon(naive) ? "valid" : "SELF-INTERSECTING"}`);
  console.error(
    `safe merge:   ${safe.valid ? "valid" : "UNRESOLVED"}${
      safe.conflicts.length ? ` (reverted vertices: ${safe.conflicts.join(", ")})` : ""
    }`,
  );
  console.error("");
  console.log(JSON.stringify(featureFromRing(safe.polygon, { conflicts: safe.conflicts }), null, 2));
}

function reportDocument(label: string, doc: PolygonDocument): DocumentMergeResult {
  const unsafeRing = doc.materializeUnsafe();
  const result = doc.materialize();

  console.error(`${label}`);
  console.error(`  naive (no repair): ${isSimplePolygon(unsafeRing) ? "valid" : "SELF-INTERSECTING"}`);
  console.error(
    `  safe (materialize): ${result.valid ? "valid" : "UNRESOLVED"}${
      result.conflicts.length ? ` (reverted: ${result.conflicts.join(", ")})` : ""
    }`,
  );
  return result;
}

function printPolygon(result: DocumentMergeResult): void {
  console.log(JSON.stringify(featureFromRing(result.polygon, { conflicts: result.conflicts, valid: result.valid }), null, 2));
}

async function demoMoves(): Promise<void> {
  const { mergedDoc } = await import("./crdt/demo-moves.js");
  console.error("Two crews independently drag opposite ends of a shared, notched boundary.\n");
  const result = reportDocument("merge", mergedDoc);
  console.error("");
  printPolygon(result);
}

async function demoInsert(): Promise<void> {
  const { mergedDoc } = await import("./crdt/demo-insert.js");
  console.error(
    "Two crews independently add a new point on the same edge — a topology edit the\n" +
      "old snapshot-diff engine couldn't even represent. Both new vertices are brand new,\n" +
      "so there's no safe fallback position to revert either of them to.\n",
  );
  const result = reportDocument("merge", mergedDoc);
  console.error("\nNeither new vertex has a checkpointed position, so Geomerge can't silently");
  console.error("pick a fix here — it reports the shape as unresolved instead of guessing.\n");
  printPolygon(result);
}

async function demoShared(): Promise<void> {
  const { parcelP, parcelQ, moveSharedBoundary } = await import("./crdt/demo-shared.js");
  console.error("Two neighboring parcels, P and Q, share two boundary vertices.\n");

  const beforeP = parcelP.materialize();
  const beforeQ = parcelQ.materialize();
  console.error(`parcel P shared vertex position: ${JSON.stringify(beforeP.polygon[2])}`);
  console.error(`parcel Q shared vertex position: ${JSON.stringify(beforeQ.polygon[1])}\n`);

  console.error("A crew drags the shared boundary outward, through parcel P's edits only...\n");
  moveSharedBoundary();

  const afterP = parcelP.materialize();
  const afterQ = parcelQ.materialize();
  console.error(`parcel P shared vertex position: ${JSON.stringify(afterP.polygon[2])}`);
  console.error(`parcel Q shared vertex position: ${JSON.stringify(afterQ.polygon[1])}`);
  console.error("\nSame vertex, same new position in both — nothing to reconcile after the fact.\n");

  console.log(JSON.stringify({ parcelP: featureFromRing(afterP.polygon), parcelQ: featureFromRing(afterQ.polygon) }, null, 2));
}

function merge(args: string[]): void {
  const [basePath, aPath, bPath] = args;
  if (!basePath || !aPath || !bPath) {
    console.error("Usage: geomerge merge <base.geojson> <a.geojson> <b.geojson>");
    process.exit(1);
  }
  reportSnapshot(readRing(basePath!), readRing(aPath!), readRing(bPath!));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "demo":
      return demoMoves();
    case "demo-insert":
      return demoInsert();
    case "demo-shared":
      return demoShared();
    case "merge":
      return merge(args);
    default:
      console.error(
        [
          "Usage:",
          "  geomerge demo                                        # concurrent moves on a shared boundary",
          "  geomerge demo-insert                                 # concurrent inserts on a shared edge",
          "  geomerge demo-shared                                 # two parcels sharing a boundary vertex",
          "  geomerge merge <base.geojson> <a.geojson> <b.geojson> # one-shot snapshot diff, no op history needed",
        ].join("\n"),
      );
      process.exit(1);
  }
}

main();
