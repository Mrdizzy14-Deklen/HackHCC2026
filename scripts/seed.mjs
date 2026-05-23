// Seed the MAESTRO MongoDB with conductors + songs.
//
// Run:  node --env-file=.env.local scripts/seed.mjs
//   (Node 22+ reads MONGODB_URI / MONGODB_DB straight from .env.local)
//
// Idempotent: clears the `songs` and `conductors` collections first.
// Leaves GridFS audio untouched.

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "maestro";

if (!uri) {
  console.error("MONGODB_URI not set. Run: node --env-file=.env.local scripts/seed.mjs");
  process.exit(1);
}

// ---------------------------------------------------------------- conductors
// {name, nameEm, handle, score, pieces, weeks, trend, trendN}
const CONDUCTORS = [
  { name: "Helena", nameEm: "Vasquez-Reed", handle: "@maestra.helena", score: 9847, pieces: 42, weeks: 14, trend: "up", trendN: "+128" },
  { name: "Idris", nameEm: "Okafor", handle: "@i.okafor", score: 9512, pieces: 38, weeks: 11, trend: "up", trendN: "+96" },
  { name: "Mei-Lin", nameEm: "Tanaka", handle: "@meilin.t", score: 9118, pieces: 35, weeks: 9, trend: "down", trendN: "-22" },
  { name: "Sébastien", nameEm: "Vaughn", handle: "@s.vaughn", score: 8804, pieces: 31, weeks: 6, trend: "up", trendN: "+44" },
  { name: "Anya", nameEm: "Petrosian", handle: "@a.petrosian", score: 8612, pieces: 29, weeks: 4, trend: "flat", trendN: "±0" },
  { name: "Theo", nameEm: "Marchetti", handle: "@t.marchetti", score: 8408, pieces: 28, weeks: 5, trend: "up", trendN: "+71" },
  { name: "Olamide", nameEm: "Adesanya", handle: "@o.adesanya", score: 8245, pieces: 27, weeks: 3, trend: "down", trendN: "-12" },
  { name: "Beatrix", nameEm: "Halvorsen", handle: "@bee.halv", score: 8092, pieces: 25, weeks: 4, trend: "up", trendN: "+38" },
  { name: "Caleb", nameEm: "Whitestone", handle: "@c.whitestone", score: 7944, pieces: 24, weeks: 2, trend: "down", trendN: "-58" },
  { name: "Renée", nameEm: "Beaumont", handle: "@r.beaumont", score: 7811, pieces: 23, weeks: 3, trend: "up", trendN: "+19" },
  { name: "Mateo", nameEm: "Calloway", handle: "@m.calloway", score: 7702, pieces: 22, weeks: 2, trend: "flat", trendN: "±0" },
  { name: "Naomi", nameEm: "Hartwell", handle: "@n.hartwell", score: 7588, pieces: 21, weeks: 3, trend: "up", trendN: "+12" },
  { name: "Priya", nameEm: "Raghunathan", handle: "@p.raghu", score: 7466, pieces: 20, weeks: 2, trend: "up", trendN: "+27" },
  { name: "Lucas", nameEm: "Brandt", handle: "@l.brandt", score: 7339, pieces: 19, weeks: 1, trend: "down", trendN: "-9" },
  { name: "Yara", nameEm: "El-Masri", handle: "@yara.elm", score: 7201, pieces: 18, weeks: 2, trend: "up", trendN: "+53" },
  // --- extra fakes to make the table look populated ---
  { name: "Dominic", nameEm: "Pereira", handle: "@d.pereira", score: 7088, pieces: 17, weeks: 1, trend: "up", trendN: "+31" },
  { name: "Saoirse", nameEm: "Byrne", handle: "@s.byrne", score: 6955, pieces: 16, weeks: 1, trend: "down", trendN: "-15" },
  { name: "Kenji", nameEm: "Watanabe", handle: "@k.watanabe", score: 6842, pieces: 16, weeks: 2, trend: "flat", trendN: "±0" },
  { name: "Imani", nameEm: "Okonkwo", handle: "@i.okonkwo", score: 6710, pieces: 15, weeks: 1, trend: "up", trendN: "+22" },
  { name: "Florian", nameEm: "Krause", handle: "@f.krause", score: 6588, pieces: 14, weeks: 1, trend: "up", trendN: "+8" },
  { name: "Camila", nameEm: "Restrepo", handle: "@c.restrepo", score: 6471, pieces: 14, weeks: 1, trend: "down", trendN: "-19" },
  { name: "Aleksander", nameEm: "Nowak", handle: "@a.nowak", score: 6359, pieces: 13, weeks: 1, trend: "flat", trendN: "±0" },
  { name: "Leila", nameEm: "Haddad", handle: "@l.haddad", score: 6244, pieces: 12, weeks: 1, trend: "up", trendN: "+17" },
];

