// Shared by the extension host and browser webviews. Keep this module free of Node APIs.
export const DEFAULT_PROJECT_KEY = '_default';

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/** Normalizes project names, including historical default aliases, into safe keys. */
export function normalizeProjectKey(key?: string | null): string {
  if (typeof key !== 'string' || !key.trim()) return DEFAULT_PROJECT_KEY;

  const lower = key.trim().toLowerCase();
  if (lower === 'default' || lower === DEFAULT_PROJECT_KEY || lower === '[default]') return DEFAULT_PROJECT_KEY;

  let cleaned = lower.replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_');
  cleaned = cleaned.replace(/^[._-]+|[._-]+$/g, '');
  if (cleaned === 'default' || cleaned === DEFAULT_PROJECT_KEY) return DEFAULT_PROJECT_KEY;
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `project_${cleaned}`;
  if (!cleaned || !/^[a-z0-9]/.test(cleaned)) return DEFAULT_PROJECT_KEY;
  return cleaned.slice(0, 128);
}
