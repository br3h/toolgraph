import { describe, expect, it } from 'vitest';
import cssSource from './styles.css?raw';

/**
 * The design system's guardrail.
 *
 * The rule this file enforces: the whole product is one neutral ramp. Every
 * colour literal in `styles.css` must have r === g === b, no colour function
 * that can express a hue may appear at all, and no component may hard-code a
 * colour instead of reaching for a token.
 *
 * The CSS is scanned rather than pattern-matched: comments and strings are
 * removed first, function calls are read by balancing their parentheses, and
 * every channel is parsed to a number. A loose regex would both miss real
 * violations (`rgb(1 2 3)` looks fine to a "no hex" grep) and trip over
 * innocent text (a `#` inside a comment).
 */

/** Vite hands each component's source over verbatim, so the scan needs no fs. */
const componentSources = import.meta.glob('./components/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// --------------------------------------------------------------------------
// A small CSS scanner
// --------------------------------------------------------------------------

function charAt(text: string, index: number): string {
  const char = text[index];
  if (char === undefined) throw new RangeError(`index ${index} is past the end of the input`);
  return char;
}

/**
 * Blank out comments and quoted strings, preserving offsets so reported line
 * numbers still point at the real source.
 */
function stripNoise(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      // Keep newlines so line numbers survive.
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
      continue;
    }

    const char = charAt(source, index);

    if (char === '"' || char === "'") {
      const start = index;
      index += 1;
      while (index < source.length && charAt(source, index) !== char) {
        index += charAt(source, index) === '\\' ? 2 : 1;
      }
      index = Math.min(index + 1, source.length);
      out += source.slice(start, index).replace(/[^\n]/g, ' ');
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (charAt(source, i) === '\n') line += 1;
  }
  return line;
}

const HEX_DIGITS = /^[0-9a-fA-F]+$/;

interface HexLiteral {
  raw: string;
  digits: string;
  line: number;
}

/**
 * Every `#`-prefixed token. A token whose characters are not all hex digits is
 * an identifier (an id selector, a url fragment) and is not a colour.
 */
function findHexLiterals(source: string): HexLiteral[] {
  const found: HexLiteral[] = [];

  for (const match of source.matchAll(/#([0-9a-zA-Z_-]+)/g)) {
    const digits = match[1];
    if (digits === undefined || !HEX_DIGITS.test(digits)) continue;
    found.push({ raw: match[0], digits, line: lineOf(source, match.index) });
  }

  return found;
}

/** The r, g, b channels of a #rgb / #rgba / #rrggbb / #rrggbbaa literal, 0-255. */
function hexChannels(digits: string): [number, number, number] {
  const short = digits.length === 3 || digits.length === 4;
  const width = short ? 1 : 2;

  const channel = (position: number): number => {
    const slice = digits.slice(position * width, position * width + width);
    return Number.parseInt(short ? slice.repeat(2) : slice, 16);
  };

  return [channel(0), channel(1), channel(2)];
}

interface FunctionCall {
  name: string;
  args: string;
  line: number;
}

/** Every `name(...)` call, with arguments read by balancing parentheses. */
function findCalls(source: string): FunctionCall[] {
  const found: FunctionCall[] = [];

  for (const match of source.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)\(/g)) {
    const name = match[1];
    if (name === undefined) continue;

    const open = match.index + match[0].length - 1;
    let depth = 1;
    let index = open + 1;

    while (index < source.length && depth > 0) {
      const char = charAt(source, index);
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      index += 1;
    }

    found.push({
      name: name.toLowerCase(),
      args: source.slice(open + 1, depth === 0 ? index - 1 : index),
      line: lineOf(source, match.index),
    });
  }

  return found;
}

/**
 * The three colour channels of an `rgb()` / `rgba()` call, normalised to 0-1.
 * Both syntaxes are accepted: legacy `rgb(0, 0, 0, .5)` and modern
 * `rgb(0 0 0 / 45%)`. Anything that is not a plain number or percentage — a
 * `var()`, a `calc()` — is rejected, because an unreadable channel cannot be
 * proven neutral.
 */
