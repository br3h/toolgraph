'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * The last resort: an error in the root layout itself.
 *
 * It replaces the whole document, so it renders its own html and body and
 * cannot rely on globals.css having loaded. The styling is therefore inline,
 * and still monochrome.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          color: '#000000',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>toolgraph could not load</h1>
          <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: '#6e6e6e' }}>
            Something failed before the page could render. The error has been reported.
          </p>
          {error.digest ? (
            <p style={{ marginTop: 16, fontSize: 12, color: '#949494', fontFamily: 'monospace' }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 24,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: '#ffffff',
              background: '#000000',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
