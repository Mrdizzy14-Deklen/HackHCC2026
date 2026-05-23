import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getBucket, getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const songId = form.get("songId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Try GridFS first; fall back to local public/uploads when Atlas is unreachable.
  try {
    const bucket = await getBucket();
    const upload = bucket.openUploadStream(file.name, {
      metadata: { contentType: file.type || "audio/wav" },
    });
    await new Promise<void>((resolve, reject) => {
      Readable.from(buf).pipe(upload).on("finish", resolve).on("error", reject);
    });
    const audioId = upload.id;
    if (typeof songId === "string" && songId) {
      const db = await getDb();
      await db.collection("songs").updateOne(
        { _id: new ObjectId(songId) },
        { $set: { audioId } }
      );
    }
    return NextResponse.json({ audioId: audioId.toString() });
  } catch {
    // Atlas unreachable — save locally so the publish flow still works.
    const ext = file.name.split(".").pop() || "wav";
    const localName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, localName), buf);
    console.warn("[api/audio/upload] Atlas down — saved locally as", localName);
    return NextResponse.json({ audioId: `local_${localName}` });
  }
}
