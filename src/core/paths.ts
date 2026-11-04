import * as path from 'path';
import * as fs from 'fs';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Resolves the real canonical path for an existing path or the closest existing ancestor
 * to prevent symlink and junction directory escapes.
 */
function getCanonicalTarget(targetPath: string): string {
  let curr = targetPath;
  const suffix: string[] = [];
  while (path.dirname(curr) !== curr) {
    let exists = false;
    let isLink = false;
    try {
      const stat = fs.lstatSync(curr);
      exists = true;
      isLink = stat.isSymbolicLink();
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        const real = fs.realpathSync(curr);
        return suffix.length > 0 ? path.join(real, ...suffix) : real;
      } catch (err) {
        // N-06: If lstat reports a link and realpath fails, this is a broken link.
        // Throwing prevents escaping root via broken links.
        if (isLink) {
          throw new Error(`Broken symbolic link or junction target cannot be resolved: ${curr}`);
        }
        return suffix.length > 0 ? path.join(curr, ...suffix) : curr;
      }
    }
    suffix.unshift(path.basename(curr));
    curr = path.dirname(curr);
  }
  return targetPath;
}

/**
 * Resolves a relative path inside a root directory, strictly preventing traversal,
 * drive escaping, Windows device names, UNC injection, and symlink/junction escapes.
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

  // V-07: Symlink containment check using canonical realpath
  let realRoot = path.resolve(rootDir);
  try {
    if (fs.existsSync(realRoot)) {
      realRoot = fs.realpathSync(realRoot);
    }
  } catch { /* ignore */ }

  const canonicalTarget = getCanonicalTarget(resolved);
  const realRelative = path.relative(realRoot, canonicalTarget);

  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`Symlink or path escapes real root directory: ${relPath}`);
  }

  if (process.platform === 'win32') {
    const realRootNorm = realRoot.toLowerCase().replace(/[\\/]+$/, '');
    const realTargetNorm = canonicalTarget.toLowerCase();
    if (
      realTargetNorm !== realRootNorm &&
      !realTargetNorm.startsWith(realRootNorm + '\\') &&
      !realTargetNorm.startsWith(realRootNorm + '/')
    ) {
      throw new Error(`Symlink or path escapes real root directory (case-insensitive check): ${relPath}`);
    }
  }

  return resolved;
}

/**
 * Normalizes any string into a valid, safe project key.
 * Converts to lowercase, replaces invalid characters with underscores,
 * maps 'default' to '_default', and guarantees a safe key.
 */
export function normalizeProjectKey(key: string): string {
  if (typeof key !== 'string' || !key.trim()) {
    return '_default';
  }

  const lower = key.trim().toLowerCase();
  if (lower === 'default' || lower === '_default' || lower === '[default]') {
    return '_default';
  }

  // Replace invalid characters with underscore, collapse consecutive underscores
  let cleaned = lower.replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_');
  // N-05: Strip leading and trailing dots, dashes, and underscores
  cleaned = cleaned.replace(/^[._-]+|[._-]+$/g, '');

  if (cleaned === 'default' || cleaned === '_default') {
    return '_default';
  }

  // N-05: Guard against Windows reserved device names (con, prn, aux, nul, com1-9, lpt1-9)
  if (WINDOWS_RESERVED.test(cleaned)) {
    cleaned = `project_${cleaned}`;
  }

  // N-05: Enforce that the result matches ^[a-z0-9][a-z0-9._-]*$
  if (!cleaned || !/^[a-z0-9]/.test(cleaned)) {
    return '_default';
  }

  return cleaned.slice(0, 128);
}

/**
 * Validates and normalizes project keys.
 * Lowercases input per project key casing convention. Maps default variants to _default. Throws on invalid or reserved prefixes.
 */
export function assertProjectKey(key: string): string {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Project key must be a non-empty string');
  }

  const lower = key.trim().toLowerCase();

  if (lower === '_default' || lower === 'default' || lower === '[default]') {
    return '_default';
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
 * Resolves the canonical directory for a project under brainRoot.
 * Prefers Layout v3 (projects/<key>), falling back to legacy flat (<key>) if present.
 */
export function getProjectDir(brainRoot: string, key: string): string {
  const sanitized = normalizeProjectKey(key);
  const targetSubPath = path.join('projects', sanitized);
  const v3Path = resolveInside(brainRoot, targetSubPath);
  if (fs.existsSync(v3Path)) {
    return v3Path;
  }
  try {
    const legacyPath = resolveInside(brainRoot, sanitized);
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
  } catch { /* skip */ }
  return v3Path;
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
  /^\.trash([\\/].*)?$/i,
  /^\.locks([\\/].*)?$/i,
  /^\.journal([\\/].*)?$/i,
  /^node_modules([\\/].*)?$/i,
  /^\.git([\\/].*)?$/i,
  /^_trash([\\/].*)?$/i,
  /^_quarantine([\\/].*)?$/i,
  /^_failed([\\/].*)?$/i,
  /^\.layout-version$/i,
  /^\.gitignore$/i,
  /^\.migrated([\\/].*)?$/i,
  /^\.migrated-marker$/i,
  /^\.migrated\.marker$/i,
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
    .replace(/[A-Za-z]:[\\/][Uu]sers[\\/][^\\/]+/g, '~')
    .replace(/\/Users\/[^\/]+/gi, '~')
    .replace(/\/home\/[^\/]+/gi, '~');
}

/**
 * Safely checks whether childPath is strictly equal to or inside parentPath (M-01, M-06).
 * Only lowercases on win32 to prevent false equivalences on case-sensitive filesystems.
 * Enforces boundary boundaries via path.relative so 'vntrcorp.orbit' never matches 'vntrcorp.orbit-foo'.
 */
export function isSubpath(childPath: string, parentPath: string): boolean {
  if (!childPath || !parentPath) return false;
  const isWin = process.platform === 'win32';
  const parentNorm = isWin ? path.resolve(parentPath).toLowerCase() : path.resolve(parentPath);
  const childNorm = isWin ? path.resolve(childPath).toLowerCase() : path.resolve(childPath);

  const rel = path.relative(parentNorm, childNorm);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
