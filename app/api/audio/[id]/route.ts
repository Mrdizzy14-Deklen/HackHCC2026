import { ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { getBucket, getDb } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

/** Stream an audio file out of GridFS. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let _id: ObjectId;
  try {
    _id = new ObjectId(id);
  } catch {
    return new Response("bad id", { status: 400 });
  }

  const db = await getDb();
  const file = await db.collection("audio.files").findOne({ _id });
  if (!file) return new Response("not found", { status: 404 });

  const bucket = await getBucket();
  const nodeStream = bucket.openDownloadStream(_id);
  // Node Readable → Web ReadableStream for the Fetch Response.
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    headers: {
      "Content-Type": file.contentType || file.metadata?.contentType || "audio/mpeg",
      "Content-Length": String(file.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
