// ------------------------------ TYPES ------------------------------
export type InstrumentKey = "violin" | "cello" | "trumpet" | "clef";
export type PieceTag = "DRAFT" | "FINAL" | "REHEARSAL";

export interface Piece {
  id: string | number;
  title: string;
  titleEm: string;
  composer: string;
  /** Handle of the conductor who owns this piece — links a song to the leaderboard. */
  composerHandle?: string;
  date: string;
  duration: string;
  tag: PieceTag;
  instr: InstrumentKey;
  live: boolean;
  /** Live like count (drives the owning conductor's leaderboard score). */
  likes?: number;
  /** Times this piece was saved into a studio. */
  saves?: number;
  /** GridFS file id for the audio, streamed via /api/audio/[id]. Null = no audio yet. */
  audioId?: string | null;
  /** Album-cover art (generated SVG under /public/covers). */
  coverUrl?: string;
}

export interface Filter {
  id: string;
  name: string;
  count: number;
}

export type Trend = "up" | "down" | "flat";

export interface Leader {
  rank: number;
  name: string;
  nameEm: string;
  handle: string;
  score: number;
  pieces: number;
  weeks: number;
  trend: Trend;
  trendN: string;
}

export interface RankedConductor {
  rank: number;
  name: string;
  handle: string;
  score: number;
  pieces: number;
  trend: Trend;
  trendN: string;
}

// ------------------------------ SCORING ------------------------------
/** Points a conductor's leaderboard score gains per like on one of their songs. */
export const POINTS_PER_LIKE = 10;

// ------------------------------ MOCK DATA ------------------------------
// `composerHandle` ties each piece to a conductor in the leaderboard, so a like
// on the piece bumps that conductor's score. Several pieces are owned by the
// podium conductors (Helena / Idris / Mei-Lin …) so likes visibly move the top.
export const PIECES: Piece[] = [
  { id: 1,  title: "Nocturne in",    titleEm: "D minor",        composer: "Helena Vasquez-Reed", composerHandle: "@maestra.helena", date: "2026.04.18", duration: "2:02", tag: "DRAFT",     instr: "violin",  live: false, likes: 312, saves: 88, coverUrl: "/covers/cover-1.svg",  audioId: "static_19.mp3"  },
  { id: 2,  title: "Symphony",       titleEm: "No. III",         composer: "Naomi Hartwell",      composerHandle: "@n.hartwell",      date: "2026.05.02", duration: "1:43", tag: "FINAL",     instr: "cello",   live: false, likes: 174, saves: 51, coverUrl: "/covers/cover-2.svg",  audioId: "static_88.mp3"  },
  { id: 3,  title: "Fanfare for the",titleEm: "Last Hour",       composer: "Idris Okafor",        composerHandle: "@i.okafor",        date: "2026.05.11", duration: "1:39", tag: "REHEARSAL", instr: "trumpet", live: true,  likes: 261, saves: 73, coverUrl: "/covers/cover-3.svg",  audioId: "static_140.mp3" },
  { id: 4,  title: "Étude",          titleEm: "Op. 12",          composer: "Renée Beaumont",      composerHandle: "@r.beaumont",      date: "2026.03.27", duration: "1:41", tag: "DRAFT",     instr: "clef",    live: false, likes: 97,  saves: 22, coverUrl: "/covers/cover-4.svg",  audioId: "static_182.mp3" },
  { id: 5,  title: "Concerto for",   titleEm: "Two Violas",      composer: "Mei-Lin Tanaka",      composerHandle: "@meilin.t",        date: "2026.04.30", duration: "2:23", tag: "FINAL",     instr: "violin",  live: false, likes: 203, saves: 64, coverUrl: "/covers/cover-5.svg",  audioId: "static_200.mp3" },
  { id: 6,  title: "Vespers at",     titleEm: "Midnight",        composer: "Mateo Calloway",      composerHandle: "@m.calloway",      date: "2026.05.14", duration: "1:40", tag: "REHEARSAL", instr: "cello",   live: false, likes: 142, saves: 39, coverUrl: "/covers/cover-6.svg",  audioId: "static_288.mp3" },
  { id: 7,  title: "Overture",       titleEm: "in Crimson",      composer: "Theo Marchetti",      composerHandle: "@t.marchetti",     date: "2026.02.09", duration: "1:42", tag: "FINAL",     instr: "trumpet", live: false, likes: 188, saves: 47, coverUrl: "/covers/cover-7.svg",  audioId: "static_506.mp3" },
  { id: 8,  title: "Suite for",      titleEm: "Strings & Bell",  composer: "Beatrix Halvorsen",   composerHandle: "@bee.halv",        date: "2026.05.20", duration: "2:45", tag: "DRAFT",     instr: "clef",    live: true,  likes: 121, saves: 30, coverUrl: "/covers/cover-8.svg",  audioId: "static_510.mp3" },
  { id: 9,  title: "Prelude in",     titleEm: "B-flat",          composer: "Helena Vasquez-Reed", composerHandle: "@maestra.helena",  date: "2026.01.22", duration: "2:45", tag: "FINAL",     instr: "violin",  live: false, likes: 268, saves: 70, coverUrl: "/covers/cover-9.svg",  audioId: "static_533.mp3" },
  { id: 10, title: "Requiem",        titleEm: "Fragments",       composer: "Anya Petrosian",      composerHandle: "@a.petrosian",     date: "2026.04.05", duration: "4:58", tag: "REHEARSAL", instr: "cello",   live: false, likes: 159, saves: 44, coverUrl: "/covers/cover-10.svg", audioId: "static_577.mp3" },
  { id: 11, title: "Caprice",        titleEm: "No. VII",         composer: "Sébastien Vaughn",    composerHandle: "@s.vaughn",        date: "2026.03.13", duration: "2:39", tag: "DRAFT",     instr: "trumpet", live: false, likes: 134, saves: 36, coverUrl: "/covers/cover-11.svg", audioId: "static_599.mp3" },
  { id: 12, title: "Lullaby for",    titleEm: "Empty Halls",     composer: "Idris Okafor",        composerHandle: "@i.okafor",        date: "2026.05.18", duration: "3:25", tag: "FINAL",     instr: "clef",    live: false, likes: 215, saves: 58, coverUrl: "/covers/cover-12.svg", audioId: "static_601.mp3" },
];

