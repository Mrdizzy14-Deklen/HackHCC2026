"use client";

import { useRef } from "react";

interface FxFrameProps {
  /** path under /public, e.g. "/rain-on-glass.html" */
  src: string;
  className?: string;
  /** tunable params posted to the prototype once it loads */
  params?: Record<string, number>;
}

/**
 * Embeds one of the standalone WebGL prototype wallpapers (rain-on-glass,
 * vinyl-grooves, laser-labyrinth) as a decorative layer. Each prototype
 * listens for `{type:"param", name, value}` messages to tune itself.
 */
export default function FxFrame({ src, className, params }: FxFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  const onLoad = () => {
    if (!params) return;
    const win = ref.current?.contentWindow;
    if (!win) return;
    for (const [name, value] of Object.entries(params)) {
      win.postMessage({ type: "param", name, value }, "*");
    }
  };

  return (
    <iframe
      ref={ref}
      src={src}
      className={className}
      title=""
      tabIndex={-1}
      aria-hidden="true"
      onLoad={onLoad}
    />
  );
}
