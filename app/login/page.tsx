"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import FxFrame from "@/components/FxFrame";
import { Ico } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();

  // already signed in? skip the hero.
  useEffect(() => {
    if (status === "authenticated") router.replace("/library");
  }, [status, router]);

  const continueAsGuest = () => {
    document.cookie = "maestro_guest=1; path=/; max-age=86400";
    router.push("/library");
  };

  return (
    <div className="scene login-scene fade-in" data-screen-label="Login">
      {/* shared rain wallpaper comes from the layout; the spinning vinyl groove
          is screen-blended on top of it as the hero centerpiece */}
      <FxFrame
        className="fx-layer fx-vinyl"
        src="/vinyl-grooves.html"
        params={{ ROTATION_SPEED: 0.6, GROOVE_DENSITY: 1.0 }}
      />

      <div className="login-stack">
        <div className="login-brand">
          <div className="brand-mark" />
          <div className="brand-name">MUSIC<em>·</em>DADDY</div>
        </div>

        <div className="login-card">
          <h2>Take the <em>podium.</em></h2>
          <div className="hint">Sign in to your studio</div>

          <button
            type="button"
            className="btn-google"
            onClick={() => signIn("google", { callbackUrl: "/library" })}
          >
            {Ico.google()} Continue with Google
          </button>

          <div className="alt-row">or</div>

          <button type="button" className="alt-btn" onClick={continueAsGuest}>
            Continue as guest conductor
          </button>
        </div>
      </div>
    </div>
  );
}
