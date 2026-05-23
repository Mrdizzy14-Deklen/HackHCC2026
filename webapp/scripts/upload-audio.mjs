// Push a local audio file into GridFS and attach it to a song.
//
// Run:
//   node --env-file=.env.local scripts/upload-audio.mjs <path-to-audio> [songId]
//
// If songId is given, that song's `audioId` is set so its Play button works.
// If omitted, prints the new audioId so you can attach it later.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { MongoClient, GridFSBucket, ObjectId } from "mongodb";

const [, , filePath, songId] = process.argv;
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "maestro";

if (!uri) {
  console.error("MONGODB_URI not set.");
  process.exit(1);
}
if (!filePath) {
  console.error("Usage: node --env-file=.env.local scripts/upload-audio.mjs <file> [songId]");
  process.exit(1);
}

const ext = filePath.split(".").pop()?.toLowerCase();
const contentType =
  ext === "mp3" ? "audio/mpeg" :
  ext === "wav" ? "audio/wav" :
  ext === "ogg" ? "audio/ogg" :
  ext === "m4a" ? "audio/mp4" : "audio/mpeg";

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  const bucket = new GridFSBucket(db, { bucketName: "audio" });

  const buf = await readFile(filePath);
  const audioId = await new Promise((resolve, reject) => {
    const up = bucket.openUploadStream(basename(filePath), { metadata: { contentType } });
    up.on("finish", () => resolve(up.id));
    up.on("error", reject);
    up.end(buf);
  });

  console.log("Uploaded audioId:", audioId.toString());

  if (songId) {
    const res = await db
      .collection("songs")
      .updateOne({ _id: new ObjectId(songId) }, { $set: { audioId } });
    console.log(res.matchedCount ? `Attached to song ${songId}.` : `No song matched ${songId}.`);
  }
} catch (err) {
  console.error("Upload failed:", err);
  process.exitCode = 1;
} finally {
  await client.close();
}
