# Static assets

Everything in this directory is served from the site root, so `toolgraph.png`
is available at `/toolgraph.png`.

This is the only `public/` Next serves. There is a second one at the repository
root, which exists solely so the logo renders in `README.md` on GitHub — Next
never reads it. Putting an asset only there is why the logo 404'd in production
once; anything the app links to belongs here.

## Icons

The favicon uses Next's App Router file convention, from `apps/web/src/app/`
rather than this directory:

| File             | Serves as         | Notes                                 |
| ---------------- | ----------------- | ------------------------------------- |
| `favicon.ico`    | `/favicon.ico`    | Multi-size ICO: 16, 32, 48 and 64 px  |
| `icon.png`       | `/icon.png`       | 32 px, for browsers that prefer PNG   |
| `apple-icon.png` | `/apple-icon.png` | 180 px, for iOS home-screen bookmarks |

Do **not** add an `icons` block to the metadata in `layout.tsx`. Doing so
overrides this convention and emits a single bare `<link rel="icon">` with no
`sizes` or `type`, which browsers pick badly for a 16 px tab — and it leaves
`/favicon.ico` unserved, which is the first thing most clients request.

## There is no demo video

The homepage demo is drawn live in the browser by
`src/components/DemoAnimation.tsx` — React and SVG, no media file. It is a few
kilobytes instead of several megabytes, stays sharp at any size, follows the
theme, and cannot leave the black rectangle a failed `<video>` does.

If you want to change what it shows, edit the `OUTPUTS`, `INPUTS` and `TIMELINE`
constants at the top of that component; the layout derives from them.
