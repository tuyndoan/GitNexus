/**
 * MCP Command
 *
 * Starts the MCP server in standalone mode.
 * Loads all indexed repos from the global registry.
 * No longer depends on cwd — works from any directory.
 */

import { startMCPServer } from '../mcp/server.js';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { logger } from '../core/logger.js';

export const mcpCommand = async () => {
  // Prevent unhandled errors from crashing the MCP server process.
  // LadybugDB lock conflicts and transient errors should degrade gracefully.
  process.on('uncaughtException', (err) => {
    logger.error(`GitNexus MCP: uncaught exception — ${err.message}`);
    // Process is in an undefined state after uncaughtException — exit after flushing
    setTimeout(() => process.exit(1), 100);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error(`GitNexus MCP: unhandled rejection — ${msg}`);
  });

  // Initialize multi-repo backend from registry.
  // The server starts even with 0 repos — tools call refreshRepos() lazily,
  // so repos indexed after the server starts are discovered automatically.
  const backend = new LocalBackend();
  await backend.init();

  const repos = await backend.listRepos();
  if (repos.length === 0) {
    // Operator-actionable but the server still starts and serves; warn-level,
    // not error. Tools will discover newly-analyzed repos via lazy refresh.
    logger.warn(
      'GitNexus: No indexed repos yet. Run `gitnexus analyze` in a git repo — the server will pick it up automatically.',
    );
  } else {
    logger.info(
      { repoCount: repos.length, repos: repos.map((r) => r.name) },
      'GitNexus: MCP server starting',
    );
  }

  // Start MCP server (serves all repos, discovers new ones lazily)
  await startMCPServer(backend);
};
