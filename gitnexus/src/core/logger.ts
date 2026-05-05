/**
 * Centralized structured logger for GitNexus.
 *
 * Wraps `pino` so the rest of the codebase imports from one place. Pino's
 * NDJSON output is structurally log-injection-resistant (CWE-117 / CodeQL
 * `js/log-injection`): each record is a single JSON object on its own line,
 * with all string field values JSON-escaped. This replaces hand-rolled
 * sanitizers (see PR #1329 history) that had recurring edge-case gaps
 * (undefined Error.message, U+2028/U+2029, ANSI/C0).
 *
 * Usage:
 *   import { logger, createLogger } from '../core/logger.js';
 *   logger.warn({ groupDir }, 'msg');
 *   const childLogger = createLogger('bridge-db', { debugEnvVar: 'GITNEXUS_DEBUG_BRIDGE' });
 *
 * Operator semantics:
 *   - Default level: 'info' (matches pino default; preserves visibility of
 *     existing `console.log` migrations)
 *   - When `opts.debugEnvVar` is set and that env var is truthy at
 *     createLogger time, that named child logs at level 'debug'
 *   - Output is NDJSON in production / CI / vitest. pino-pretty is used only
 *     when stdout is a TTY AND CI is unset AND VITEST is unset, so test
 *     and pipeline output stay parseable.
 *
 * Test capture:
 *   The exported `logger` singleton is a Proxy that forwards every call to a
 *   lazily-built pino instance. Tests use `_captureLogger()` to redirect that
 *   inner instance to a memory stream so they can assert on records the
 *   production code logged. See `gitnexus/test/unit/logger.test.ts` for the
 *   pattern.
 */
import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';
import { Writable } from 'node:stream';

export interface CreateLoggerOptions {
  /** When set, this env var (truthy at construction time) bumps level to 'debug'. */
  debugEnvVar?: string;
  /** Override destination stream — primarily for tests. */
  destination?: DestinationStream;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function shouldUsePretty(): boolean {
  // Logger writes to stderr (fd 2) so CLI data on stdout (fd 1) stays clean.
  // Pretty-print only when stderr is a TTY and not in CI/test environments.
  return (
    process.stderr.isTTY === true &&
    !isTruthyEnv(process.env.CI) &&
    !isTruthyEnv(process.env.VITEST)
  );
}

/**
 * Default pino destination — writes to stderr (fd 2) so CLI commands can
 * keep stdout (fd 1) clean for tool data output (#324). Pino defaults to
 * stdout; we override here.
 */
function defaultDestination(): DestinationStream {
  return pino.destination({ dest: 2, sync: true });
}

function tryBuildPrettyTransport(): LoggerOptions['transport'] | undefined {
  try {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  } catch {
    return undefined;
  }
}

function buildBaseOptions(): LoggerOptions {
  const opts: LoggerOptions = {
    level: 'info',
    base: undefined,
  };
  if (shouldUsePretty()) {
    const transport = tryBuildPrettyTransport();
    if (transport) opts.transport = transport;
  }
  return opts;
}

/**
 * Create a named child logger. When `opts.destination` is provided it bypasses
 * the default stdout sink (useful for test capture). When `opts.debugEnvVar` is
 * set and truthy at call time, the child runs at 'debug' level.
 */
export function createLogger(name: string, opts?: CreateLoggerOptions): Logger {
  const debugRequested = opts?.debugEnvVar ? isTruthyEnv(process.env[opts.debugEnvVar]) : false;

  if (opts?.destination) {
    return pino(
      { level: debugRequested ? 'debug' : 'info', base: undefined, name },
      opts.destination,
    );
  }

  const base = buildBaseOptions();
  // When using a transport (pino-pretty), pino manages the destination
  // internally and we cannot pass one explicitly. When transport is absent,
  // route to stderr so stdout stays clean for CLI data output.
  const root = base.transport
    ? pino({ ...base, level: debugRequested ? 'debug' : base.level })
    : pino({ ...base, level: debugRequested ? 'debug' : base.level }, defaultDestination());
  return root.child({ name });
}

/* ------------------------------------------------------------------ */
/*  Default singleton (Proxy-backed for test capture)                  */
/* ------------------------------------------------------------------ */

let _activeDestination: DestinationStream | undefined;
let _cached: Logger | undefined;

function _getInner(): Logger {
  if (_cached) return _cached;
  if (_activeDestination) {
    _cached = pino({ level: 'info', base: undefined, name: 'gitnexus' }, _activeDestination);
  } else {
    // Use createLogger so the singleton honors the same stderr-by-default
    // routing as named child loggers (CLI data on stdout stays clean).
    _cached = createLogger('gitnexus');
  }
  return _cached;
}

/**
 * Default singleton logger (`name: 'gitnexus'`). Backed by a Proxy so test
 * capture (`_captureLogger()`) can redirect output without breaking modules
 * that already imported the singleton at module-load time.
 */
export const logger = new Proxy({} as Logger, {
  get(_target, prop) {
    const inner = _getInner();
    const value = (inner as unknown as Record<string | symbol, unknown>)[prop as string];
    if (typeof value === 'function') {
      return (value as (...a: unknown[]) => unknown).bind(inner);
    }
    return value;
  },
}) as Logger;

/**
 * Test helper. Redirects the default `logger` singleton to an in-memory
 * stream and returns a capture object plus a restore function.
 *
 * Pattern:
 *   let cap: ReturnType<typeof _captureLogger>;
 *   beforeEach(() => { cap = _captureLogger(); });
 *   afterEach(() => { cap.restore(); });
 *   it('warns', () => {
 *     fnUnderTest();
 *     expect(cap.records().some(r => r.msg?.includes('clamping'))).toBe(true);
 *   });
 *
 * Not a public API; underscore-prefixed and called only from test code.
 */
export function _captureLogger(): {
  records(): Array<Record<string, unknown>>;
  text(): string;
  restore(): void;
} {
  class MemoryWritable extends Writable {
    chunks: string[] = [];
    _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
      this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
      cb();
    }
  }
  const w = new MemoryWritable();
  _activeDestination = w;
  _cached = undefined;
  return {
    records: () =>
      w.chunks
        .join('')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    text: () => w.chunks.join(''),
    restore: () => {
      _activeDestination = undefined;
      _cached = undefined;
    },
  };
}
