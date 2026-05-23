import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const repoRoot = path.resolve(process.cwd(), "..");
    const composerDir = path.join(repoRoot, "composer-app");
    const isWin = process.platform === "win32";

    if (isWin) {
      const vbs = path.join(composerDir, "launch_hidden.vbs");
      if (fs.existsSync(vbs)) {
        const child = spawn("wscript.exe", [vbs], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
        return NextResponse.json({ launched: true, via: "wscript" });
      }
    }

    const venvPy = isWin
      ? path.join(repoRoot, "venv", "Scripts", "pythonw.exe")
      : path.join(repoRoot, "venv", "bin", "python");

    const python = fs.existsSync(venvPy) ? venvPy : isWin ? "pythonw" : "python3";

    // Check if the server is already up — skip spawning if so.
    let alreadyRunning = false;
    try {
      const probe = await fetch("http://127.0.0.1:5000/api/ping", { signal: AbortSignal.timeout(800) });
      alreadyRunning = probe.ok;
    } catch { /* not running yet */ }

    if (!alreadyRunning) {
      const child = spawn(python, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "5000"], {
        cwd: composerDir,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }

    return NextResponse.json({ launched: true, alreadyRunning, via: "uvicorn" });
  } catch (err) {
    console.error("[launch-composer]", err);
    return NextResponse.json({ error: "failed to launch composer" }, { status: 500 });
  }
}
