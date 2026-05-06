/**
 * MCP Command
 *
 * Starts the MCP server in standalone mode.
 * Loads all indexed repos from the global registry.
 * No longer depends on cwd — works from any directory.
 */

import { startMCPServer } from '../mcp/server.js';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { warnMissingOptionalGrammars } from './optional-grammars.js';

export const mcpCommand = async () => {
  // uncaughtException/unhandledRejection handlers are owned by
  // startMCPServer (gitnexus/src/mcp/server.ts) so the server's shutdown
  // path runs cleanly with full stack traces. Registering duplicates here
  // would only produce noisy double-logging on the same exception.

  // Surface missing optional grammars at startup so users learn why
  // .dart/.proto files won't be parsed instead of silently getting a
  // degraded index.
  warnMissingOptionalGrammars({ context: 'mcp' });

  // Initialize multi-repo backend from registry.
  // The server starts even with 0 repos — tools call refreshRepos() lazily,
  // so repos indexed after the server starts are discovered automatically.
  const backend = new LocalBackend();
  await backend.init();

  const repos = await backend.listRepos();
  if (repos.length === 0) {
    console.error(
      'GitNexus: No indexed repos yet. Run `gitnexus analyze` in a git repo — the server will pick it up automatically.',
    );
  } else {
    console.error(
      `GitNexus: MCP server starting with ${repos.length} repo(s): ${repos.map((r) => r.name).join(', ')}`,
    );
  }

  // Start MCP server (serves all repos, discovers new ones lazily)
  await startMCPServer(backend);
};
