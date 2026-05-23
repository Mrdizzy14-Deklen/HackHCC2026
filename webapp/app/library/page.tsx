"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import PieceCard from "@/components/PieceCard";
import { Ico } from "@/components/icons";
import { PIECES, type Piece } from "@/lib/data";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [launching, setLaunching] = useState(false);
  // Start from mock so the grid is never empty; swap in DB songs once loaded.
  const [pieces, setPieces] = useState<Piece[]>(PIECES);

  useEffect(() => {
    let alive = true;
    fetch("/api/songs")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d.songs) && d.songs.length) setPieces(d.songs);
      })
      .catch(() => {/* keep mock */});
    return () => {
      alive = false;
    };
  }, []);

  const works = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? pieces.filter((p) =>
          (p.title + " " + p.titleEm + " " + p.composer).toLowerCase().includes(q)
        )
      : pieces;
    // Rotate through /img1.jpeg … /img6.jpeg by original index for stable covers.
    return filtered.map((p) => ({
      ...p,
      coverUrl: `/img${(pieces.indexOf(p) % 6) + 1}.jpeg`,
    }));
  }, [search, pieces]);

  return (
    <div className="scene lib-scene fade-in" data-screen-label="Library">
      <TopBar />

      <div className="lib-controls">
        <h1 className="page-title">The <em>library.</em></h1>
        <div className="lib-right">
          <div className="search">
            {Ico.search()}
            <input
              placeholder="Search works, composers, opus numbers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="new-btn"
            disabled={launching}
            onClick={async () => {
              setLaunching(true);
              try {
                await fetch("/api/launch-composer", { method: "POST" });
                // Give uvicorn ~2 s to bind the port, then open the composer.
                await new Promise((r) => setTimeout(r, 2000));
                window.open("http://localhost:5000", "_blank");
              } finally {
                setLaunching(false);
              }
            }}
          >
            <span className="plus">+</span> {launching ? "Launching…" : "Compose"}
          </button>
        </div>
      </div>

      <div className="library">
        {works.map((p) => (
          <PieceCard key={p.id} piece={p} />
        ))}
      </div>
    </div>
  );
}
