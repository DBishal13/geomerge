import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { DocumentStore } from "../store/document-store.js";
import { LamportClock } from "../crdt/ids.js";
import { opsFromFeature, featureFromMaterialized } from "../crdt/geojson-adapter.js";
import { requireApiKey } from "./auth.js";
import { HttpError, badRequest, notFound } from "./errors.js";
import { validatePolygonOps } from "./validate.js";

export interface CreateAppOptions {
  documentStore: DocumentStore;
  apiKeys?: ReadonlySet<string>;
}

function asyncRoute(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export function createApp({ documentStore, apiKeys = new Set() }: CreateAppOptions): Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.use(requireApiKey(apiKeys));

  const requestLog: { method: string; path: string; status: number; ms: number }[] = [];
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      requestLog.push({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
      if (requestLog.length > 1000) requestLog.shift();
    });
    next();
  });

  app.get("/v1/documents", (_req, res) => {
    res.json({ documents: documentStore.list() });
  });

  app.post(
    "/v1/documents",
    asyncRoute((req, res) => {
      const body = req.body as { id?: unknown; feature?: unknown; ops?: unknown; actor?: unknown };
      const id = typeof body.id === "string" && body.id.length > 0 ? body.id : randomUUID();
      if (documentStore.exists(id)) {
        throw new HttpError(409, `document ${id} already exists`);
      }

      if (body.feature !== undefined) {
        const actor = typeof body.actor === "string" ? body.actor : "server";
        const { ops } = opsFromFeature(body.feature as Parameters<typeof opsFromFeature>[0], new LamportClock(actor));
        const result = documentStore.create(id, ops);
        res.status(201).json({ id, seq: documentStore.latestSeq(id), ...featureFromMaterialized(result) });
        return;
      }

      if (body.ops !== undefined) {
        const validated = validatePolygonOps(body.ops);
        const result = documentStore.create(id, validated);
        res.status(201).json({ id, seq: documentStore.latestSeq(id), ...featureFromMaterialized(result) });
        return;
      }

      throw badRequest("request body must include either `feature` (a GeoJSON Polygon) or `ops` (an insert-op array)");
    }),
  );

  app.get(
    "/v1/documents/:id",
    asyncRoute((req, res) => {
      const id = String(req.params.id);
      if (!documentStore.exists(id)) throw notFound(`document ${id} not found`);
      const result = documentStore.materialize(id);
      res.json({ id, seq: documentStore.latestSeq(id), ...featureFromMaterialized(result) });
    }),
  );

  app.post(
    "/v1/documents/:id/ops",
    asyncRoute((req, res) => {
      const id = String(req.params.id);
      if (!documentStore.exists(id)) throw notFound(`document ${id} not found`);
      const ops = validatePolygonOps((req.body as { ops?: unknown }).ops);
      const { result, seqs } = documentStore.push(id, ops);
      res.status(201).json({ id, seqs, ...featureFromMaterialized(result) });
    }),
  );

  app.get(
    "/v1/documents/:id/ops",
    asyncRoute((req, res) => {
      const id = String(req.params.id);
      if (!documentStore.exists(id)) throw notFound(`document ${id} not found`);
      const sinceRaw = req.query.since;
      const since = sinceRaw === undefined ? 0 : Number(sinceRaw);
      if (!Number.isInteger(since) || since < 0) {
        throw badRequest("`since` must be a non-negative integer");
      }
      res.json({ id, ops: documentStore.opsSince(id, since) });
    }),
  );

  app.get("/v1/_debug/requests", (_req, res) => {
    res.json({ requests: requestLog.slice(-100) });
  });

  app.use((req, res) => {
    res.status(404).json({ error: `no route: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
