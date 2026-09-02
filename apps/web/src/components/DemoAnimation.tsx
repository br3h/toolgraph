'use client';

/**
 * The homepage product demo.
 *
 * Not a video. It is drawn live, so it is a few kilobytes rather than a few
 * megabytes, stays sharp at any size, follows the light and dark themes, and
 * can never show the black rectangle a failed <video> leaves behind.
 *
 * It is one SVG with a viewBox rather than positioned HTML plus an overlay:
 * every coordinate is then in the same space, so a connection lands exactly on
 * the field row it belongs to at any viewport width, with no measurement, no
 * ResizeObserver and nothing to fall out of sync.
 *
 * It deliberately does not mount React Flow. The real canvas brings its own
 * store and about 140 kB to a page whose job is to load fast, so the node
 * chrome is redrawn here from the same tokens and the same layout — same
 * borders, same monospace type labels, same required marker, same dashed stroke
 * for a rejected edge.
 *
 * The story it tells is the one the product exists for: someone reaches for the
 * obvious field, `user.id`, and it is a number where a string is required. The
 * connection is refused with the specific reason, and the right field is used
 * instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

const VIEW_W = 900;
const VIEW_H = 506;

const NODE_W = 300;
const HEADER_H = 46;
const ROW_H = 26;
const ROW_TOP = 90 + HEADER_H + 8;

const NODE_A_X = 46;
const NODE_B_X = VIEW_W - 46 - NODE_W;
const NODE_Y = 90;

/** Vertical centre of a field row, by index. */
const rowY = (index: number): number => ROW_TOP + index * ROW_H + ROW_H / 2;

interface Field {
  name: string;
  type: string;
  required?: boolean;
}

const OUTPUTS: Field[] = [
  { name: 'user.id', type: 'number' },
  { name: 'user.publicId', type: 'string' },
  { name: 'user.email', type: 'string (email)' },
];

const INPUTS: Field[] = [
  { name: 'userId', type: 'string', required: true },
  { name: 'subject', type: 'string', required: true },
];

const NODE_H = HEADER_H + 8 + OUTPUTS.length * ROW_H + 12;

/** The mismatched attempt: `user.id` is a number, `userId` wants a string. */
const BAD_FROM = 0;
const BAD_TO = 0;
/** The correction: `user.publicId` is already a string. */
const GOOD_FROM = 1;
const GOOD_TO = 0;

const anchorOut = (row: number) => ({ x: NODE_A_X + NODE_W, y: rowY(row) });
const anchorIn = (row: number) => ({ x: NODE_B_X, y: rowY(row) });

