import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getBucket, getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Static sample audio: ids starting with "static_" are served from public/audio/
  if (id.startsWith("static_")) {
    const fileName = id.slice(7);
    const filePath = path.join(process.cwd(), "public", "audio", fileName);
    try {
      const data = await fs.readFile(filePath);
      return new Response(data, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(data.length),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  // Local fallback: ids starting with "local_" were saved to public/uploads/
  if (id.startsWith("local_")) {
    const localName = id.slice(6);
    const filePath = path.join(process.cwd(), "public", "uploads", localName);
    try {
      const data = await fs.readFile(filePath);
      const ext = localName.split(".").pop() || "wav";
      const mime = ext === "mp3" ? "audio/mpeg" : "audio/wav";
      return new Response(data, {
        headers: {
          "Content-Type": mime,
          "Content-Length": String(data.length),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }

  // GridFS path
  let _id: ObjectId;
  try {
    _id = new ObjectId(id);
  } catch {
    return new Response("bad id", { status: 400 });
  }

  try {
    const db = await getDb();
    const file = await db.collection("audio.files").findOne({ _id });
    if (!file) return new Response("not found", { status: 404 });

    const bucket = await getBucket();
    const nodeStream = bucket.openDownloadStream(_id);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": file.contentType || file.metadata?.contentType || "audio/mpeg",
        "Content-Length": String(file.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  } catch {
    return new Response("storage unavailable", { status: 503 });
  }
}
