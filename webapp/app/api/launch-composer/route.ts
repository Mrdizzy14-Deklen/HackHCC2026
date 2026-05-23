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

    const child = spawn(python, ["composer-app/main.py"], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    return NextResponse.json({ launched: true, via: "spawn" });
  } catch (err) {
    console.error("[launch-composer]", err);
    return NextResponse.json({ error: "failed to launch composer" }, { status: 500 });
  }
}
