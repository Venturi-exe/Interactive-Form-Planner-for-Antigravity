import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { resolveInside, assertProjectKey, assertSafeFileName, isDenied, redactPath } from '../src/core/paths';

describe('core/paths', () => {
  const root = path.join(os.tmpdir(), 'orbit-test-root');

  describe('resolveInside', () => {
    it('resolves valid relative paths inside root', () => {
      const res = resolveInside(root, 'project/memories/INDEX.md');
      expect(res).toBe(path.resolve(root, 'project/memories/INDEX.md'));
    });

    it('rejects path traversal attempts', () => {
      expect(() => resolveInside(root, '../evil.txt')).toThrow(/forbidden|escapes/i);
      expect(() => resolveInside(root, 'sub/../../evil.txt')).toThrow(/forbidden|escapes/i);
    });

    it('rejects absolute paths, drive letters, and UNC paths', () => {
      expect(() => resolveInside(root, 'C:\\Windows\\system32')).toThrow(/forbidden/i);
      expect(() => resolveInside(root, '/etc/passwd')).toThrow(/forbidden/i);
      expect(() => resolveInside(root, '\\\\server\\share\\file.txt')).toThrow(/forbidden/i);
    });

    it('rejects NUL bytes and Windows reserved names', () => {
      expect(() => resolveInside(root, 'test\0evil.txt')).toThrow(/null bytes/i);
      expect(() => resolveInside(root, 'CON.md')).toThrow(/Windows reserved device name/i);
      expect(() => resolveInside(root, 'folder/AUX.json')).toThrow(/Windows reserved device name/i);
    });

    it('rejects trailing dots and spaces in path segments', () => {
      expect(() => resolveInside(root, 'folder./file.txt')).toThrow(/Trailing dots or spaces/i);
      expect(() => resolveInside(root, 'folder /file.txt')).toThrow(/Trailing dots or spaces/i);
    });
  });

  describe('assertProjectKey', () => {
    it('accepts and lowercases valid keys', () => {
      expect(assertProjectKey('Orbit')).toBe('orbit');
      expect(assertProjectKey('my-project_1.0')).toBe('my-project_1.0');
      expect(assertProjectKey('_default')).toBe('_default');
    });

    it('rejects invalid keys or reserved prefixes', () => {
      expect(() => assertProjectKey('_custom')).toThrow(/reserved prefix/i);
      expect(() => assertProjectKey('../escape')).toThrow(/Invalid project key/i);
      expect(() => assertProjectKey('')).toThrow(/non-empty/i);
    });
  });

  describe('assertSafeFileName', () => {
    it('accepts valid filenames', () => {
      expect(assertSafeFileName('report_123.json')).toBe('report_123.json');
      expect(assertSafeFileName('INDEX.md')).toBe('INDEX.md');
    });

    it('rejects invalid filenames', () => {
      expect(() => assertSafeFileName('../bad.txt')).toThrow(/Invalid filename/i);
      expect(() => assertSafeFileName('CON.json')).toThrow(/reserved device name/i);
    });
  });

  describe('isDenied', () => {
    it('identifies denied paths', () => {
      expect(isDenied('optic/access_policy.json')).toBe(true);
      expect(isDenied('_trash/old.txt')).toBe(true);
      expect(isDenied('_quarantine/corrupt.json')).toBe(true);
      expect(isDenied('.gitignore')).toBe(true);
      expect(isDenied('myproject/memories/facts.md')).toBe(false);
    });
  });

  describe('redactPath', () => {
    it('redacts user directories to ~', () => {
      expect(redactPath('C:\\Users\\cesar\\.orbit-brain')).toBe('~\\.orbit-brain');
      expect(redactPath('/Users/cesar/.orbit-brain')).toBe('~/.orbit-brain');
    });
  });
});
