# Music Daddy

A digital concert hall for composers and conductors — a Next.js (App Router, TypeScript)
web app with a login hero, a music **Library**, and a **Leaderboard**.

The dark "Midnight Concert" UI is layered over three live WebGL wallpapers
(rain-on-glass, spinning vinyl grooves, laser-labyrinth spotlight) that live in
`public/` and are embedded as decorative `<iframe>` layers.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Auth.js / NextAuth v5** — Google sign-in, with a guest fallback
- Plain global CSS (`app/globals.css`) — ports the original design 1:1

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values (see below)
npm run dev                        # http://localhost:3000
```

`npm run dev` works immediately in **guest mode** — click *Continue as guest
conductor* on the login screen. Google sign-in needs the credentials below.

## Google sign-in setup

1. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** (type: *Web application*).
2. **Authorized JavaScript origins:** `http://localhost:3000`
3. **Authorized redirect URI:** `http://localhost:3000/api/auth/callback/google`
4. Put the client ID/secret into `.env.local`:
   ```
   AUTH_SECRET=...        # already generated for you; or run: npx auth secret
   AUTH_GOOGLE_ID=...
   AUTH_GOOGLE_SECRET=...
   ```
5. Restart `npm run dev`. The *Continue with Google* button now works.

> `.env.local` is gitignored. For production, set the same env vars on your host
> and update the OAuth origins/redirect URI to your deployed domain.

## Project layout

```
app/
  layout.tsx              root layout (fonts + SessionProvider)
  globals.css             full design system
  page.tsx                redirects to /login or /library
  login/page.tsx          hero: rain + vinyl wallpaper, Google / guest sign-in
  library/page.tsx        filterable, searchable grid of works
  leaderboard/page.tsx    podium (laser spotlight) + ranked table
  api/auth/[...nextauth]/ Auth.js route handlers
components/               TopBar, PieceCard, PodiumCard, FxFrame, icons, etc.
lib/
  data.ts                 mock data (pieces, filters, leaders) + types
  auth.ts                 NextAuth config
proxy.ts                  route protection for /library and /leaderboard
public/*.html             the three WebGL wallpaper prototypes
index.html               original single-file design prototype (reference only)
```

## Notes

- Routes `/library` and `/leaderboard` are gated by `proxy.ts`: they require a
  Google session **or** the guest cookie, otherwise they redirect to `/login`.
- The data in `lib/data.ts` is mock. Swap it for API/route-handler calls (or a DB)
  when wiring a real backend.
