import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { generatePython } from './python';
import { allFixtures, arraysAndEnums, simpleChain } from './fixtures';

/**
 * Whether a usable python3 is on PATH.
 *
 * When it is not, the compile assertions are skipped rather than failed — CI
 * must not depend on a Python toolchain. The skip is explicit and visible in the
 * test output, so an absent interpreter can never be mistaken for a pass.
 */
function pythonAvailable(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function pydanticAvailable(): boolean {
  if (!pythonAvailable()) return false;
  const result = spawnSync('python3', ['-c', 'import pydantic'], { stdio: 'pipe' });
  return result.status === 0;
}

const HAS_PYTHON = pythonAvailable();
const HAS_PYDANTIC = pydanticAvailable();

const tempDirs: string[] = [];

function writeBundle(files: { path: string; contents: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'toolgraph-py-'));
  tempDirs.push(dir);
  for (const file of files) {
    writeFileSync(join(dir, file.path), file.contents, 'utf8');
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('generatePython', () => {
  it('emits the whole bundle', () => {
    const result = generatePython(simpleChain.doc, simpleChain.tools);
    const paths = result.files.map((file) => file.path).sort();

    expect(paths).toEqual(['README.md', 'client.py', 'models.py', 'requirements.txt', 'run.py']);
  });

  it('declares only pydantic and mcp', () => {
    const result = generatePython(simpleChain.doc, simpleChain.tools);
    const requirements = result.files.find((f) => f.path === 'requirements.txt')?.contents ?? '';

    expect(requirements).toMatch(/pydantic/);
    expect(requirements).toMatch(/mcp/);
    expect(requirements).not.toMatch(/toolgraph/);
  });

  it('generates Pydantic models from the tools own schemas', () => {
    const result = generatePython(simpleChain.doc, simpleChain.tools);
    const models = result.files.find((f) => f.path === 'models.py')?.contents ?? '';

    expect(models).toContain('from pydantic import BaseModel');
    expect(models).toContain('from __future__ import annotations');
    expect(models).toMatch(/class \w*Input\(BaseModel\):/);
    expect(models).toMatch(/email: str/);
  });

  it('aliases a field whose wire name is a Python keyword', () => {
    const result = generatePython(arraysAndEnums.doc, arraysAndEnums.tools);
    const models = result.files.find((f) => f.path === 'models.py')?.contents ?? '';

    // `class` and `from` cannot be Python attribute names; both need an alias
    // or the model would serialise the wrong key.
    expect(models).toMatch(/alias="class"/);
    expect(models).toMatch(/alias="from"/);
    expect(models).not.toMatch(/^\s+class: /m);
  });

  it('renders an enum as a Literal', () => {
    const result = generatePython(arraysAndEnums.doc, arraysAndEnums.tools);
    const models = result.files.find((f) => f.path === 'models.py')?.contents ?? '';

    expect(models).toMatch(/Literal\["fast", "thorough"\]/);
  });

  it('renders an array of objects as a list of models', () => {
    const result = generatePython(arraysAndEnums.doc, arraysAndEnums.tools);
    const models = result.files.find((f) => f.path === 'models.py')?.contents ?? '';

    expect(models).toMatch(/list\[\w+\]/);
  });

  it('orders the run by the graph topology', () => {
    const result = generatePython(simpleChain.doc, simpleChain.tools);
    const run = result.files.find((f) => f.path === 'run.py')?.contents ?? '';

    expect(run.indexOf('create_user')).toBeLessThan(run.indexOf('send_email'));
    expect(run).toContain('async def run_graph');
  });

  it('warns rather than inventing a type when a tool declares no output schema', () => {
    const tools = simpleChain.tools.map((tool) =>
      tool.name === 'create_user' ? { ...tool, outputSchema: undefined } : tool,
    );
    const result = generatePython(simpleChain.doc, tools);

    expect(result.warnings.join(' ')).toMatch(/create_user/);
    expect(result.warnings.join(' ')).toMatch(/output schema/i);
  });
});

describe.skipIf(!HAS_PYTHON)('the generated Python actually compiles', () => {
  for (const fixture of allFixtures) {
    it(`py_compile accepts the ${fixture.name} bundle`, () => {
      const result = generatePython(fixture.doc, fixture.tools);
      const dir = writeBundle(result.files.filter((file) => file.path.endsWith('.py')));

      for (const file of result.files.filter((f) => f.path.endsWith('.py'))) {
        const compiled = spawnSync('python3', ['-m', 'py_compile', join(dir, file.path)], {
          encoding: 'utf8',
        });

        expect(compiled.status, `${file.path} failed to compile:\n${compiled.stderr}`).toBe(0);
      }
    });
  }
});

describe.skipIf(!HAS_PYDANTIC)('the generated models validate', () => {
  it('accepts a correct payload and rejects a wrong one', () => {
    const result = generatePython(simpleChain.doc, simpleChain.tools);
    const dir = writeBundle(result.files.filter((file) => file.path.endsWith('.py')));

    const probe = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(dir)})`,
      'from models import CreateUserInput',
      'from pydantic import ValidationError',
      'CreateUserInput.model_validate({"email": "a@b.com"})',
      'try:',
      '    CreateUserInput.model_validate({})',
      '    print("MISSING_REQUIRED_ACCEPTED")',
      'except ValidationError:',
      '    print("OK")',
    ].join('\n');

    const run = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.stdout.trim()).toBe('OK');
  });
});

// Make the environment's capabilities visible in the output, so a skipped
// suite is never quietly read as a passing one.
describe('environment', () => {
  it('reports whether the Python checks could run', () => {
    if (!HAS_PYTHON) {
      console.warn('python3 not found — the Python compile checks were skipped.');
    }
    if (HAS_PYTHON && !HAS_PYDANTIC) {
      console.warn('pydantic not installed — the model validation check was skipped.');
    }
    expect(typeof HAS_PYTHON).toBe('boolean');
  });
});
