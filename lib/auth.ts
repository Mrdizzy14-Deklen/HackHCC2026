import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Reads credentials from env vars:
 *   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET  — Google OAuth client
 *   AUTH_SECRET                         — session encryption key
 *
 * See .env.local.example for setup instructions.
 */
// Only register Google when its credentials are present, so the app still
// builds and runs in guest mode before OAuth is configured.
const providers =
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers,
  pages: {
    signIn: "/login",
  },
});
