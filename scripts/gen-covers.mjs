// Generate 12 bespoke album covers (SVG) — one per seeded piece.
// Turntable motif: instrument-tinted gradient + vinyl grooves + tonearm,
// with the piece title / composer set like a record label.
//
// Run:  node scripts/gen-covers.mjs   ->  writes public/covers/cover-N.svg
//
// SVGs are rendered via <img>, which can't load webfonts, so we use a
// system serif/mono stack that's elegant everywhere.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "covers");
mkdirSync(outDir, { recursive: true });

// instrument -> palette {bg gradient stops, accent}
const PAL = {
  violin: { a: "#3a0f16", b: "#120608", accent: "#E0444C", ink: "#F3E3E4" },
  cello: { a: "#3a2810", b: "#120c05", accent: "#E0A23C", ink: "#F4EAD9" },
  trumpet: { a: "#123026", b: "#06120d", accent: "#3CD9A0", ink: "#E2F4EC" },
  clef: { a: "#181b3a", b: "#070812", accent: "#6C7CFF", ink: "#E6E8F6" },
};

const SONGS = [
  { title: "Nocturne in", titleEm: "D minor", composer: "Helena Vasquez-Reed", date: "2026.04.18", duration: "14:22", instr: "violin", cat: "MR·001" },
  { title: "Symphony", titleEm: "No. III", composer: "Naomi Hartwell", date: "2026.05.02", duration: "42:08", instr: "cello", cat: "MR·002" },
  { title: "Fanfare for the", titleEm: "Last Hour", composer: "Idris Okafor", date: "2026.05.11", duration: "06:44", instr: "trumpet", cat: "MR·003" },
  { title: "Étude", titleEm: "Op. 12", composer: "Renée Beaumont", date: "2026.03.27", duration: "08:11", instr: "clef", cat: "MR·004" },
  { title: "Concerto for", titleEm: "Two Violas", composer: "Mei-Lin Tanaka", date: "2026.04.30", duration: "28:55", instr: "violin", cat: "MR·005" },
  { title: "Vespers at", titleEm: "Midnight", composer: "Mateo Calloway", date: "2026.05.14", duration: "19:30", instr: "cello", cat: "MR·006" },
  { title: "Overture", titleEm: "in Crimson", composer: "Theo Marchetti", date: "2026.02.09", duration: "11:48", instr: "trumpet", cat: "MR·007" },
  { title: "Suite for", titleEm: "Strings & Bell", composer: "Beatrix Halvorsen", date: "2026.05.20", duration: "22:17", instr: "clef", cat: "MR·008" },
  { title: "Prelude in", titleEm: "B-flat", composer: "Helena Vasquez-Reed", date: "2026.01.22", duration: "05:36", instr: "violin", cat: "MR·009" },
  { title: "Requiem", titleEm: "Fragments", composer: "Anya Petrosian", date: "2026.04.05", duration: "37:14", instr: "cello", cat: "MR·010" },
  { title: "Caprice", titleEm: "No. VII", composer: "Sébastien Vaughn", date: "2026.03.13", duration: "09:02", instr: "trumpet", cat: "MR·011" },
  { title: "Lullaby for", titleEm: "Empty Halls", composer: "Idris Okafor", date: "2026.05.18", duration: "07:49", instr: "clef", cat: "MR·012" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// concentric vinyl grooves
function grooves(cx, cy, accent) {
  let g = "";
  for (let r = 40; r <= 360; r += 10) {
    const o = (0.05 + (r % 30 === 0 ? 0.06 : 0)).toFixed(3);
    g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity="${o}" stroke-width="1"/>`;
  }
  g += `<circle cx="${cx}" cy="${cy}" r="30" fill="${accent}" fill-opacity="0.9"/>`;
  g += `<circle cx="${cx}" cy="${cy}" r="6" fill="#0c0c10"/>`;
  return g;
}

function svg(s, i) {
  const p = PAL[s.instr] || PAL.clef;
  const W = 1000;
  const cx = 720, cy = 700; // record center, lower-right
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.a}"/>
      <stop offset="1" stop-color="${p.b}"/>
    </linearGradient>
    <radialGradient id="vig" cx="0.3" cy="0.25" r="1">
      <stop offset="0.4" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
      <feComposite operator="over" in2="SourceGraphic"/></filter>
  </defs>

  <rect width="${W}" height="${W}" fill="url(#bg)"/>
  <rect width="${W}" height="${W}" fill="url(#vig)"/>

  <!-- vinyl record + tonearm (turntable motif) -->
  <g opacity="0.92">${grooves(cx, cy, p.accent)}</g>
  <g stroke="${p.ink}" stroke-opacity="0.5" fill="none" stroke-width="6" stroke-linecap="round">
    <line x1="970" y1="120" x2="${cx}" y2="${cy}"/>
  </g>
  <circle cx="970" cy="120" r="16" fill="${p.ink}" fill-opacity="0.5"/>
  <rect x="${cx - 18}" y="${cy - 6}" width="60" height="12" rx="4" fill="${p.ink}" fill-opacity="0.5" transform="rotate(38 ${cx} ${cy})"/>

  <!-- film grain -->
  <rect width="${W}" height="${W}" filter="url(#grain)" opacity="0.5"/>

  <!-- label / eyebrow -->
  <circle cx="74" cy="86" r="6" fill="${p.accent}"/>
  <text x="92" y="92" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="22" letter-spacing="6" fill="${p.ink}" fill-opacity="0.75">TREBLE TROUBLE RECORDINGS</text>
  <text x="74" y="150" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="20" letter-spacing="5" fill="${p.ink}" fill-opacity="0.45">${s.cat} · SEASON XII</text>

  <!-- title -->
  <text x="70" y="560" font-family="Georgia, 'Times New Roman', serif" font-size="92" fill="${p.ink}">${esc(s.title)}</text>
  <text x="70" y="660" font-family="Georgia, 'Times New Roman', serif" font-size="96" font-style="italic" fill="${p.ink}">${esc(s.titleEm)}</text>

  <!-- composer + meta -->
  <text x="74" y="744" font-family="Georgia, serif" font-style="italic" font-size="34" fill="${p.accent}">${esc(s.composer)}</text>
  <text x="74" y="930" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="22" letter-spacing="3" fill="${p.ink}" fill-opacity="0.55">${s.date}　·　${s.duration}</text>

  <rect x="20" y="20" width="${W - 40}" height="${W - 40}" fill="none" stroke="${p.ink}" stroke-opacity="0.16" stroke-width="2"/>
</svg>`;
}

SONGS.forEach((s, i) => {
  writeFileSync(join(outDir, `cover-${i + 1}.svg`), svg(s, i));
});
console.log(`Wrote ${SONGS.length} covers to public/covers/`);
