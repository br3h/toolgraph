/**
 * Vite serves `?raw` imports as the file's source text. The design-system
 * guardrail tests read `styles.css` and the component sources this way rather
 * than through `node:fs`, because this package deliberately compiles with
 * `"types": []` and therefore has no Node globals.
 */
declare module '*.css?raw' {
  const contents: string;
  export default contents;
}

declare module '*.tsx?raw' {
  const contents: string;
  export default contents;
}

/**
 * `import.meta.glob` is a Vite transform, not a runtime call: it is rewritten
 * into a static object of imports before the test ever runs, which is what lets
 * the monochrome guardrail scan the whole component directory without a
 * hand-maintained list. Only the eager `?raw` form is declared, because that is
 * the only form this package uses — and declaring it here rather than pulling
 * in `vite/client` keeps `"types": []` intact.
 */
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