export const FILTERS: Filter[] = [
  { id: "all", name: "All Works", count: 48 },
  { id: "final", name: "Final", count: 18 },
  { id: "rehearsal", name: "Rehearsal", count: 7 },
  { id: "draft", name: "Drafts", count: 23 },
  { id: "shared", name: "Shared", count: 12 },
];

export const LEADERS: Leader[] = [
  { rank: 1, name: "Helena", nameEm: "Vasquez-Reed", handle: "@maestra.helena", score: 9847, pieces: 42, weeks: 14, trend: "up", trendN: "+128" },
  { rank: 2, name: "Idris", nameEm: "Okafor", handle: "@i.okafor", score: 9512, pieces: 38, weeks: 11, trend: "up", trendN: "+96" },
  { rank: 3, name: "Mei-Lin", nameEm: "Tanaka", handle: "@meilin.t", score: 9118, pieces: 35, weeks: 9, trend: "down", trendN: "-22" },
];

export const RANKED: RankedConductor[] = [
  { rank: 4, name: "Sébastien Vaughn", handle: "@s.vaughn", score: 8804, pieces: 31, trend: "up", trendN: "+44" },
  { rank: 5, name: "Anya Petrosian", handle: "@a.petrosian", score: 8612, pieces: 29, trend: "flat", trendN: "±0" },
  { rank: 6, name: "Theo Marchetti", handle: "@t.marchetti", score: 8408, pieces: 28, trend: "up", trendN: "+71" },
  { rank: 7, name: "Olamide Adesanya", handle: "@o.adesanya", score: 8245, pieces: 27, trend: "down", trendN: "-12" },
  { rank: 8, name: "Beatrix Halvorsen", handle: "@bee.halv", score: 8092, pieces: 25, trend: "up", trendN: "+38" },
  { rank: 9, name: "Caleb Whitestone", handle: "@c.whitestone", score: 7944, pieces: 24, trend: "down", trendN: "-58" },
  { rank: 10, name: "Renée Beaumont", handle: "@r.beaumont", score: 7811, pieces: 23, trend: "up", trendN: "+19" },
  { rank: 11, name: "Mateo Calloway", handle: "@m.calloway", score: 7702, pieces: 22, trend: "flat", trendN: "±0" },
  { rank: 12, name: "Naomi Hartwell", handle: "@n.hartwell", score: 7588, pieces: 21, trend: "up", trendN: "+12" },
  { rank: 13, name: "Priya Raghunathan", handle: "@p.raghu", score: 7466, pieces: 20, trend: "up", trendN: "+27" },
  { rank: 14, name: "Lucas Brandt", handle: "@l.brandt", score: 7339, pieces: 19, trend: "down", trendN: "-9" },
  { rank: 15, name: "Yara El-Masri", handle: "@yara.elm", score: 7201, pieces: 18, trend: "up", trendN: "+53" },
];
