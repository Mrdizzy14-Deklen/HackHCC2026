import type { JSX } from "react";

// Simple, geometric icon set (ported from the design prototype).
export const Ico = {
  user: (s = 18): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="3.4" /><path d="M5 19c1.5-3.5 4-5 7-5s5.5 1.5 7 5" /></svg>
  ),
  lock: (s = 18): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
  ),
  search: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" /></svg>
  ),
  play: (s = 12): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>
  ),
  more: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
  ),
  share: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="12" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" /><path d="m8 11 8-4M8 13l8 4" /></svg>
  ),
  baton: (s = 18): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="6" cy="18" r="2.2" /><path d="M8 16 20 4" /></svg>
  ),
  ribbon: (s = 18): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="9" r="5" /><path d="M9 13 7 22l5-3 5 3-2-9" /></svg>
  ),
  star: (s = 18): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m12 4 2.5 5.2 5.5.8-4 4 1 5.6L12 17l-5 2.6 1-5.6-4-4 5.5-.8z" /></svg>
  ),
  clock: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
  ),
  up: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 6 4 16h16z" /></svg>
  ),
  down: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 18 4 8h16z" /></svg>
  ),
  flat: (s = 14): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="11" width="16" height="2" /></svg>
  ),
  heart: (s = 14, filled = false): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6"><path d="M12 20s-7-4.6-9.2-9C1.4 8 2.8 5 5.8 5c1.9 0 3.2 1.2 4.2 2.6C11 6.2 12.3 5 14.2 5c3 0 4.4 3 3 6-2.2 4.4-9.2 9-9.2 9z" /></svg>
  ),
  bookmark: (s = 14, filled = false): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6"><path d="M6 4h12v16l-6-4-6 4z" /></svg>
  ),
  google: (s = 18): JSX.Element => (
    <svg width={s} height={s} viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.9 1.5l2.6-2.5C17 .9 14.8 0 12 0 5.4 0 0 5.4 0 12s5.4 12 12 12c6.9 0 11.5-4.9 11.5-11.7 0-.8-.1-1.4-.2-2H12z" /></svg>
  ),
};
