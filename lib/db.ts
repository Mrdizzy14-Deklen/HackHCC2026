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
  const db = await getDb();
  const docs = await db.collection("songs").find({}).sort({ likes: -1 }).toArray();
  return docs.map(songFromDoc);
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
  const db = await getDb();
  const docs = (await db
    .collection("conductors")
    .find({})
    .sort({ score: -1 })
    .toArray()) as unknown as WithId<ConductorDoc>[];

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
