// Upload the local audio tracks into GridFS and attach them to seeded songs.
//
// Reads each song's `audioFile` hint (set by seed.mjs), uploads
// media/audio/<audioFile> into the GridFS "audio" bucket, and sets the song's
// `audioId`. Idempotent: wipes the audio bucket first, then re-uploads.
//
// Run AFTER seeding:
//   node --env-file=.env.local scripts/load-media.mjs
//
// (Audio source files live in media/ which is gitignored — see scripts/seed.mjs
//  audioFile fields for the Mixkit track ids.)

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MongoClient, GridFSBucket } from "mongodb";

const here = dirname(fileURLToPath(import.meta.url));
const audioDir = join(here, "..", "media", "audio");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "maestro";
if (!uri) {
  console.error("MONGODB_URI not set. Run: node --env-file=.env.local scripts/load-media.mjs");
  process.exit(1);
}

const ctOf = (f) => {
  const e = f.split(".").pop().toLowerCase();
  return e === "wav" ? "audio/wav" : e === "ogg" ? "audio/ogg" : e === "m4a" ? "audio/mp4" : "audio/mpeg";
};

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  const bucket = new GridFSBucket(db, { bucketName: "audio" });

  // wipe existing audio so re-runs don't pile up duplicates
  await db.collection("audio.files").deleteMany({});
  await db.collection("audio.chunks").deleteMany({});

  const songs = await db.collection("songs").find({ audioFile: { $exists: true } }).toArray();
  let done = 0, missing = 0;

  for (const song of songs) {
    const path = join(audioDir, song.audioFile);
    if (!existsSync(path)) {
      console.warn(`  ! missing ${song.audioFile} — skipping "${song.title} ${song.titleEm}"`);
      missing++;
      continue;
    }
    const buf = await readFile(path);
    const audioId = await new Promise((resolve, reject) => {
      const up = bucket.openUploadStream(song.audioFile, { metadata: { contentType: ctOf(song.audioFile) } });
      up.on("finish", () => resolve(up.id));
      up.on("error", reject);
      up.end(buf);
    });
    await db.collection("songs").updateOne({ _id: song._id }, { $set: { audioId } });
    console.log(`  ♪ ${song.audioFile} -> "${song.title} ${song.titleEm}"`);
    done++;
  }

  console.log(`\nAttached audio to ${done} songs${missing ? `, ${missing} missing` : ""}.`);
} catch (err) {
  console.error("load-media failed:", err);
  process.exitCode = 1;
} finally {
  await client.close();
}
