/**
 * Local JSON fallback store — used when MongoDB Atlas is unreachable.
 * Writes to .next/local-songs.json so it survives hot-reloads but not
 * full server restarts (acceptable for hackathon demos).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Piece } from "./data";

const STORE_PATH = path.join(process.cwd(), "local-songs.json");

async function readStore(): Promise<Piece[]> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as Piece[];
  } catch {
    return [];
  }
}

async function writeStore(songs: Piece[]): Promise<void> {
  await fs.writeFile(STORE_PATH, JSON.stringify(songs, null, 2), "utf8");
}

export async function localGetSongs(): Promise<Piece[]> {
  return readStore();
}

export async function localCreateSong(
  input: Omit<Piece, "id" | "titleEm" | "date" | "tag" | "live" | "likes" | "saves">
): Promise<{ id: string }> {
  const songs = await readStore();
  const now = new Date();
  const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
  const id = `local_${Date.now()}`;
  const song: Piece = {
    id,
    titleEm: "",
    date,
    tag: "FINAL",
    live: false,
    likes: 0,
    saves: 0,
    ...input,
  };
  songs.unshift(song);
  await writeStore(songs);
  return { id };
}
