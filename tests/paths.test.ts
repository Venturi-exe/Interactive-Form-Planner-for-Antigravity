import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { resolveInside, assertProjectKey, assertSafeFileName, isDenied, redactPath, normalizeProjectKey, getProjectDir } from '../src/core/paths';

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

    it('rejects symlink traversal outside root', () => {
      const realTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-symlink-root-'));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-symlink-outside-'));
      const linkPath = path.join(realTestDir, 'symlink-dir');
      try {
        fs.symlinkSync(outsideDir, linkPath, 'junction');
        expect(() => resolveInside(realTestDir, 'symlink-dir/secret.txt')).toThrow(/escapes real root/i);
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== 'EPERM') throw err;
      } finally {
        try { fs.rmSync(linkPath, { force: true }); } catch { /* ignore */ }
        try { fs.rmSync(realTestDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });

    it('rejects broken symbolic links or junctions (N-06)', () => {
      const realTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-broken-root-'));
      const missingTarget = path.join(os.tmpdir(), 'non-existent-target-' + Date.now());
      const brokenLink = path.join(realTestDir, 'broken-link');
      try {
        fs.symlinkSync(missingTarget, brokenLink, 'junction');
        expect(() => resolveInside(realTestDir, 'broken-link/file.txt')).toThrow(/Broken symbolic link or junction/i);
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== 'EPERM') throw err;
      } finally {
        try { fs.rmSync(brokenLink, { force: true }); } catch { /* ignore */ }
        try { fs.rmSync(realTestDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });

    it('resolves non-existent root directory inside a symlinked parent directory (macOS /var -> /private/var)', () => {
      const realParent = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-real-parent-'));
      const linkParentHost = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-link-host-'));
      const symlinkedParent = path.join(linkParentHost, 'var-alias');
      try {
        fs.symlinkSync(realParent, symlinkedParent, 'junction');
        const nonExistentRoot = path.join(symlinkedParent, 'orbit-nonexistent-root');
        const res = resolveInside(nonExistentRoot, 'project/memories/INDEX.md');
        expect(res).toBe(path.resolve(nonExistentRoot, 'project/memories/INDEX.md'));
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== 'EPERM') throw err;
      } finally {
        try { fs.rmSync(symlinkedParent, { force: true }); } catch { /* ignore */ }
        try { fs.rmSync(linkParentHost, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.rmSync(realParent, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });
  });

  describe('normalizeProjectKey (N-05)', () => {
    it('normalizes spaces and special characters', () => {
      expect(normalizeProjectKey('My Cool App')).toBe('my_cool_app');
    });

    it('strips leading and trailing dots, dashes, and underscores', () => {
      expect(normalizeProjectKey('..my_app..')).toBe('my_app');
      expect(normalizeProjectKey('-test-')).toBe('test');
      expect(normalizeProjectKey('...')).toBe('_default');
      expect(normalizeProjectKey('.')).toBe('_default');
    });

    it('prefixes Windows reserved device names', () => {
      expect(normalizeProjectKey('CON')).toBe('project_con');
      expect(normalizeProjectKey('PRN')).toBe('project_prn');
      expect(normalizeProjectKey('AUX')).toBe('project_aux');
      expect(normalizeProjectKey('NUL')).toBe('project_nul');
      expect(normalizeProjectKey('COM1')).toBe('project_com1');
    });

    it('canonicalizes [Default], Default, default, and _default to _default', () => {
      expect(normalizeProjectKey('[Default]')).toBe('_default');
      expect(normalizeProjectKey('Default')).toBe('_default');
      expect(normalizeProjectKey('default')).toBe('_default');
      expect(normalizeProjectKey('_default')).toBe('_default');
      expect(normalizeProjectKey('___default___')).toBe('_default');
    });

    it('always outputs a valid key starting with letter or digit', () => {
      const res = normalizeProjectKey('???!!!');
      expect(res).toBe('_default');
      expect(/^[a-z0-9]/.test(normalizeProjectKey('abc'))).toBe(true);
    });
  });

  describe('assertProjectKey', () => {
    it('accepts and lowercases valid keys', () => {
      expect(assertProjectKey('Orbit')).toBe('orbit');
      expect(assertProjectKey('my-project_1.0')).toBe('my-project_1.0');
      expect(assertProjectKey('_default')).toBe('_default');
    });

    it('canonicalizes [Default], Default, and default to _default', () => {
      expect(assertProjectKey('[Default]')).toBe('_default');
      expect(assertProjectKey('Default')).toBe('_default');
      expect(assertProjectKey('default')).toBe('_default');
      expect(assertProjectKey('_default')).toBe('_default');
    });

    it('rejects invalid keys or reserved prefixes', () => {
      expect(() => assertProjectKey('_custom')).toThrow(/reserved prefix/i);
      expect(() => assertProjectKey('../escape')).toThrow(/Invalid project key/i);
      expect(() => assertProjectKey('')).toThrow(/non-empty/i);
    });
  });

  describe('getProjectDir', () => {
    it('resolves projects/<key> when v3 directory exists', () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-proj-test-'));
      try {
        const v3Dir = path.join(testDir, 'projects', 'orbit');
        fs.mkdirSync(v3Dir, { recursive: true });
        expect(getProjectDir(testDir, 'Orbit')).toBe(v3Dir);
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('falls back to flat legacy directory when present and v3 does not exist', () => {
      const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-proj-test-'));
      try {
        const legacyDir = path.join(testDir, 'legacy_app');
        fs.mkdirSync(legacyDir, { recursive: true });
        expect(getProjectDir(testDir, 'legacy_app')).toBe(legacyDir);
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('defaults to projects/<key> when neither exists', () => {
      const testDir = path.join(os.tmpdir(), 'orbit-proj-test-nonexistent');
      expect(getProjectDir(testDir, 'NewApp')).toBe(path.resolve(testDir, 'projects', 'newapp'));
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

  describe('isDenied (N-09)', () => {
    it('identifies denied paths and subpaths', () => {
      expect(isDenied('optic/access_policy.json')).toBe(true);
      expect(isDenied('_trash/old.txt')).toBe(true);
      expect(isDenied('_quarantine/corrupt.json')).toBe(true);
      expect(isDenied('.trash/deleted.txt')).toBe(true);
      expect(isDenied('.locks/brain.lock')).toBe(true);
      expect(isDenied('.journal/migration.json')).toBe(true);
      expect(isDenied('node_modules/pkg/index.js')).toBe(true);
      expect(isDenied('.git/config')).toBe(true);
      expect(isDenied('.gitignore')).toBe(true);
      // N-09: Subfiles inside .migrated are denied
      expect(isDenied('.migrated/v2-2026/file.txt')).toBe(true);
      expect(isDenied('.migrated')).toBe(true);
      expect(isDenied('.migrated-marker')).toBe(true);
      expect(isDenied('.migrated.marker')).toBe(true);
      expect(isDenied('myproject/memories/facts.md')).toBe(false);
    });
  });

  describe('redactPath', () => {
    it('redacts user directories to ~', () => {
      expect(redactPath('C:\\Users\\fixture-user\\.orbit-brain')).toBe('~\\.orbit-brain');
      expect(redactPath('C:/Users/fixture-user/.orbit-brain')).toBe('~/.orbit-brain');
      expect(redactPath('/Users/fixture-user/.orbit-brain')).toBe('~/.orbit-brain');
      expect(redactPath('/home/fixture-user/.orbit-brain')).toBe('~/.orbit-brain');
    });
  });
});
