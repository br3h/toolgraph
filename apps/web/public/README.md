# Static assets

Files here are served from the site root, so `toolgraph.png` is available at
`/toolgraph.png`.

## The demo video

The landing page shows a screen recording under the hero. It looks for
`/demo.mp4` with `/demo-poster.png` as its still frame, and **falls back to the
static diagram if either is missing** — so the page never shows a broken player
and there is no rush to add one.

To add the recording, drop two files in this directory:

| File              | What it is                                               |
| ----------------- | -------------------------------------------------------- |
| `demo.mp4`        | H.264 MP4, 16:9, ideally under 30 seconds and under 8 MB |
| `demo-poster.png` | A still frame shown before playback begins               |

It autoplays muted and loops, so it should read as an ambient loop rather than
something with narration — no audio track is needed, and one will not be heard.

What it should show, in order, is the thing the product is actually for:

1. Connecting an MCP server and its tools appearing on the canvas.
2. Dragging a compatible field to a compatible field — the connection snaps.
3. Dragging a **mismatched** field, and the inline message naming the field,
   the expected type and the actual type. This is the moment worth recording.
4. Opening the export panel and switching between TypeScript and Python.

To host it elsewhere instead of committing a binary, set
`NEXT_PUBLIC_DEMO_VIDEO_URL` (and optionally `NEXT_PUBLIC_DEMO_VIDEO_POSTER`)
to the CDN URL. If you do, add that origin to the CSP `media-src` in
`apps/web/src/middleware.ts` — it is not currently allowlisted, so a
cross-origin video would be blocked.
