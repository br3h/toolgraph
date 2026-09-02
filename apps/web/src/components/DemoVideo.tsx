'use client';

/**
 * The product demo on the landing page.
 *
 * A short screen recording does more to explain a visual tool than any amount
 * of prose, so it sits directly under the hero where it is the first thing
 * anyone sees after the headline.
 *
 * It degrades rather than breaking. If no recording has been added yet — or the
 * file 404s, or the browser cannot decode it — the component renders the static
 * diagram it was given instead. A marketing page must never show a broken video
 * element, and a missing file should not be visible to visitors at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DemoVideoProps {
  /** Path or URL to the recording. */
  src: string;
  /** Still frame shown before playback starts. */
  poster?: string | undefined;
  /** Rendered in place of the video when it cannot be shown. */
  fallback: React.ReactNode;
  caption?: string;
}

export function DemoVideo({ src, poster, fallback, caption }: DemoVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);

    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  /**
   * A `src` that 404s fires `error` on the inner <source>, not on the video, so
   * both are wired. Without this the page would show a black rectangle.
   */
  const onError = useCallback(() => setFailed(true), []);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video
        .play()
        .then(() => setPlaying(true))
        .catch(() => setFailed(true));
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  if (failed) return <>{fallback}</>;

  return (
    <figure className="m-0">
      <div className="relative overflow-hidden rounded-[var(--tg-radius-lg)] border border-border bg-bg-sunken shadow-[var(--tg-shadow-lg)]">
        {/* A slim title bar: it reads as an application window without
            pretending to be a specific browser's chrome. */}
        <div className="flex items-center gap-1.5 border-b border-border-subtle bg-bg-subtle px-3 py-2">
          <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" />
          <span className="ml-2 font-mono text-[10px] text-fg-subtle">
            Toolgraph — connecting two MCP tools
          </span>
        </div>

        <div className="relative aspect-video w-full bg-bg">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            // Muted autoplay is the only kind browsers allow without a gesture.
            // Under prefers-reduced-motion it waits for an explicit press.
            autoPlay={!reducedMotion}
            muted
            loop
            playsInline
            preload="metadata"
            controls
            {...(poster ? { poster } : {})}
            onError={onError}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            aria-label="A screen recording of Toolgraph: connecting two MCP tools and seeing the type check reject a mismatched field."
          >
            <source src={src} type="video/mp4" onError={onError} />
          </video>

          {reducedMotion && !playing ? (
            <button
              type="button"
              onClick={toggle}
              className="absolute inset-0 flex items-center justify-center bg-[var(--tg-overlay)] text-sm font-semibold text-fg-inverse"
            >
              Play the demo
            </button>
          ) : null}
        </div>
      </div>

      {caption ? (
        <figcaption className="mt-3 text-center text-xs text-fg-subtle">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
