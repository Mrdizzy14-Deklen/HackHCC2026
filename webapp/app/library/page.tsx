"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import PieceCard from "@/components/PieceCard";
import { Ico } from "@/components/icons";
import { PIECES, type Piece } from "@/lib/data";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
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
    if (!q) return pieces;
    return pieces.filter((p) =>
      (p.title + " " + p.titleEm + " " + p.composer).toLowerCase().includes(q)
    );
  }, [search, pieces]);

  return (
    <div className="scene lib-scene fade-in" data-screen-label="Library">
      <TopBar />

      <div className="page-head">
        <div>
          <div className="page-eyebrow"><span className="dot" />Your studio · last opened 14 minutes ago</div>
          <h1 className="page-title">The <em>library.</em></h1>
        </div>
        <div className="head-stats">
          <div className="head-stat"><div className="n">48</div><div className="l">Works</div></div>
          <div className="head-stat"><div className="n">11.2h</div><div className="l">Composed</div></div>
        </div>
      </div>

      <div className="lib-controls">
        <div className="lib-count">
          <span className="lib-count-n">{works.length}</span> works in your studio
        </div>
        <div className="lib-right">
          <div className="search">
            {Ico.search()}
            <input
              placeholder="Search works, composers, opus numbers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="new-btn"><span className="plus">+</span> Compose</button>
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
