import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { generateTypeScript } from './typescript';
import { allFixtures, simpleChain } from './fixtures';
import type { GeneratedFile } from './contract';

/**
 * Compile the generated TypeScript for real.
 *
 * A snapshot test would pass on code that does not compile, which is exactly the
 * failure this feature cannot afford: the whole promise is that the export is
 * usable. So the compiler runs over the emitted files with `strict: true`, and
 * only unresolved-module errors for `zod` and the MCP SDK are tolerated —
 * those packages are genuinely absent from this repo, and are declared in the
 * generated package.json.
 */
function compile(files: GeneratedFile[]): ts.Diagnostic[] {
  const sources = new Map(
    files
      .filter((file) => file.path.endsWith('.ts'))
      .map((file) => [file.path, file.contents] as const),
  );

  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: false,
  };

  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const contents = sources.get(fileName);
    if (contents !== undefined) {
      return ts.createSourceFile(fileName, contents, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.fileExists = (fileName) => sources.has(fileName) || originalFileExists(fileName);
  host.readFile = (fileName) => sources.get(fileName) ?? originalReadFile(fileName);

  const program = ts.createProgram([...sources.keys()], options, host);

  return [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()].filter(
    // 2307: "Cannot find module". zod and @modelcontextprotocol/sdk are not
    // installed here on purpose — the generated bundle declares them itself.
    (diagnostic) => diagnostic.code !== 2307,
  );
}

function describeDiagnostics(diagnostics: ts.Diagnostic[]): string {
  return diagnostics
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      if (!d.file || d.start === undefined) return `TS${d.code}: ${message}`;
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${d.file.fileName}:${line + 1} TS${d.code}: ${message}`;
    })
    .join('\n');
}

describe('generateTypeScript', () => {
  for (const fixture of allFixtures) {
    it(`produces compiling TypeScript for the ${fixture.name} graph`, async () => {
      const result = await generateTypeScript(fixture.doc, fixture.tools);
      const diagnostics = compile(result.files);

      expect(describeDiagnostics(diagnostics)).toBe('');
      expect(diagnostics).toHaveLength(0);
    });
  }

  it('emits the whole bundle, not just types', async () => {
    const result = await generateTypeScript(simpleChain.doc, simpleChain.tools);
    const paths = result.files.map((file) => file.path).sort();

    expect(paths).toContain('types.ts');
    expect(paths).toContain('schemas.ts');
    expect(paths).toContain('client.ts');
    expect(paths).toContain('run.ts');
    expect(paths).toContain('package.json');
    expect(paths).toContain('README.md');
  });

  it('generates real interfaces from the tools own schemas', async () => {
    const result = await generateTypeScript(simpleChain.doc, simpleChain.tools);
    const types = result.files.find((file) => file.path === 'types.ts')?.contents ?? '';

    // The point of the feature: the shapes are the server's, not `any`.
    expect(types).toMatch(/email/);
    expect(types).toMatch(/userId/);
    expect(types).not.toMatch(/\bany\b/);
  });

  it('wires the edge through to the second call', async () => {
    const result = await generateTypeScript(simpleChain.doc, simpleChain.tools);
    const run = result.files.find((file) => file.path === 'run.ts')?.contents ?? '';

    expect(run).toMatch(/userId/);
    // The static input survives alongside the edge-fed field.
    expect(run).toMatch(/Welcome/);
  });

  it('declares only zod and the MCP SDK in the generated manifest', async () => {
    const result = await generateTypeScript(simpleChain.doc, simpleChain.tools);
    const manifest = result.files.find((file) => file.path === 'package.json')?.contents ?? '{}';
    const parsed = JSON.parse(manifest) as { dependencies?: Record<string, string> };

    const deps = Object.keys(parsed.dependencies ?? {}).sort();
    expect(deps).toEqual(['@modelcontextprotocol/sdk', 'zod']);
  });
});

describe('the zero-dependency guarantee', () => {
  it('never emits an import from toolgraph, in either language', async () => {
    const { generatePython } = await import('./python');

    for (const fixture of allFixtures) {
      const tsResult = await generateTypeScript(fixture.doc, fixture.tools);
      const pyResult = generatePython(fixture.doc, fixture.tools);

      for (const file of [...tsResult.files, ...pyResult.files]) {
        expect(file.contents, `${fixture.name} / ${file.path}`).not.toContain('@toolgraph/');
        expect(file.contents, `${fixture.name} / ${file.path}`).not.toContain(
          'toolgraph/schema-core',
        );
      }
    }
  });
});
