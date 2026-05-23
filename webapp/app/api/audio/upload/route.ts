import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { getBucket, getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

/**
 * Upload an audio file into GridFS and (optionally) attach it to a song.
 *
 * multipart/form-data:
 *   file    — the audio file (required)
 *   songId  — song _id to attach the audio to (optional)
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const songId = form.get("songId");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    const bucket = await getBucket();
    const buf = Buffer.from(await file.arrayBuffer());
    const upload = bucket.openUploadStream(file.name, {
      metadata: { contentType: file.type || "audio/mpeg" },
    });
    await new Promise<void>((resolve, reject) => {
      Readable.from(buf).pipe(upload).on("finish", resolve).on("error", reject);
    });

    const audioId = upload.id;

    if (typeof songId === "string" && songId) {
      const db = await getDb();
      await db
        .collection("songs")
        .updateOne({ _id: new ObjectId(songId) }, { $set: { audioId } });
    }

    return NextResponse.json({ audioId: audioId.toString() });
  } catch (err) {
    console.error("[api/audio/upload]", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
