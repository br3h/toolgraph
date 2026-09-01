import type { ReactElement } from 'react';
import { THEME_STORAGE_KEY } from '../lib/theme';

/**
 * A synchronous snippet for `<head>` that applies the stored theme before the
 * first paint, so a dark-mode reader never gets a white flash.
 *
 * It has to be a string of source rather than a React effect because it must
 * run before the document body is painted, and it has to be inline rather than
 * a fetched file for the same reason. There is no dynamic evaluation here: the
 * text is a fixed literal, the storage key is the only interpolation and it is
 * JSON-escaped, and the app serves it under a nonce so a CSP without
 * `unsafe-inline` still admits exactly this one script.
 */
export const themeInitScript = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var r=document.documentElement;if(m==="light"||m==="dark"){r.setAttribute("data-theme",m);}else{r.removeAttribute("data-theme");}}catch(e){}})();`;

export interface ThemeScriptProps {
  /** The per-request CSP nonce. Without it a strict policy drops the script. */
  nonce?: string;
}

/** Convenience wrapper: render this in `<head>` above everything else. */
export function ThemeScript({ nonce }: ThemeScriptProps): ReactElement {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
