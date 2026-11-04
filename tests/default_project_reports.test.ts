import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrbitBrain } from '../src/OrbitBrain';
import { normalizeProjectKey } from '../src/core/paths';
import { PROJECT_DIRS } from '../src/core/constants';

describe('default project report compatibility', () => {
  it('uses the canonical fallback for omitted and empty project names', () => {
    expect(normalizeProjectKey(undefined)).toBe('_default');
    expect(normalizeProjectKey('')).toBe('_default');
    expect(PROJECT_DIRS.REPORTS).toBe('cartograph');
  });

  it('reads historical default folders alongside the canonical project without duplicate mirrors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-default-reports-'));
    vi.stubEnv('ORBIT_BRAIN_DIR', root);
    try {
      for (const [directory, taskId] of [
        ['projects/_default', 'canonical'], ['projects/default', 'legacy'],
        ['[Default]', 'bracketed'], ['_default', 'canonical'],
      ]) {
        const reports = path.join(root, directory, 'cartograph');
        fs.mkdirSync(reports, { recursive: true });
        fs.writeFileSync(path.join(reports, `${taskId}.json`), JSON.stringify({ taskId, timestamp: '2026-11-04T00:00:00Z', summary: taskId, changes: [] }));
      }
      const brain = new OrbitBrain();
      expect(brain.listProjects()).toEqual(['_default']);
      expect(brain.listCartographReports('Default').map(item => item.report.taskId).sort()).toEqual(['bracketed', 'canonical', 'legacy']);
    } finally {
      vi.unstubAllEnvs();
      if (root.startsWith(path.join(os.tmpdir(), 'orbit-default-reports-'))) fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
