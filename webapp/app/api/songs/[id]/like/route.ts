import { NextResponse } from "next/server";
import { likeSong } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { likes } = await likeSong(id);
    return NextResponse.json({ likes });
  } catch (err) {
    console.error("[api/songs/like]", err);
    return NextResponse.json({ error: "failed to like" }, { status: 500 });
  }
}
