import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Protect the in-app pages. Allow through if the user has a real session
// (Google sign-in) OR a lightweight guest cookie set from the login screen.
export default auth((req) => {
  const isAuthed = !!req.auth;
  const isGuest = req.cookies.get("maestro_guest")?.value === "1";

  if (!isAuthed && !isGuest) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  matcher: ["/library/:path*", "/leaderboard/:path*", "/publish/:path*"],
};
