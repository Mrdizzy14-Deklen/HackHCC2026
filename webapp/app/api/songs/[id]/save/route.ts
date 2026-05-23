import { NextResponse } from "next/server";
import { saveSong } from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { saves } = await saveSong(id);
    return NextResponse.json({ saves });
  } catch (err) {
    console.error("[api/songs/save]", err);
    return NextResponse.json({ error: "failed to save" }, { status: 500 });
  }
}
