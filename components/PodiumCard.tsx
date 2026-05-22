import type { Leader } from "@/lib/data";

type Kind = "gold" | "silver" | "bronze";

export default function PodiumCard({ l, kind }: { l: Leader; kind: Kind }) {
  const medalCls = kind === "gold" ? "g1" : kind === "silver" ? "g2" : "g3";
  const rankN = kind === "gold" ? "01" : kind === "silver" ? "02" : "03";
  const cardCls = "podium-card" + (kind === "gold" ? " gold" : "");
  const rankCls = "podium-rank" + (kind === "gold" ? " gold" : "");
  const seat = kind === "gold" ? "Maestro of the Season" : kind === "silver" ? "Second Chair" : "Third Chair";

  return (
    <div className={cardCls}>
      <div className={"medal " + medalCls}>{rankN}</div>
      <div className={rankCls}>{seat}</div>
      <div className="podium-name">{l.name} <em>{l.nameEm}</em></div>
      <div className="podium-handle">{l.handle}</div>
      <div className="podium-score">{l.score.toLocaleString()}</div>
      <div className="podium-score-label">Points · {l.pieces} works · {l.weeks} wks at top</div>
    </div>
  );
}
