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
    REPORTS: "cartograph",
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
export { DEFAULT_PROJECT_KEY } from "./projectKey.js";

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
    PLANNER_POLL_SLICE_MS: 40 * 1000, // 40s total invocation budget
    PLANNER_UNCLAIMED_TIMEOUT_MS: 15 * 1000, // 15s claim fail-safe
    PLANNER_UI_HEARTBEAT_THROTTLE_MS: 2 * 1000, // Throttled UI activity write
    PLANNER_AGENT_HEARTBEAT_MS: 2 * 1000, // Polling heartbeat interval
    PLANNER_AGENT_POLL_STALE_MS: 10 * 1000, // Stale threshold during active poll
    PLANNER_AGENT_SLICE_GAP_MS: 20 * 1000, // Max permitted gap between slices
    PLANNER_ANSWER_RETENTION_TTL_MS: 30 * 60 * 1000, // 30m durable response retention
} as const;