/** A horizontal-tangent bezier, the same shape React Flow draws. */
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(60, (to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

type Phase =
  | 'enterA'
  | 'enterB'
  | 'fields'
  | 'drawBad'
  | 'checking'
  | 'reject'
  | 'retract'
  | 'drawGood'
  | 'accept'
  | 'hold'
  | 'reset';

const TIMELINE: { phase: Phase; ms: number }[] = [
  { phase: 'enterA', ms: 620 },
  { phase: 'enterB', ms: 620 },
  { phase: 'fields', ms: 720 },
  { phase: 'drawBad', ms: 1100 },
  { phase: 'checking', ms: 760 },
  { phase: 'reject', ms: 2700 },
  { phase: 'retract', ms: 680 },
  { phase: 'drawGood', ms: 1000 },
  { phase: 'accept', ms: 2400 },
  { phase: 'hold', ms: 900 },
  // Everything fades out here so the wrap reads as the sequence starting over
  // rather than the nodes blinking out of existence.
  { phase: 'reset', ms: 520 },
];

const ORDER: Phase[] = TIMELINE.map((step) => step.phase);
const at = (phase: Phase): number => ORDER.indexOf(phase);

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface DemoAnimationProps {
  /** Shown under the frame. */
  caption?: string;
}

export function DemoAnimation({ caption }: DemoAnimationProps) {
  /*
   * Starts on `fields`, not on `reset`.
   *
   * This is the frame the server renders, and it is what someone sees before
   * hydration finishes — so it has to be populated. Starting on `reset` would
   * paint an empty canvas for the first half second of every cold load, which
   * is exactly the blank rectangle a video would have given us. From here the
   * timeline runs straight into drawing the connection, and the fade-in still
   * happens on every subsequent loop.
   */
  const [step, setStep] = useState(() => ORDER.indexOf('fields'));
  const [reducedMotion, setReducedMotion] = useState(false);
  const [running, setRunning] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  /**
   * Run only while actually on screen and in a foreground tab.
   *
   * A loop that keeps firing timers in a background tab is a battery cost for
   * something nobody is looking at.
   */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setRunning(Boolean(entry?.isIntersecting) && !document.hidden),
      { threshold: 0.25 },
    );
    observer.observe(node);

    const onVisibility = () => setRunning(!document.hidden && isOnScreen(node));
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const advance = useCallback(() => {
    setStep((current) => (current + 1) % TIMELINE.length);
  }, []);

  useEffect(() => {
    if (reducedMotion || !running) return;

    const duration = TIMELINE[step]?.ms ?? 1000;
    timerRef.current = setTimeout(advance, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [step, advance, reducedMotion, running]);

  /*
   * With motion reduced the sequence does not run at all. The frame it holds is
   * the rejection — the one moment that actually explains the product, showing
   * both fields, their types and the reason. Holding the successful connection
   * instead would be prettier and would say nothing.
   */
  const effective = reducedMotion ? at('reject') : step;

  const state = useMemo(() => {
    // `reset` is the last index, so an index comparison would call every phase
    // "reached". It is the empty frame, so it is handled before anything else.
    const isReset = ORDER[effective] === 'reset';
    const reached = (phase: Phase) => !isReset && effective >= at(phase);
    const between = (from: Phase, to: Phase) =>
      !isReset && effective >= at(from) && effective < at(to);

    return {
      showA: reached('enterA'),
      showB: reached('enterB'),
      showFields: reached('fields'),

      // The rejected edge is on screen from the moment it starts drawing until
      // it has finished retracting.
      badEdgeVisible: between('drawBad', 'drawGood'),
      badEdgeDrawn: between('checking', 'retract'),
      badEdgeRetracting: effective === at('retract'),

      checking: effective === at('checking'),
      rejected: between('reject', 'retract'),

      goodEdgeVisible: reached('drawGood'),
      goodEdgeDrawn: reached('accept'),
      accepted: reached('accept'),
    };
  }, [effective]);

  return (
    <figure className="m-0" ref={containerRef}>
      <div className="overflow-hidden rounded-[var(--tg-radius-lg)] border border-border bg-bg-sunken shadow-[var(--tg-shadow-lg)]">
        {/* Reads as an application window without imitating a specific browser. */}
        <div className="flex items-center gap-1.5 border-b border-border-subtle bg-bg-subtle px-3 py-2">
          <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full border border-border-strong" aria-hidden="true" />
          <span className="ml-2 font-mono text-[10px] text-fg-subtle">
            Toolgraph — connecting two MCP tools
          </span>
        </div>

        <div className="relative bg-canvas">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="block h-auto w-full"
            role="img"
            aria-label={
              'Two MCP tools on a canvas. A connection is drawn from createUser’s ' +
              'user.id, a number, into sendEmail’s userId, which requires a string. ' +
              'Toolgraph refuses the connection and reports that userId expects string ' +
              'but createUser provides number. The connection is then made from ' +
              'user.publicId, a string, which is accepted.'
            }
          >
            <defs>
              {/* A faint dot grid, matching the real canvas background. */}
              <pattern id="tg-demo-dots" width="18" height="18" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" className="fill-[var(--tg-canvas-dot)]" />
              </pattern>
            </defs>

            <rect width={VIEW_W} height={VIEW_H} fill="url(#tg-demo-dots)" />

            <ToolNode
              x={NODE_A_X}
              y={NODE_Y}
              title="createUser"
              server="users server"
              side="output"
              fields={OUTPUTS}
              visible={state.showA}
              showFields={state.showFields}
              highlightRow={state.rejected ? BAD_FROM : state.accepted ? GOOD_FROM : null}
              highlightKind={state.rejected ? 'reject' : 'accept'}
            />

            <ToolNode
              x={NODE_B_X}
              y={NODE_Y}
              title="sendEmail"
              server="mail server"
              side="input"
              fields={INPUTS}
              visible={state.showB}
              showFields={state.showFields}
              highlightRow={state.rejected ? BAD_TO : state.accepted ? GOOD_TO : null}
              highlightKind={state.rejected ? 'reject' : 'accept'}
            />

            {/* The rejected attempt. Dashed once refused — the one documented
                exception to the monochrome rule, and a stroke pattern rather
                than a hue, exactly as the real canvas draws it. */}
            {state.badEdgeVisible ? (
              <Edge
                from={anchorOut(BAD_FROM)}
                to={anchorIn(BAD_TO)}
                drawn={state.badEdgeDrawn && !state.badEdgeRetracting}
                invalid={state.rejected}
                pulsing={state.checking}
              />
            ) : null}

            {state.goodEdgeVisible ? (
              <Edge
                from={anchorOut(GOOD_FROM)}
                to={anchorIn(GOOD_TO)}
                drawn={state.goodEdgeDrawn}
                invalid={false}
                pulsing={false}
              />
            ) : null}

            {state.checking ? (
              <Chip x={VIEW_W / 2} y={NODE_Y - 26} label="Checking types…" />
            ) : null}
            {state.accepted ? (
              <Chip x={VIEW_W / 2} y={NODE_Y - 26} label="Types compatible" strong />
            ) : null}

            {state.rejected ? <MismatchCard /> : null}
          </svg>
        </div>
      </div>

      {caption ? (
        <figcaption className="mt-3 text-center text-xs text-fg-subtle">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

function isOnScreen(node: Element): boolean {
  const rect = node.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

interface ToolNodeProps {
  x: number;
  y: number;
  title: string;
  server: string;
  side: 'input' | 'output';
  fields: Field[];
  visible: boolean;
  showFields: boolean;
  highlightRow: number | null;
  highlightKind: 'reject' | 'accept';
}

function ToolNode({
  x,
  y,
  title,
  server,
  side,
  fields,
  visible,
  showFields,
  highlightRow,
  highlightKind,
}: ToolNodeProps) {
  const isOutput = side === 'output';
  const handleX = isOutput ? x + NODE_W : x;

  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 420ms ease-out, transform 420ms ease-out',
      }}
    >
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={10}
        className="fill-[var(--tg-bg-raised)] stroke-[var(--tg-border)]"
        strokeWidth={1}
      />
      <path
        d={`M ${x} ${y + HEADER_H} H ${x + NODE_W}`}
        className="stroke-[var(--tg-border-subtle)]"
        strokeWidth={1}
      />

      <text x={x + 14} y={y + 20} className="fill-[var(--tg-fg)]" fontSize={13} fontWeight={600}>
        {title}
      </text>
      <text x={x + 14} y={y + 36} className="fill-[var(--tg-fg-subtle)]" fontSize={10}>
        {server}
      </text>
      <text
        x={x + NODE_W - 14}
        y={y + 20}
        textAnchor="end"
        className="fill-[var(--tg-fg-subtle)]"
        fontSize={9}
        letterSpacing={1}
      >
        {isOutput ? 'OUTPUT' : 'INPUT'}
      </text>

      {fields.map((field, index) => {
        const cy = rowY(index);
        const highlighted = highlightRow === index;

        return (
          <g
            key={field.name}
            style={{
              opacity: showFields ? 1 : 0,
              transition: `opacity 320ms ease-out ${index * 90}ms`,
            }}
          >
            {highlighted ? (
              <rect
                x={x + 6}
                y={cy - ROW_H / 2 + 2}
                width={NODE_W - 12}
                height={ROW_H - 4}
                rx={4}
                className="fill-transparent stroke-[var(--tg-fg)]"
                strokeWidth={highlightKind === 'reject' ? 1.6 : 1}
                strokeDasharray={highlightKind === 'reject' ? '4 3' : undefined}
              />
            ) : null}

            <text
              x={isOutput ? x + 16 : x + 16}
              y={cy + 4}
              className="fill-[var(--tg-fg)]"
              fontSize={11}
              fontWeight={highlighted ? 700 : 500}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {field.name}
              {field.required ? '*' : ''}
            </text>
            <text
              x={x + NODE_W - 16}
              y={cy + 4}
              textAnchor="end"
              className="fill-[var(--tg-fg-muted)]"
              fontSize={10}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {field.type}
            </text>

            <circle
              cx={handleX}
              cy={cy}
              r={4.5}
              className={
                highlighted
                  ? 'fill-[var(--tg-accent)] stroke-[var(--tg-accent)]'
                  : 'fill-[var(--tg-bg-raised)] stroke-[var(--tg-border-strong)]'
              }
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </g>
  );
}

interface EdgeProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  drawn: boolean;
  invalid: boolean;
  pulsing: boolean;
}

function Edge({ from, to, drawn, invalid, pulsing }: EdgeProps) {
  /*
   * `pathLength={1}` normalises the geometry, so one dash of length 1 covers the
   * whole curve whatever its actual length. Animating the offset from 1 to 0
   * draws it; letting it return to 1 retracts it. No measurement needed.
   */
  return (
    <g>
      <path
        d={edgePath(from, to)}
        fill="none"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={drawn ? 0 : 1}
        className="stroke-[var(--tg-edge)]"
        strokeWidth={pulsing ? 2.4 : 1.8}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 900ms ease-in-out, stroke-width 300ms ease-out' }}
      />

      {/* Drawn on top once refused: the dashed overlay is what carries
          "rejected" at a glance, and it is a pattern, not a colour. */}
      {invalid ? (
        <path
          d={edgePath(from, to)}
          fill="none"
          className="stroke-[var(--tg-canvas-bg)]"
          strokeWidth={3}
          strokeDasharray="6 5"
          style={{ opacity: 0.9 }}
        />
      ) : null}
    </g>
  );
}

function Chip({ x, y, label, strong }: { x: number; y: number; label: string; strong?: boolean }) {
  const width = label.length * 6.2 + 26;
  return (
    <g style={{ animation: 'tg-demo-fade 260ms ease-out both' }}>
      <rect
        x={x - width / 2}
        y={y - 13}
        width={width}
        height={26}
        rx={13}
        className="fill-[var(--tg-bg-raised)] stroke-[var(--tg-border-strong)]"
        strokeWidth={1}
      />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        className="fill-[var(--tg-fg)]"
        fontSize={11}
        fontWeight={strong ? 700 : 500}
      >
        {label}
      </text>
    </g>
  );
}

/** The inline explanation — the thing the whole demo exists to show. */
function MismatchCard() {
  const x = NODE_A_X;
  const y = NODE_Y + NODE_H + 34;
  const width = VIEW_W - NODE_A_X * 2;

  return (
    <g style={{ animation: 'tg-demo-rise 320ms ease-out both' }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={84}
        rx={8}
        className="fill-[var(--tg-bg-raised)] stroke-[var(--tg-border-strong)]"
        strokeWidth={1.5}
      />
      {/* A weight-only accent bar: emphasis without hue. */}
      <rect x={x} y={y} width={3} height={84} className="fill-[var(--tg-fg)]" />

      <text x={x + 18} y={y + 26} className="fill-[var(--tg-fg)]" fontSize={12.5} fontWeight={700}>
        That connection would not type-check
      </text>

      <text
        x={x + 18}
        y={y + 48}
        className="fill-[var(--tg-fg-muted)]"
        fontSize={11.5}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        Field `userId` expects string, but `createUser` provides number.
      </text>

      <text x={x + 18} y={y + 68} className="fill-[var(--tg-fg-subtle)]" fontSize={10.5}>
        output user.id → number · input userId → string · at /user/id
      </text>
    </g>
  );
}