function rgbChannels(args: string): [number, number, number] {
  const colorPart = args.split('/')[0] ?? '';
  const tokens = colorPart
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '');

  if (tokens.length < 3) {
    throw new SyntaxError(`rgb() needs three channels, got "${args.trim()}"`);
  }

  return [0, 1, 2].map((position) => {
    const token = tokens[position] ?? '';
    const numeric = token.endsWith('%')
      ? Number.parseFloat(token.slice(0, -1)) / 100
      : Number.parseFloat(token) / 255;

    if (!Number.isFinite(numeric)) {
      throw new SyntaxError(`channel ${position} of rgb(${args.trim()}) is not a literal number`);
    }
    return numeric;
  }) as [number, number, number];
}

/** Colour functions that can carry a hue. None of them belongs in this package. */
const HUE_FUNCTIONS = new Set([
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
]);

/** Every CSS named colour that is not a pure neutral. */
const CHROMATIC_KEYWORDS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond blue blueviolet
   brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
   darkblue darkcyan darkgoldenrod darkgreen darkkhaki darkmagenta darkolivegreen darkorange
   darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
   darkturquoise darkviolet deeppink deepskyblue dodgerblue firebrick floralwhite forestgreen
   fuchsia ghostwhite gold goldenrod green greenyellow honeydew hotpink indianred indigo ivory
   khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
   lightgoldenrodyellow lightgreen lightpink lightsalmon lightseagreen lightskyblue
   lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
   mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
   mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
   navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
   paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
   rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna
   skyblue slateblue slategray slategrey springgreen steelblue tan teal thistle tomato turquoise
   violet wheat yellow yellowgreen`
    .split(/\s+/)
    .filter((word) => word !== ''),
);

const css = stripNoise(cssSource);

// --------------------------------------------------------------------------
// The invariant
// --------------------------------------------------------------------------

describe('styles.css is strictly monochrome', () => {
  const hexLiterals = findHexLiterals(css);
  const calls = findCalls(css);

  it('finds colour literals to check, so the scan can never pass vacuously', () => {
    expect(hexLiterals.length).toBeGreaterThan(10);
    expect(
      calls.filter((call) => call.name === 'rgb' || call.name === 'rgba').length,
    ).toBeGreaterThan(0);
  });

  it('writes every hex literal at a legal length', () => {
    const malformed = hexLiterals
      .filter((literal) => ![3, 4, 6, 8].includes(literal.digits.length))
      .map((literal) => `line ${literal.line}: ${literal.raw}`);

    expect(malformed).toEqual([]);
  });

  it('gives every hex literal equal r, g and b channels', () => {
    const chromatic = hexLiterals
      .filter((literal) => [3, 4, 6, 8].includes(literal.digits.length))
      .filter((literal) => {
        const [r, g, b] = hexChannels(literal.digits);
        return r !== g || g !== b;
      })
      .map((literal) => {
        const [r, g, b] = hexChannels(literal.digits);
        return `line ${literal.line}: ${literal.raw} -> r=${r} g=${g} b=${b}`;
      });

    expect(chromatic).toEqual([]);
  });

  it('gives every rgb() and rgba() equal channels', () => {
    const chromatic = calls
      .filter((call) => call.name === 'rgb' || call.name === 'rgba')
      .filter((call) => {
        const [r, g, b] = rgbChannels(call.args);
        return Math.abs(r - g) > 1e-9 || Math.abs(g - b) > 1e-9;
      })
      .map((call) => `line ${call.line}: ${call.name}(${call.args.trim()})`);

    expect(chromatic).toEqual([]);
  });

  it('uses no colour function that can carry a hue', () => {
    const offenders = calls
      .filter((call) => HUE_FUNCTIONS.has(call.name))
      .map((call) => `line ${call.line}: ${call.name}()`);

    expect(offenders).toEqual([]);
  });

  it('uses no chromatic colour keyword', () => {
    const offenders: string[] = [];

    for (const match of css.matchAll(/[a-zA-Z][a-zA-Z0-9-]*/g)) {
      const word = match[0].toLowerCase();
      if (CHROMATIC_KEYWORDS.has(word)) {
        offenders.push(`line ${lineOf(css, match.index)}: ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Components must go through the tokens
