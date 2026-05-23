import { NextResponse } from "next/server";
import { getSongs, createSong } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const songs = await getSongs();
    return NextResponse.json({ songs });
  } catch (err) {
    console.error("[api/songs]", err);
    return NextResponse.json({ error: "failed to load songs" }, { status: 500 });
  }
}

// Publish a new song (from the conductor app's /publish flow).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = (body.title || "").toString().trim();
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const composer = (body.composer || "Guest Conductor").toString().trim();
    const composerHandle = (body.composerHandle || "@guest.conductor").toString().trim();

    const { id } = await createSong({
      title,
      composer,
      composerHandle,
      instr: body.instr,
      audioId: body.audioId ?? null,
      duration: body.duration,
      coverUrl: body.coverUrl,
    });
    return NextResponse.json({ id });
  } catch (err) {
    console.error("[api/songs POST]", err);
    return NextResponse.json({ error: "failed to publish song" }, { status: 500 });
  }
}
