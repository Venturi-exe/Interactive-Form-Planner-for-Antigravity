/**
 * Orbit uninstall script.
 * Executed by VS Code on extension uninstall.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function runUninstall(): void {
  try {
    console.log('[Orbit] Running uninstall cleanup...');
    // Extended cleanup logic for global configs is implemented in P6-6
  } catch (err) {
    console.error('[Orbit] Error during uninstall:', err);
  }
}

if (require.main === module) {
  runUninstall();
}
