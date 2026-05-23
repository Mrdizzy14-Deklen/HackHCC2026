import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getLeaderboard();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/leaderboard]", err);
    return NextResponse.json({ error: "failed to load leaderboard" }, { status: 500 });
  }
}
