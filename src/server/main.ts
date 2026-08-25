import { createApp } from "./app.js";
import { OpLogStore } from "../store/op-log.js";
import { DocumentStore } from "../store/document-store.js";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.GEOMERGE_DB_PATH ?? "./geomerge.sqlite";
const apiKeys = new Set(
  (process.env.GEOMERGE_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),
);

if (apiKeys.size === 0) {
  console.warn("GEOMERGE_API_KEYS is unset — the API is running with auth disabled. Do not do this in production.");
}

const documentStore = new DocumentStore(new OpLogStore(dbPath));
const app = createApp({ documentStore, apiKeys });

app.listen(port, () => {
  console.log(`geomerge API listening on :${port} (db: ${dbPath})`);
});
