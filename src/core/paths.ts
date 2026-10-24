import * as path from 'path';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Resolves a relative path inside a root directory, strictly preventing traversal,
 * drive escaping, Windows device names, and UNC injection.
 */
export function resolveInside(rootDir: string, relPath: string): string {
  if (typeof relPath !== 'string' || !relPath) {
    throw new Error('Path must be a non-empty string');
  }

  // Reject NUL bytes
  if (relPath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  // Reject Windows drive letters, UNC paths, and absolute paths
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || /^(\\\\|\/\/)/.test(relPath)) {
    throw new Error(`Absolute or UNC paths are forbidden: ${relPath}`);
  }

  // Normalize path
  const normalized = path.normalize(relPath);
  const segments = normalized.split(/[\\/]/).filter(Boolean);

  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error(`Path traversal is forbidden: ${relPath}`);
    }
    // Reject trailing dot or space on Windows
    if (/[. ]$/.test(seg)) {
      throw new Error(`Trailing dots or spaces in segment are forbidden: ${seg}`);
    }
    // Reject Windows reserved device names
    if (WINDOWS_RESERVED.test(seg)) {
      throw new Error(`Windows reserved device name is forbidden: ${seg}`);
    }
  }

  const resolved = path.resolve(rootDir, normalized);
  const relative = path.relative(rootDir, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root directory: ${relPath}`);
  }

  // On Windows, verify root prefix match (case-insensitive)
  if (process.platform === 'win32') {
    if (!resolved.toLowerCase().startsWith(path.resolve(rootDir).toLowerCase())) {
      throw new Error(`Path escapes root directory (case-insensitive check): ${relPath}`);
    }
  }

  return resolved;
}

/**
 * Validates and normalizes project keys.
 * Lowercases input per project key casing convention.
 */
export function assertProjectKey(key: string): string {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Project key must be a non-empty string');
  }

  const lower = key.trim().toLowerCase();

  if (lower === '_default') {
    return lower;
  }

  if (lower.startsWith('_')) {
    throw new Error(`Project key cannot start with reserved prefix '_': ${key}`);
  }

  const validRegex = /^[a-z0-9][a-z0-9._-]{0,127}$/;
  if (!validRegex.test(lower)) {
    throw new Error(`Invalid project key format '${key}'. Must match ^[a-z0-9][a-z0-9._-]{0,127}$`);
  }

  return lower;
}

/**
 * Validates safe filenames.
 */
export function assertSafeFileName(filename: string): string {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new Error('Filename must be a non-empty string');
  }

  const trimmed = filename.trim();
  const validRegex = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (!validRegex.test(trimmed)) {
    throw new Error(`Invalid filename '${filename}'. Must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`);
  }

  if (WINDOWS_RESERVED.test(trimmed)) {
    throw new Error(`Filename matches Windows reserved device name: ${trimmed}`);
  }

  return trimmed;
}

const DENY_PATTERNS = [
  /^optic([\\/].*)?$/i,
  /^_trash([\\/].*)?$/i,
  /^_quarantine([\\/].*)?$/i,
  /^_failed([\\/].*)?$/i,
  /^\.layout-version$/i,
  /^\.gitignore$/i,
  /^\.migrated$/i,
  /^migration-v3\.json$/i,
];

/**
 * Checks if a relative path matches denied administrative or neighbor project files.
 */
export function isDenied(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return DENY_PATTERNS.some(regex => regex.test(normalized));
}

/**
 * Redacts personal paths for logging and output hygiene.
 */
export function redactPath(filePath: string): string {
  if (!filePath) return '';
  return filePath
    .replace(/[A-Za-z]:\\[Uu]sers\\[^\\]+/g, '~')
    .replace(/\/Users\/[^\/]+/g, '~')
    .replace(/\/home\/[^\/]+/g, '~');
}
