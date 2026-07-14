/**
 * Shared constants for file block operations.
 *
 * Both file-block-executor.ts and file-block-flush.ts use the same
 * ALLOWED_DIRS whitelist and isAllowedPath check. This module is the
 * single source of truth to avoid duplication.
 */

import path from 'path';

/** Whitelist of directories where file operations are allowed */
export const ALLOWED_DIRS = [
  path.join(process.cwd(), 'generated'),
  path.join(process.cwd(), 'src', 'components', 'generated'),
  path.join(process.cwd(), 'src', 'app', 'api'),
];

/** Check if a normalized path is within the allowed directories */
export function isAllowedPath(normalized: string): boolean {
  return ALLOWED_DIRS.some(dir => normalized.startsWith(path.normalize(dir)));
}
