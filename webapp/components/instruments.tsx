import type { JSX } from "react";
import type { InstrumentKey } from "@/lib/data";

// Stylized instrument silhouettes — ornamental marks (ported from the prototype).
export const Instr: Record<InstrumentKey, (s?: number) => JSX.Element> = {
  trumpet: (s = 44) => (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M6 32h36" /><circle cx="46" cy="32" r="2" /><circle cx="52" cy="32" r="2" />
      <path d="M58 24v16l-12-4v-8z" /><circle cx="20" cy="28" r="2" /><circle cx="28" cy="28" r="2" /><circle cx="36" cy="28" r="2" />
    </svg>
  ),
  cello: (s = 44) => (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M32 6v14M28 16h8" />
      <ellipse cx="32" cy="40" rx="14" ry="18" />
      <path d="M32 22v36M22 36c0-2 2-4 4-4M42 36c0-2-2-4-4-4" />
    </svg>
  ),
  violin: (s = 44) => (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M14 8h6v6h-6zM22 14l28 32M44 50c2 6 8 6 8 2s-4-6-8-6c-3 0-5 1-5 4z" />
      <path d="M20 14 8 50" />
    </svg>
  ),
  clef: (s = 44) => (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M32 6c-6 6-6 14 0 22s6 16 0 22c-4 4-12 4-12-4 0-6 4-8 8-8 6 0 10 6 8 14-2 8-12 8-16 4" />
    </svg>
  ),
};
