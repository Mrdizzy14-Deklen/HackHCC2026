import { NextResponse } from "next/server";
import { getSongs } from "@/lib/db";

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
