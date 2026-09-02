import { ImageResponse } from 'next/og';

/**
 * The social preview card.
 *
 * Drawn here rather than shipped as a PNG so it stays in step with the product
 * — and, more practically, so there is no binary in the repo that somebody has
 * to re-export in a design tool when the wordmark changes.
 *
 * Deliberately typographic and monochrome, which is the whole visual language
 * of this product: no gradient, no screenshot, no stock illustration. The one
 * graphic element is the thing Toolgraph is actually about — two nodes and the
 * edge between them, with the mismatch that would be refused.
 *
 * `next/og` uses Satori, which supports a subset of CSS: flexbox only (every
 * element with more than one child needs an explicit `display: flex`), no
 * `gap` shorthand issues, and no external stylesheet. Hence the inline styles.
 */

/*
 * Deliberately NOT `runtime = 'edge'`.
 *
 * The edge runtime disables static generation for this route, so the card would
 * be rendered on every crawl of every page instead of once at build time. Next
 * warns about exactly this. On the Node runtime it is prerendered and served as
 * a static asset, which is what a social card should be.
 */
export const alt = 'Toolgraph — typed connections between MCP tools, checked before they run';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function Node({ title, field, type }: { title: string; field: string; type: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 300,
        border: '2px solid #1a1a1a',
        borderRadius: 14,
        background: '#ffffff',
      }}
    >
      <div
        style={{
          display: 'flex',
          padding: '14px 18px',
          borderBottom: '2px solid #1a1a1a',
          fontSize: 22,
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '16px 18px',
          fontSize: 20,
          color: '#4a4a4a',
        }}
      >
        <span>{field}</span>
        <span style={{ fontFamily: 'monospace', color: '#1a1a1a' }}>{type}</span>
      </div>
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#ffffff',
        color: '#0a0a0a',
        padding: 64,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
          Toolgraph
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            fontSize: 54,
            fontWeight: 600,
            letterSpacing: -1.5,
            lineHeight: 1.15,
            maxWidth: 900,
          }}
        >
          Wire MCP tools together, and know it works before you run it.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <Node title="get_customer" field="age" type="number" />
        {/* The edge, and the refusal. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: 172,
          }}
        >
          <div style={{ display: 'flex', width: 140, height: 2, background: '#1a1a1a' }} />
          <div
            style={{
              display: 'flex',
              marginTop: 10,
              fontSize: 17,
              fontWeight: 600,
              color: '#1a1a1a',
              border: '2px solid #1a1a1a',
              borderRadius: 8,
              padding: '4px 10px',
              background: '#ffffff',
            }}
          >
            refused
          </div>
        </div>
        <Node title="send_email" field="to" type="string" />
      </div>

      <div style={{ display: 'flex', fontSize: 22, color: '#4a4a4a' }}>
        Type-checked against the tools&apos; real JSON Schemas · Export to TypeScript or Python
      </div>
    </div>,
    size,
  );
}
