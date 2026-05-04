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
 *   - Default level: 'warn'
 *   - When `opts.debugEnvVar` is set and that env var is truthy at
 *     createLogger time, that named child logs at level 'debug'
 *   - Output is NDJSON in production / CI / vitest. pino-pretty is used only
 *     when stdout is a TTY AND CI is unset AND VITEST is unset, so test
 *     and pipeline output stay parseable.
 */
import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';

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
  return (
    process.stdout.isTTY === true && !isTruthyEnv(process.env.CI) && !isTruthyEnv(process.env.VITEST)
  );
}

/**
 * Try to load pino-pretty synchronously via require(); fall back to raw NDJSON
 * if it isn't installed (production install with devDependencies pruned).
 */
function tryBuildPrettyTransport(): LoggerOptions['transport'] | undefined {
  try {
    // pino-pretty must be resolvable; if so, configure it as a transport target.
    // pino's worker thread loads it by name at runtime.
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
    level: 'warn',
    base: undefined, // omit pid/hostname from each record
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
  const debugRequested = opts?.debugEnvVar
    ? isTruthyEnv(process.env[opts.debugEnvVar])
    : false;

  // When a custom destination is provided we cannot also use a transport
  // (transports manage their own destination). Test path: just plain pino +
  // destination stream.
  if (opts?.destination) {
    return pino(
      { level: debugRequested ? 'debug' : 'warn', base: undefined, name },
      opts.destination,
    );
  }

  const base = buildBaseOptions();
  const root = pino({ ...base, level: debugRequested ? 'debug' : base.level });
  return root.child({ name });
}

/** Default singleton logger; module name "gitnexus". */
export const logger: Logger = createLogger('gitnexus');
