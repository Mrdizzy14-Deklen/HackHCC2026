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
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-name">MUSIC<em>·</em>DADDY</div>
      </div>
      <div className="nav-tabs">
        <Link className={"nav-tab " + (pathname === "/library" ? "active" : "")} href="/library">Library</Link>
        <Link className={"nav-tab " + (pathname === "/leaderboard" ? "active" : "")} href="/leaderboard">Leaderboard</Link>
      </div>
      <div className="user-chip">
        <span title={displayName}>{handle}</span>
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
