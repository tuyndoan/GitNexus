/**
 * Optional grammar availability check.
 *
 * tree-sitter-dart and tree-sitter-proto are optionalDependencies that
 * require a `node-gyp rebuild` at install time. The build can be skipped
 * via GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 (postinstall scripts), or it can
 * silently soft-fail when the C++ toolchain is missing.
 *
 * Either path produces the same observable: the .node binding is absent
 * at runtime. This helper detects that condition and surfaces a single
 * stderr line per missing grammar so users learn why .dart/.proto support
 * is unavailable instead of silently getting a degraded index.
 */

import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

interface OptionalGrammar {
  /** Display name in warnings */
  name: string;
  /** Module name to require.resolve */
  pkg: string;
  /** File extensions this grammar parses */
  extensions: string[];
}

const OPTIONAL_GRAMMARS: OptionalGrammar[] = [
  { name: 'tree-sitter-dart', pkg: 'tree-sitter-dart', extensions: ['.dart'] },
  { name: 'tree-sitter-proto', pkg: 'tree-sitter-proto', extensions: ['.proto'] },
];

export interface MissingGrammar {
  name: string;
  extensions: string[];
}

// Memoize the probe result — actually requiring the grammar loads its
// native binding (via node-gyp-build), which we don't need to do twice.
let _detectionCache: MissingGrammar[] | null = null;

/**
 * Returns the list of optional grammars whose native binding cannot be
 * loaded. Actually `require()`s the package — `require.resolve` would
 * locate the entry path even when the `.node` binding is absent (the
 * `file:` package directory is installed regardless of postinstall
 * outcome), giving false negatives for the exact users we want to warn:
 * those who installed with `GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1` or whose
 * native rebuild soft-failed for missing toolchain.
 */
export function detectMissingOptionalGrammars(): MissingGrammar[] {
  if (_detectionCache) return _detectionCache;
  const missing: MissingGrammar[] = [];
  for (const g of OPTIONAL_GRAMMARS) {
    try {
      _require(g.pkg);
    } catch {
      missing.push({ name: g.name, extensions: g.extensions });
    }
  }
  _detectionCache = missing;
  return missing;
}

/**
 * Log a one-line stderr warning for each missing grammar. Safe to call
 * unconditionally — silent if all grammars are present.
 *
 * `relevantExtensions`, if provided, filters the warning to grammars whose
 * extensions appear in the set (e.g. an analyze run can pass the set of
 * extensions actually present in the target repo so users without any
 * .dart/.proto files don't see noise).
 */
export function warnMissingOptionalGrammars(opts?: {
  context?: string;
  relevantExtensions?: ReadonlySet<string>;
}): void {
  const missing = detectMissingOptionalGrammars();
  if (missing.length === 0) return;
  const ctx = opts?.context ? ` [${opts.context}]` : '';
  for (const g of missing) {
    if (opts?.relevantExtensions && !g.extensions.some((e) => opts.relevantExtensions!.has(e))) {
      continue;
    }
    console.error(
      `GitNexus${ctx}: optional grammar "${g.name}" is unavailable — ${g.extensions.join('/')} files will not be parsed. Reinstall without GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 (and ensure python3, make, g++) to enable.`,
    );
  }
}
