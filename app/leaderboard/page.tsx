"use client";

import TopBar from "@/components/TopBar";
import PodiumCard from "@/components/PodiumCard";
import FxFrame from "@/components/FxFrame";
import { Ico } from "@/components/icons";
import { LEADERS, RANKED } from "@/lib/data";

export default function LeaderboardPage() {
  return (
    <div className="scene lb-scene fade-in" data-screen-label="Leaderboard">
      <TopBar />

      <div className="page-head">
        <div>
          <div className="page-eyebrow"><span className="dot" />Season XII · 14 days remaining</div>
          <h1 className="page-title">The <em>podium.</em></h1>
        </div>
        <div className="head-stats">
          <div className="head-stat"><div className="n">4,812</div><div className="l">Conductors</div></div>
          <div className="head-stat"><div className="n">#37</div><div className="l">Your rank</div></div>
          <div className="head-stat"><div className="n">+128</div><div className="l">This week</div></div>
        </div>
      </div>

      <div className="lb-wrap">
        <div className="lb-main">
          <div className="podium">
            {/* laser-labyrinth, tamed into a calm overhead spotlight on the top 3 */}
            <FxFrame
              className="fx-spot"
              src="/laser-labyrinth.html"
              params={{ SWEEP_SPEED: 0.22, BEAM_INTENSITY: 1.2 }}
            />
            <PodiumCard l={LEADERS[1]} kind="silver" />
            <PodiumCard l={LEADERS[0]} kind="gold" />
            <PodiumCard l={LEADERS[2]} kind="bronze" />
          </div>

          <div className="ranks">
            <div className="ranks-head">
              <div>Rank</div><div>Conductor</div><div>Works</div><div>Trend</div><div>Score</div><div>Δ</div>
            </div>
            {RANKED.map((r) => (
              <div className="rank-row" key={r.rank}>
                <div className="rank-num">{String(r.rank).padStart(2, "0")}</div>
                <div className="rank-user">
                  <div className="avatar">{r.name.split(" ")[0][0]}</div>
                  <div className="who">
                    <div className="name">{r.name}</div>
                    <div className="handle">{r.handle}</div>
                  </div>
                </div>
                <div className="rank-meta">{r.pieces} works</div>
                <div className={"rank-meta " + r.trend}>
                  {r.trend === "up" ? Ico.up() : r.trend === "down" ? Ico.down() : Ico.flat()}
                </div>
                <div className="rank-score">{r.score.toLocaleString()}</div>
                <div className={"rank-meta " + r.trend} style={{ textAlign: "right" }}>{r.trendN}</div>
              </div>
            ))}
          </div>
        </div>

        <aside className="lb-side">
          <div className="side-card">
            <div className="side-eyebrow">Featured baton</div>
            <h3>The Vasquez-Reed <em>Cadenza.</em></h3>
            <div className="side-body">
              Helena&apos;s &ldquo;Nocturne in D minor&rdquo; held the top of the charts for the fourteenth
              consecutive week — the longest streak this season.
            </div>
            <div className="season-bar"><div className="season-fill" /></div>
            <div className="season-meta"><span>WK 14 / 22</span><span>62% complete</span></div>
          </div>

          <div className="side-card">
            <div className="side-eyebrow">Your accolades</div>
            <h3>This week&apos;s <em>laurels.</em></h3>
            <div className="accolades">
              <div className="accolade">
                <div className="ico">{Ico.ribbon()}</div>
                <div>
                  <div className="t">Conductor of the Week</div>
                  <div className="d">+250 PTS · 18 MAY 2026</div>
                </div>
              </div>
              <div className="accolade">
                <div className="ico">{Ico.star()}</div>
                <div>
                  <div className="t">Première · &ldquo;Fanfare for the Last Hour&rdquo;</div>
                  <div className="d">+180 PTS · 11 MAY 2026</div>
                </div>
              </div>
              <div className="accolade">
                <div className="ico">{Ico.baton()}</div>
                <div>
                  <div className="t">Flawless tempo · 14 bars in a row</div>
                  <div className="d">+90 PTS · 09 MAY 2026</div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
