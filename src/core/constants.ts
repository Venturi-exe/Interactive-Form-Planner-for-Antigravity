import * as path from "path";
import * as os from "os";

/**
 * Returns the active Orbit brain root directory.
 * Honors ORBIT_BRAIN_DIR if set (critical for tests and isolated environments).
 */
export function getBrainRoot(): string {
    return process.env.ORBIT_BRAIN_DIR || path.join(os.homedir(), ".orbit-brain");
}

/**
 * Returns the active IPC directory for Planner and ImpactWatcher communication.
 * Honors ANTIGRAVITY_FORMS_DIR if set.
 */
export function getIpcRoot(): string {
    return process.env.ANTIGRAVITY_FORMS_DIR || path.join(os.homedir(), ".antigravity-forms");
}

// Layout v3 Brain Directory Structure
export const BRAIN_DIRS = {
    PROJECTS: "projects",
    TRASH: ".trash",
    LOCKS: ".locks",
    JOURNAL: ".journal",
} as const;

// Project Subdirectory Structure (Layout v3)
export const PROJECT_DIRS = {
    REPORTS: "reports",
    MEMORIES: "memories",
    SESSIONS: "memories/sessions",
    FEATURES: "memories/features",
    TASKS: "memories/tasks",
    ARCHIVE: "archive",
} as const;

// IPC Directory Structure (IPC v2)
export const IPC_DIRS = {
    REQUESTS: "requests",
    CLAIMED: "claimed",
    CANCELLED: "cancelled",
    RESPONSES: "responses",
    FAILED: "failed",
    EVENTS: "events",
    IMPACTS: "impacts",
} as const;

// Default Project Key for unassigned reports or global activities
export const DEFAULT_PROJECT_KEY = "_default";

// Global Brain Files
export const GLOBAL_FILES = {
    ARCH: "BRAIN_ARCHITECTURE.md",
    CONTEXT: "global_context_summary.md",
    PROJECT_INDEX: "INDEX.md",
} as const;

// File System Modes (POSIX permissions)
export const FS_MODES = {
    BRAIN_DIR: 0o700,
    BRAIN_FILE: 0o600,
} as const;

// Operational Limits
export const LIMITS = {
    MAX_REPORT_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
    MAX_MEMORY_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
    MAX_IPC_MESSAGE_BYTES: 2 * 1024 * 1024, // 2 MB
    TRASH_TTL_DAYS: 14,
    TRASH_TTL_MS: 14 * 24 * 60 * 60 * 1000,
    LOCK_STALE_MS: 30 * 1000, // 30 seconds
    MAX_LOCK_WAIT_MS: 5 * 1000, // 5 seconds
} as const;
