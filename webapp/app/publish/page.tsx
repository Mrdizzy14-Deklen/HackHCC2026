"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import TopBar from "@/components/TopBar";

function PublishInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();

  const audioId = params.get("audioId");
  const duration = params.get("duration") || undefined;
  const instr = params.get("instr") || undefined;

  const [name, setName] = useState(params.get("name") || "");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const composer = session?.user?.name || "Guest Conductor";
  const handle = session?.user?.email
    ? "@" + session.user.email.split("@")[0]
    : "@guest.conductor";

  async function publish() {
    if (!name.trim()) {
      setError("Give your performance a name.");
      return;
    }
    setPublishing(true);
    setError("");
    try {
      const res = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name.trim(),
          composer,
          composerHandle: handle,
          audioId,
          duration,
          instr,
        }),
      });
      if (!res.ok) throw new Error("publish failed");
      router.push("/library");
    } catch {
      setError("Couldn't publish — try again.");
      setPublishing(false);
    }
  }

  return (
    <div className="scene login-scene fade-in" data-screen-label="Publish">
      <TopBar />

      <div className="login-stack">
        <div className="login-card">
          <h2>Publish your <em>performance.</em></h2>
          <div className="hint">Name it, then send it to your studio</div>

          <div className="field">
            <label>Title</label>
            <div className="field-wrap">
              <input
                autoFocus
                placeholder="e.g. Nocturne in D minor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && publish()}
              />
            </div>
          </div>

          <div className="publish-meta">
            <span>Conductor</span>
            <strong>{composer}</strong>
          </div>

          {audioId ? (
            <audio
              className="publish-audio"
              src={`/api/audio/${audioId}`}
              controls
              preload="none"
            />
          ) : (
            <div className="publish-noaudio">No audio attached — publishing the entry only.</div>
          )}

          {error && <div className="publish-error">{error}</div>}

          <button
            type="button"
            className="btn-google"
            style={{ marginTop: 18 }}
            onClick={publish}
            disabled={publishing}
          >
            {publishing ? "Publishing…" : "Publish to studio"}
          </button>

          <div className="alt-row">or</div>

          <button type="button" className="alt-btn" onClick={() => router.push("/library")}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PublishPage() {
  return (
    <Suspense fallback={null}>
      <PublishInner />
    </Suspense>
  );
}
