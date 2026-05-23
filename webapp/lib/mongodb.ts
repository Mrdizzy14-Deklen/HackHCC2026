import { MongoClient, type Db, GridFSBucket } from "mongodb";

/**
 * Cached MongoDB connection.
 *
 * Next.js dev hot-reloads modules constantly; without caching the client on
 * `globalThis` we'd open a new connection pool on every reload and exhaust the
 * server. In prod the module is evaluated once, so the cache is a no-op there.
 *
 * Reads:
 *   MONGODB_URI  — full connection string (mongodb+srv://… for Atlas)
 *   MONGODB_DB   — database name (defaults to "maestro")
 *
 * See .env.local.example for setup.
 */
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "maestro";

if (!uri) {
  // Don't throw at import time — the app must still build/run in pure mock mode
  // before Mongo is connected. Callers check `isDbConfigured()` first.
  console.warn("[mongodb] MONGODB_URI not set — DB features disabled, using mock data.");
}

export function isDbConfigured(): boolean {
  return Boolean(uri);
}

let clientPromise: Promise<MongoClient> | undefined;

declare global {
  // eslint-disable-next-line no-var
  var _maestroMongo: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (process.env.NODE_ENV === "development") {
    if (!global._maestroMongo) {
      global._maestroMongo = new MongoClient(uri).connect();
    }
    return global._maestroMongo;
  }
  if (!clientPromise) clientPromise = new MongoClient(uri).connect();
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}

export async function getBucket(): Promise<GridFSBucket> {
  const db = await getDb();
  return new GridFSBucket(db, { bucketName: "audio" });
}
