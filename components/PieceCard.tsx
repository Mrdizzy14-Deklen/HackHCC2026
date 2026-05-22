import type { Piece } from "@/lib/data";
import { Ico } from "./icons";
import { Instr } from "./instruments";

export default function PieceCard({ piece }: { piece: Piece }) {
  const Ins = Instr[piece.instr] ?? Instr.clef;
  return (
    <div className="piece">
      <div className="piece-art">
        <span className={"piece-badge " + (piece.live ? "live" : "")}>{piece.tag}</span>
        <div className="piece-instr">{Ins(34)}</div>
        <div className="vinyl" />
      </div>
      <div className="piece-body">
        <div className="piece-meta">
          <span>{piece.date}</span>
          <span>{piece.duration}</span>
        </div>
        <div className="piece-title">{piece.title} <em>{piece.titleEm}</em></div>
        <div className="piece-composer">— {piece.composer}</div>
        <div className="piece-foot">
          <div className="duration"><span style={{ marginRight: 6, opacity: 0.6 }}>{Ico.clock()}</span> {piece.duration}</div>
          <div className="piece-actions">
            <button className="icon-btn" title="Share">{Ico.share()}</button>
            <button className="icon-btn" title="More">{Ico.more()}</button>
            <button className="icon-btn play" title="Play"><span style={{ marginLeft: 2 }}>{Ico.play()}</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}
