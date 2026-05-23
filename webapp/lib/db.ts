import { ObjectId, type WithId, type Document } from "mongodb";
import { getDb, isDbConfigured } from "./mongodb";
import {
  PIECES,
  LEADERS,
  RANKED,
  POINTS_PER_LIKE,
  type Piece,
  type Leader,
  type RankedConductor,
  type Trend,
  type InstrumentKey,
} from "./data";

/**
 * Server-side data access. Every function falls back to the mock data in
 * `lib/data.ts` when MONGODB_URI is not set, so the UI never renders empty
 * while Mongo is being wired up.
 */

export interface ConductorDoc {
  name: string; // first name
  nameEm: string; // remainder of the name (emphasised in UI)
  handle: string;
  score: number;
  pieces: number;
  weeks: number;
  trend: Trend;
  trendN: string;
}

function songFromDoc(d: WithId<Document>): Piece {
  return {
    id: d._id.toString(),
    title: d.title,
    titleEm: d.titleEm,
    composer: d.composer,
    composerHandle: d.composerHandle,
    date: d.date,
    duration: d.duration,
    tag: d.tag,
    instr: d.instr,
    live: d.live,
    likes: d.likes ?? 0,
    saves: d.saves ?? 0,
    audioId: d.audioId ? d.audioId.toString() : null,
    coverUrl: d.coverUrl,
  };
}

export async function getSongs(): Promise<Piece[]> {
  if (!isDbConfigured()) return PIECES;
  try {
    const db = await getDb();
    const docs = await db.collection("songs").find({}).sort({ likes: -1 }).toArray();
    return docs.map(songFromDoc);
  } catch {
    console.warn("[db] getSongs fell back to mock data — Atlas unreachable");
    return PIECES;
  }
}

export interface LeaderboardData {
  leaders: Leader[];
  ranked: RankedConductor[];
  conductorCount: number;
}

export async function getLeaderboard(): Promise<LeaderboardData> {
  if (!isDbConfigured()) {
    return { leaders: LEADERS, ranked: RANKED, conductorCount: 4812 };
  }
  let docs: WithId<ConductorDoc>[];
  try {
    const db = await getDb();
    docs = (await db
      .collection("conductors")
      .find({})
      .sort({ score: -1 })
      .toArray()) as unknown as WithId<ConductorDoc>[];
  } catch {
    console.warn("[db] getLeaderboard fell back to mock data — Atlas unreachable");
    return { leaders: LEADERS, ranked: RANKED, conductorCount: 4812 };
  }

  const leaders: Leader[] = docs.slice(0, 3).map((c, i) => ({
    rank: i + 1,
    name: c.name,
    nameEm: c.nameEm,
    handle: c.handle,
    score: c.score,
    pieces: c.pieces,
    weeks: c.weeks,
    trend: c.trend,
    trendN: c.trendN,
  }));

  const ranked: RankedConductor[] = docs.slice(3).map((c, i) => ({
    rank: i + 4,
    name: `${c.name} ${c.nameEm}`.trim(),
    handle: c.handle,
    score: c.score,
    pieces: c.pieces,
    trend: c.trend,
    trendN: c.trendN,
  }));

  return { leaders, ranked, conductorCount: docs.length };
}

/** Increment a song's likes and bump the owning conductor's leaderboard score. */
export async function likeSong(id: string): Promise<{ likes: number }> {
  if (!isDbConfigured()) throw new Error("DB not configured");
  const db = await getDb();
  const song = await db
    .collection("songs")
    .findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $inc: { likes: 1 } },
      { returnDocument: "after" }
    );
  if (!song) throw new Error("song not found");

  if (song.composerHandle) {
    await db
      .collection("conductors")
      .updateOne(
        { handle: song.composerHandle },
        { $inc: { score: POINTS_PER_LIKE } }
      );
  }
  return { likes: song.likes ?? 0 };
}

/** Increment a song's save count. */
export async function saveSong(id: string): Promise<{ saves: number }> {
  if (!isDbConfigured()) throw new Error("DB not configured");
  const db = await getDb();
  const song = await db
    .collection("songs")
    .findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $inc: { saves: 1 } },
      { returnDocument: "after" }
    );
  if (!song) throw new Error("song not found");
  return { saves: song.saves ?? 0 };
}

export interface NewSong {
  title: string;
  composer: string;
  composerHandle: string;
  instr?: InstrumentKey;
  audioId?: string | null;
  duration?: string;
  coverUrl?: string;
}

/**
 * Publish a freshly conducted song: insert it into `songs` and make sure the
 * composer exists as a conductor (so likes on it count toward the leaderboard).
 */
export async function createSong(input: NewSong): Promise<{ id: string }> {
  if (!isDbConfigured()) return { id: `local_${Date.now()}` };
  let db;
  try {
    db = await getDb();
  } catch {
    console.warn("[db] createSong fell back — Atlas unreachable");
    return { id: `local_${Date.now()}` };
  }

  const now = new Date();
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;

  const doc = {
    title: input.title,
    titleEm: "",
    composer: input.composer,
    composerHandle: input.composerHandle,
    date,
    duration: input.duration || "—",
    tag: "FINAL",
    instr: input.instr || "clef",
    live: false,
    likes: 0,
    saves: 0,
    audioId: input.audioId && !input.audioId.startsWith("local_") ? new ObjectId(input.audioId) : (input.audioId ?? null),
    coverUrl: input.coverUrl,
    createdAt: now,
  };

  const res = await db.collection("songs").insertOne(doc);

  // Ensure the composer is on the leaderboard. New conductors start at 0 and
  // climb as their songs get liked; existing ones just gain a piece.
  const [first, ...rest] = input.composer.trim().split(/\s+/);
  await db.collection("conductors").updateOne(
    { handle: input.composerHandle },
    {
      $setOnInsert: {
        name: first || input.composer,
        nameEm: rest.join(" "),
        score: 0,
        weeks: 0,
        trend: "flat" as Trend,
        trendN: "NEW",
      },
      $inc: { pieces: 1 },
    },
    { upsert: true }
  );

  return { id: res.insertedId.toString() };
}
