"use client";

import { useRef, useState } from "react";
import type { Piece } from "@/lib/data";
import { Ico } from "./icons";
import { Instr } from "./instruments";

export default function PieceCard({ piece }: { piece: Piece }) {
  const Ins = Instr[piece.instr] ?? Instr.clef;

  const [likes, setLikes] = useState(piece.likes ?? 0);
  const [saves, setSaves] = useState(piece.saves ?? 0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const PREVIEW_SECONDS = 30; // play only a 30s preview of each track

  const idStr = String(piece.id);
  const canHitApi = typeof piece.id === "string"; // real Mongo docs have string ids

  async function like() {
    setLiked(true);
    setLikes((n) => n + 1); // optimistic
    if (!canHitApi) return;
    try {
      const res = await fetch(`/api/songs/${idStr}/like`, { method: "POST" });
      if (res.ok) {
        const { likes: server } = await res.json();
        setLikes(server);
      }
    } catch {
      /* keep optimistic value */
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setSaved(true);
    setSaves((n) => n + 1); // optimistic
    if (canHitApi) {
      try {
        const res = await fetch(`/api/songs/${idStr}/save`, { method: "POST" });
        if (res.ok) {
          const { saves: server } = await res.json();
          setSaves(server);
        }
      } catch {
        /* keep optimistic value */
      }
    }
    setBusy(false);
  }

  function togglePlay() {
    if (!piece.audioId) return;
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  // Cap playback to a 30s preview.
  function onTimeUpdate() {
    const el = audioRef.current;
    if (el && el.currentTime >= PREVIEW_SECONDS) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
    }
  }

  return (
    <div className="piece">
      <div className={"piece-art" + (playing ? " is-playing" : "")}>
        <span className={"piece-badge " + (piece.live ? "live" : "")}>{piece.tag}</span>
        {piece.coverUrl ? (
          <img className="cover-img" src={piece.coverUrl} alt={`${piece.title} ${piece.titleEm}`} loading="lazy" />
        ) : (
          <div className="piece-instr">{Ins(34)}</div>
        )}
        {/* now-playing record that spins out from behind the sleeve */}
        <div className="now-vinyl" aria-hidden="true" />
      </div>
      <div className="piece-body">
        <div className="piece-meta">
          <span>{piece.date}</span>
        </div>
        <div className="piece-title">{piece.title} <em>{piece.titleEm}</em></div>
        <div className="piece-composer">— {piece.composer}</div>

        <div className="piece-social">
          <button
            className={"social-btn" + (liked ? " active" : "")}
            onClick={like}
            title="Like"
          >
            {Ico.heart(15, liked)} <span>{likes.toLocaleString()}</span>
          </button>
          <button
            className={"social-btn" + (saved ? " active" : "")}
            onClick={save}
            title="Save to studio"
          >
            {Ico.bookmark(15, saved)} <span>{saves.toLocaleString()}</span>
          </button>
        </div>

        <div className="piece-foot">
          <div className="duration"><span style={{ marginRight: 6, opacity: 0.6 }}>{Ico.clock()}</span> {piece.duration}</div>
          <div className="piece-actions">
            <button className="icon-btn" title="Share">{Ico.share()}</button>
            <button className="icon-btn" title="More">{Ico.more()}</button>
            <button
              className={"icon-btn play" + (piece.audioId ? "" : " disabled")}
              title={piece.audioId ? (playing ? "Pause" : "Play") : "No audio yet"}
              onClick={togglePlay}
              disabled={!piece.audioId}
            >
              <span style={{ marginLeft: 2 }}>{Ico.play()}</span>
            </button>
          </div>
        </div>

        {piece.audioId && (
          <audio
            ref={audioRef}
            src={`/api/audio/${piece.audioId}`}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={onTimeUpdate}
            preload="none"
          />
        )}
      </div>
    </div>
  );
}
