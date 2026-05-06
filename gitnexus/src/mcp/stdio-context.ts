/**
 * MCP Stdio Context — AsyncLocalStorage-tagged transport-write detection.
 *
 * The MCP stdio transport writes JSON-RPC frames to stdout. Per spec, the
 * server MUST NOT write anything to stdout that is not a valid MCP message.
 * Stray writes from dependency code corrupt the protocol and present to
 * clients as a hung handshake or `MCP error -32000`.
 *
 * This module provides:
 *   - withMcpWrite(fn): runs fn inside an AsyncLocalStorage context tagged
 *     `mcp: true`. The transport wraps every send() in this so its writes
 *     are recognizable as legitimate.
 *   - isMcpWrite(): true when called inside withMcpWrite.
 *   - createStdoutSentinel({...}): a write function suitable for installing
 *     in a Proxy over process.stdout. Tagged writes pass through to the real
 *     stdout; untagged writes are redirected to stderr with a [mcp:stdout-redirect]
 *     prefix, truncated to maxBytes per redirect, and rate-limited to maxRedirects
 *     per process so a stray loop cannot flood client logs.
 *
 * The sentinel is correctness-by-construction: it identifies legitimate
 * writes by *who* called write(), not by inspecting the bytes. A byte-shape
 * heuristic ("starts with {, ends with \n") would falsely reject Content-Length
 * frames (which start with C and end with }) and misclassify multi-chunk writes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface McpWriteContext {
  mcp: true;
}

const store = new AsyncLocalStorage<McpWriteContext>();

export function withMcpWrite<T>(fn: () => T): T {
  return store.run({ mcp: true }, fn);
}

export function isMcpWrite(): boolean {
  return store.getStore()?.mcp === true;
}

type WriteFn = (chunk: any, ...rest: any[]) => boolean;

export interface SentinelOptions {
  realStdoutWrite: WriteFn;
  realStderrWrite: WriteFn;
  /** Maximum bytes of payload to surface per redirect. Defaults to 200. */
  maxBytes?: number;
  /** Maximum number of redirects per process before suppression. Defaults to 10. */
  maxRedirects?: number;
}

export interface SentinelStats {
  redirected: number;
  suppressed: number;
}

export interface Sentinel {
  write: WriteFn;
  stats: () => SentinelStats;
  flushSummary: () => void;
}

const REDIRECT_PREFIX = '[mcp:stdout-redirect] ';
const STARTUP_WARNING =
  '[mcp:stdout-redirect] sentinel triggered — stray write redirected to stderr; subsequent redirects logged at exit\n';

function chunkToBuffer(chunk: any): Buffer {
  if (chunk === undefined || chunk === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  return Buffer.from(String(chunk), 'utf8');
}

export function createStdoutSentinel(opts: SentinelOptions): Sentinel {
  const maxBytes = opts.maxBytes ?? 200;
  const maxRedirects = opts.maxRedirects ?? 10;
  let redirected = 0;
  let suppressed = 0;
  let warningEmitted = false;

  const stderr = (s: string | Buffer) => opts.realStderrWrite(s);

  const write: WriteFn = (chunk: any, ...rest: any[]): boolean => {
    if (isMcpWrite()) {
      return opts.realStdoutWrite(chunk, ...rest);
    }

    if (!warningEmitted) {
      warningEmitted = true;
      stderr(STARTUP_WARNING);
    }

    if (redirected >= maxRedirects) {
      suppressed += 1;
      return true;
    }

    redirected += 1;
    const buf = chunkToBuffer(chunk);
    const truncated = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;

    stderr(REDIRECT_PREFIX);
    if (truncated.length > 0) stderr(truncated);
    if (buf.length > maxBytes) {
      stderr(` (+${buf.length - maxBytes} bytes truncated)`);
    }
    if (truncated.length === 0 || truncated[truncated.length - 1] !== 0x0a) {
      stderr('\n');
    }
    return true;
  };

  return {
    write,
    stats: () => ({ redirected, suppressed }),
    flushSummary: () => {
      if (redirected === 0 && suppressed === 0) return;
      stderr(
        `[mcp:stdout-redirect] summary: ${redirected} redirected, ${suppressed} suppressed beyond cap\n`,
      );
    },
  };
}