// ---------------------------------------------------------------------- songs
// composerHandle links each song to a conductor above.
const SONGS = [
  { title: "Nocturne in", titleEm: "D minor", composer: "Helena Vasquez-Reed", composerHandle: "@maestra.helena", date: "2026.04.18", duration: "14:22", tag: "DRAFT", instr: "violin", live: false, likes: 312, saves: 88, audioId: null, coverUrl: "/covers/cover-1.svg", audioFile: "19.mp3" },
  { title: "Symphony", titleEm: "No. III", composer: "Naomi Hartwell", composerHandle: "@n.hartwell", date: "2026.05.02", duration: "42:08", tag: "FINAL", instr: "cello", live: false, likes: 174, saves: 51, audioId: null, coverUrl: "/covers/cover-2.svg", audioFile: "88.mp3" },
  { title: "Fanfare for the", titleEm: "Last Hour", composer: "Idris Okafor", composerHandle: "@i.okafor", date: "2026.05.11", duration: "06:44", tag: "REHEARSAL", instr: "trumpet", live: true, likes: 261, saves: 73, audioId: null, coverUrl: "/covers/cover-3.svg", audioFile: "182.mp3" },
  { title: "Étude", titleEm: "Op. 12", composer: "Renée Beaumont", composerHandle: "@r.beaumont", date: "2026.03.27", duration: "08:11", tag: "DRAFT", instr: "clef", live: false, likes: 97, saves: 22, audioId: null, coverUrl: "/covers/cover-4.svg", audioFile: "506.mp3" },
  { title: "Concerto for", titleEm: "Two Violas", composer: "Mei-Lin Tanaka", composerHandle: "@meilin.t", date: "2026.04.30", duration: "28:55", tag: "FINAL", instr: "violin", live: false, likes: 203, saves: 64, audioId: null, coverUrl: "/covers/cover-5.svg", audioFile: "510.mp3" },
  { title: "Vespers at", titleEm: "Midnight", composer: "Mateo Calloway", composerHandle: "@m.calloway", date: "2026.05.14", duration: "19:30", tag: "REHEARSAL", instr: "cello", live: false, likes: 142, saves: 39, audioId: null, coverUrl: "/covers/cover-6.svg", audioFile: "533.mp3" },
  { title: "Overture", titleEm: "in Crimson", composer: "Theo Marchetti", composerHandle: "@t.marchetti", date: "2026.02.09", duration: "11:48", tag: "FINAL", instr: "trumpet", live: false, likes: 188, saves: 47, audioId: null, coverUrl: "/covers/cover-7.svg", audioFile: "577.mp3" },
  { title: "Suite for", titleEm: "Strings & Bell", composer: "Beatrix Halvorsen", composerHandle: "@bee.halv", date: "2026.05.20", duration: "22:17", tag: "DRAFT", instr: "clef", live: true, likes: 121, saves: 30, audioId: null, coverUrl: "/covers/cover-8.svg", audioFile: "599.mp3" },
  { title: "Prelude in", titleEm: "B-flat", composer: "Helena Vasquez-Reed", composerHandle: "@maestra.helena", date: "2026.01.22", duration: "05:36", tag: "FINAL", instr: "violin", live: false, likes: 268, saves: 70, audioId: null, coverUrl: "/covers/cover-9.svg", audioFile: "601.mp3" },
  { title: "Requiem", titleEm: "Fragments", composer: "Anya Petrosian", composerHandle: "@a.petrosian", date: "2026.04.05", duration: "37:14", tag: "REHEARSAL", instr: "cello", live: false, likes: 159, saves: 44, audioId: null, coverUrl: "/covers/cover-10.svg", audioFile: "140.mp3" },
  { title: "Caprice", titleEm: "No. VII", composer: "Sébastien Vaughn", composerHandle: "@s.vaughn", date: "2026.03.13", duration: "09:02", tag: "DRAFT", instr: "trumpet", live: false, likes: 134, saves: 36, audioId: null, coverUrl: "/covers/cover-11.svg", audioFile: "200.mp3" },
  { title: "Lullaby for", titleEm: "Empty Halls", composer: "Idris Okafor", composerHandle: "@i.okafor", date: "2026.05.18", duration: "07:49", tag: "FINAL", instr: "clef", live: false, likes: 215, saves: 58, audioId: null, coverUrl: "/covers/cover-12.svg", audioFile: "288.mp3" },
];

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);

  await db.collection("conductors").deleteMany({});
  await db.collection("songs").deleteMany({});

  const c = await db.collection("conductors").insertMany(
    CONDUCTORS.map((x) => ({ ...x, createdAt: new Date() }))
  );
  const s = await db.collection("songs").insertMany(
    SONGS.map((x) => ({ ...x, createdAt: new Date() }))
  );

  // Helpful indexes.
  await db.collection("conductors").createIndex({ score: -1 });
  await db.collection("conductors").createIndex({ handle: 1 }, { unique: true });
  await db.collection("songs").createIndex({ likes: -1 });

  console.log(`Seeded ${c.insertedCount} conductors, ${s.insertedCount} songs into "${dbName}".`);
} catch (err) {
  console.error("Seed failed:", err);
  process.exitCode = 1;
} finally {
  await client.close();
}