// --------------------------------------------------------------------------

/** A hex colour in TSX: three, four, six or eight digits and nothing after. */
const TSX_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;

describe('components carry no colour literals', () => {
  const entries = Object.entries(componentSources).map(([path, source]) => ({
    path,
    source: String(source),
  }));

  it('scanned the component directory', () => {
    // A mistyped glob returns an empty object, which would make every
    // assertion below pass without reading a thing.
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.map((entry) => entry.path)).toContain('./components/Alert.tsx');
  });

  it('contains no hex colour anywhere', () => {
    const offenders = entries.flatMap(({ path, source }) =>
      [...source.matchAll(TSX_HEX)].map(
        (match) => `${path}:${lineOf(source, match.index)}: ${match[0]}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('contains no colour function call', () => {
    const offenders = entries.flatMap(({ path, source }) =>
      findCalls(source)
        .filter(
          (call) => HUE_FUNCTIONS.has(call.name) || call.name === 'rgb' || call.name === 'rgba',
        )
        .map((call) => `${path}:${call.line}: ${call.name}()`),
    );

    expect(offenders).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The scanner itself, so the invariant above is worth something
// --------------------------------------------------------------------------

describe('the monochrome scanner', () => {
  it('ignores a # inside a comment or a string', () => {
    const source = stripNoise(`/* #ff0000 */ a { content: "#00ff00"; color: #111111; }`);
    expect(findHexLiterals(source).map((literal) => literal.raw)).toEqual(['#111111']);
  });

  it('keeps line numbers intact after stripping', () => {
    const source = stripNoise(`a {}\n/* comment\n   spanning lines */\nb { color: #222; }`);
    const [literal] = findHexLiterals(source);
    expect(literal?.line).toBe(4);
  });

  it('skips identifiers that only look like colours', () => {
    expect(findHexLiterals(stripNoise('#app { color: #333; }')).map((l) => l.raw)).toEqual([
      '#333',
    ]);
  });

  it('expands short hex before comparing channels', () => {
    expect(hexChannels('abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(hexChannels('ababab')).toEqual([0xab, 0xab, 0xab]);
    expect(hexChannels('1234')).toEqual([0x11, 0x22, 0x33]);
  });

  it('flags a hex that is off by one in a single channel', () => {
    const [r, g, b] = hexChannels('0a0a0b');
    expect(r === g && g === b).toBe(false);
  });

  it('reads both rgb() syntaxes', () => {
    expect(rgbChannels('0 0 0 / 0.45')).toEqual([0, 0, 0]);
    expect(rgbChannels('255, 255, 255')).toEqual([1, 1, 1]);
    expect(rgbChannels('50%, 50%, 50%')).toEqual([0.5, 0.5, 0.5]);
  });

  it('flags an rgb() with unequal channels', () => {
    const [r, g, b] = rgbChannels('1 2 3');
    expect(r === g && g === b).toBe(false);
  });

  it('refuses a channel it cannot read', () => {
    expect(() => rgbChannels('var(--a) 0 0')).toThrow(SyntaxError);
    expect(() => rgbChannels('0 0')).toThrow(SyntaxError);
  });

  it('balances nested parentheses when reading a call', () => {
    const calls = findCalls('a { background: linear-gradient(90deg, rgb(1 1 1), transparent); }');
    expect(calls.map((call) => call.name)).toEqual(['linear-gradient', 'rgb']);
    expect(calls[0]?.args).toBe('90deg, rgb(1 1 1), transparent');
  });
});
