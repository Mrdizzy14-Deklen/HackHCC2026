"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

export default function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const user = session?.user;
  const displayName = user?.name ?? "Guest Conductor";
  const handle = user?.email
    ? "@" + user.email.split("@")[0]
    : "@guest.conductor";
  const initial = (user?.name ?? "Guest").trim().charAt(0).toUpperCase() || "G";

  const handleSignOut = async () => {
    // clear the guest cookie either way, then end any real session
    document.cookie = "maestro_guest=; path=/; max-age=0";
    if (session) {
      await signOut({ redirect: false });
    }
    router.push("/login");
  };

  return (
    <div className="topbar">
      <Link href="/login" className="brand" aria-label="Treble Trouble landing">
        <svg
          className="brand-note"
          viewBox="0 0 32 32"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
        >
          <ellipse cx="10" cy="24" rx="5.2" ry="3.6" transform="rotate(-22 10 24)" />
          <rect x="13.6" y="5" width="2.4" height="19.5" />
          <path d="M13.6 5 Q24 7.5 22 17 Q26 10 16 4 Z" />
        </svg>
        <div className="brand-name">TREBLE TROUBLE</div>
        <svg
          className="brand-note"
          viewBox="0 0 32 32"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
        >
          <ellipse cx="10" cy="24" rx="5.2" ry="3.6" transform="rotate(-22 10 24)" />
          <rect x="13.6" y="5" width="2.4" height="19.5" />
          <path d="M13.6 5 Q24 7.5 22 17 Q26 10 16 4 Z" />
        </svg>
      </Link>
      <div className="nav-tabs">
        <Link className={"nav-tab " + (pathname === "/library" ? "active" : "")} href="/library">Library</Link>
        <Link className={"nav-tab " + (pathname === "/leaderboard" ? "active" : "")} href="/leaderboard">Leaderboard</Link>
      </div>
      <div className="user-chip">
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar avatar-img" src={user.image} alt={displayName} />
        ) : (
          <div className="avatar">{initial}</div>
        )}
        <button className="signout" type="button" onClick={handleSignOut}>Sign out</button>
      </div>
    </div>
  );
}
