/**
 * Orbit uninstall hook.
 * Executed automatically by VS Code when the extension is uninstalled,
 * or programmatically during extension cleanup commands.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as jsonc from "jsonc-parser";
import { detectHost, getStorageOwner } from "./core/host.js";
import { isSubpath } from "./core/paths.js";
import { removeOrbitRules, restoreOrbitRulesBackup } from "./core/rules.js";
import { writeAtomic, createRollingBackup } from "./core/fsx.js";
import { LEGACY_EXTENSION_IDS } from "./core/config.js";

export interface UninstallOptions {
    appName?: string;
    callerDir?: string;
    globalStoragePath?: string;
    mcpConfigPath?: string;
    mcpConfigPaths?: string[];
    geminiMdPath?: string;
    preserveRules?: boolean;
    restoreBackup?: boolean;
    brainAction?: "keep" | "archive" | "delete";
}

export interface UninstallResult {
    success: boolean;
    removedServer: boolean;
    removedRules: boolean;
    restoredBackup?: boolean;
    brainActionTaken?: string;
    reason?: string;
}

/**
 * Checks whether an MCP server entry belongs specifically to Orbit (N-01, M-01, M-06).
 * Only keys "orbit" and "antigravity-planner" are candidates.
 * Checks that args[0] points inside a known Orbit server directory for the calling host.
 */
export function isOrbitServerEntry(
    serverKey: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverEntry: any,
    globalStoragePath?: string,
    hostIsAntigravity?: boolean
): boolean {
    if (serverKey !== "orbit" && serverKey !== "antigravity-planner") {
        return false;
    }
    if (!serverEntry || typeof serverEntry !== "object") {
        return false;
    }

    const args = serverEntry.args;
    if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== "string") {
        return false;
    }

    const arg0 = path.resolve(args[0]);
    const legacyFormsPath = path.resolve(os.homedir(), ".antigravity-forms");

    // Check if target points to caller's globalStorage with strict boundary (M-01, M-06)
    if (globalStoragePath) {
        if (isSubpath(arg0, globalStoragePath)) {
            return true;
        }
    }

    // Check if target points to legacy ~/.antigravity-forms (only if host is Antigravity or unspecified)
    if (hostIsAntigravity === true && isSubpath(arg0, legacyFormsPath)) {
        return true;
    }

    // Fallback check for standalone uninstall execution (where globalStoragePath is not injected) (M-01, P-02)
    if (!globalStoragePath) {
        const segments = arg0.split(/[\\/]/).map((s) => s.toLowerCase());
        const gsIdx = segments.lastIndexOf("globalstorage");
        if (gsIdx !== -1 && gsIdx + 1 < segments.length) {
            const extFolder = segments[gsIdx + 1];
            // P-02: Require folder right after globalStorage to match the extension package ID case-insensitively
            const isOrbitExtFolder =
                extFolder === "vntrcorp.orbit" ||
                LEGACY_EXTENSION_IDS.some(id => id === extFolder);
            if (isOrbitExtFolder) {
                const storageOwner = getStorageOwner(arg0);
                if (hostIsAntigravity === false) {
                    // Caller is stock VS Code: only match if storage explicitly belongs to VS Code
                    return storageOwner === "vscode";
                } else if (hostIsAntigravity === true) {
                    // Caller is Antigravity: only match if storage explicitly belongs to Antigravity
                    return storageOwner === "antigravity";
                }
            }
        }
    }

    return false;
}

export async function runUninstall(options?: UninstallOptions): Promise<UninstallResult> {
    const result: UninstallResult = {
        success: false,
        removedServer: false,
        removedRules: false,
    };

    try {
        console.log("[Orbit Uninstall] Starting clean removal...");
        const callerDir = options?.callerDir || __dirname;
        const host = detectHost(options?.appName, callerDir);
        const geminiMdPath = options?.geminiMdPath || host.geminiMdPath;
        const globalStoragePath = options?.globalStoragePath;

        // Q-01, N-02: Clean VS Code-owned entries across all candidate mcp_config.json files
        // (e.g. ~/.gemini/antigravity-ide/mcp_config.json AND ~/.gemini/antigravity/mcp_config.json)
        const targetConfigPaths: string[] = options?.mcpConfigPaths
            ? options.mcpConfigPaths
            : options?.mcpConfigPath
            ? [options.mcpConfigPath]
            : host.mcpConfigPaths && host.mcpConfigPaths.length > 0
            ? host.mcpConfigPaths
            : [host.mcpConfigPath];

        const uniqueConfigPaths = Array.from(new Set(targetConfigPaths.map((p) => path.resolve(p))));
        let remainingOrbitKeys = false;

        interface PlannedConfigEdit {
            configPath: string;
            originalRaw: string;
            updatedRaw: string;
            modified: boolean;
            remainingOrbitKeys: boolean;
        }

        const plannedEdits: PlannedConfigEdit[] = [];

        // Phase 1 (N-02): Parse and validate EVERY candidate config in-memory first.
        // If any candidate file has syntax errors, abort immediately before modifying any file on disk.
        for (const configPath of uniqueConfigPaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const raw = fs.readFileSync(configPath, "utf-8");
                    const errors: jsonc.ParseError[] = [];
                    const config = jsonc.parse(raw, errors, { allowTrailingComma: true });

                    // V-03, N-02: If ANY mcp_config.json has parse errors, abort immediately to protect user configuration
                    if (errors.length > 0 || config === undefined || typeof config !== "object" || config === null) {
                        const msg = `[Orbit Uninstall] Syntax errors detected in ${configPath}. Aborting MCP server cleanup to avoid corrupting user configuration.`;
                        console.error(msg);
                        result.reason = `Syntax errors detected in ${configPath}`;
                        return result;
                    }

                    let updatedRaw = raw;
                    let modified = false;
                    let fileRemainingOrbitKeys = false;

                    if (config.mcpServers && typeof config.mcpServers === "object") {
                        const formatOpts = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

                        // Only candidates are "orbit" and "antigravity-planner" (N-01)
                        for (const key of ["orbit", "antigravity-planner"]) {
                            const entry = config.mcpServers[key];
                            if (entry && isOrbitServerEntry(key, entry, globalStoragePath, host.isAntigravity)) {
                                const edits = jsonc.modify(updatedRaw, ["mcpServers", key], undefined, formatOpts);
                                updatedRaw = jsonc.applyEdits(updatedRaw, edits);
                                modified = true;
                            }
                        }

                        // Check if any orbit keys remain in this config file after removal (P-01, Q-01)
                        const parsedAfter = jsonc.parse(updatedRaw, [], { allowTrailingComma: true });
                        if (parsedAfter?.mcpServers && typeof parsedAfter.mcpServers === "object") {
                            if ("orbit" in parsedAfter.mcpServers || "antigravity-planner" in parsedAfter.mcpServers) {
                                fileRemainingOrbitKeys = true;
                            }
                        }
                    }

                    plannedEdits.push({
                        configPath,
                        originalRaw: raw,
                        updatedRaw,
                        modified,
                        remainingOrbitKeys: fileRemainingOrbitKeys,
                    });
                } catch (err: unknown) {
                    console.error(`[Orbit Uninstall] Failed to parse ${configPath}:`, err);
                    result.reason = (err as Error).message;
                    return result;
                }
            }
        }

        // Phase 2 (N-02): Only write to disk once all candidate files have been validated
        for (const plan of plannedEdits) {
            if (plan.modified && plan.updatedRaw !== plan.originalRaw) {
                await createRollingBackup(plan.configPath, 3);
                await writeAtomic(plan.configPath, plan.updatedRaw);
                result.removedServer = true;
            }
            if (plan.remainingOrbitKeys) {
                remainingOrbitKeys = true;
            }
        }

        // 2. Handle GEMINI.md rules based on options and host environment
        if (options?.restoreBackup && fs.existsSync(geminiMdPath)) {
            try {
                const restored = await restoreOrbitRulesBackup(geminiMdPath);
                if (restored) {
                    result.restoredBackup = true;
                    console.log("[Orbit Uninstall] Restored GEMINI.md from previous backup.");
                }
            } catch (err) {
                console.error("[Orbit Uninstall] Failed to restore backup for GEMINI.md:", err);
            }
        } else if (!options?.preserveRules) {
            // - In Antigravity: remove rules on uninstall
            // - In non-Antigravity (e.g. stock VS Code): remove rules ONLY when both:
            //   (a) this run removed a VS Code-owned server entry (result.removedServer === true), and
            //   (b) no "orbit" or "antigravity-planner" key is left in mcp_config.json afterwards (P-01).
            let shouldCleanRules = false;
            if (host.isAntigravity) {
                shouldCleanRules = true;
            } else if (result.removedServer && !remainingOrbitKeys) {
                shouldCleanRules = true;
            }

            if (shouldCleanRules && fs.existsSync(geminiMdPath)) {
                try {
                    const removed = await removeOrbitRules(geminiMdPath);
                    if (removed) {
                        result.removedRules = true;
                        console.log("[Orbit Uninstall] Removed Orbit marker rules from GEMINI.md");
                    }
                } catch (err) {
                    console.error("[Orbit Uninstall] Failed to clean GEMINI.md:", err);
                }
            }
        }

        // 3. Handle persistent brain data (~/.orbit-brain) if explicitly commanded
        if (options?.brainAction === "archive") {
            const brainPath = path.join(os.homedir(), ".orbit-brain");
            if (fs.existsSync(brainPath)) {
                try {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const archivePath = path.join(os.homedir(), `.orbit-brain-archived-${timestamp}`);
                    await fs.promises.rename(brainPath, archivePath);
                    result.brainActionTaken = `Archived to ${archivePath}`;
                    console.log(`[Orbit Uninstall] Archived ~/.orbit-brain to ${archivePath}`);
                } catch (err) {
                    console.error("[Orbit Uninstall] Failed to archive ~/.orbit-brain:", err);
                }
            }
        } else if (options?.brainAction === "delete") {
            const brainPath = path.join(os.homedir(), ".orbit-brain");
            if (fs.existsSync(brainPath)) {
                try {
                    await fs.promises.rm(brainPath, { recursive: true, force: true });
                    result.brainActionTaken = "Deleted ~/.orbit-brain";
                    console.log("[Orbit Uninstall] Deleted ~/.orbit-brain");
                } catch (err) {
                    console.error("[Orbit Uninstall] Failed to delete ~/.orbit-brain:", err);
                }
            }
        }

        result.success = true;
        console.log("[Orbit Uninstall] Cleanup completed successfully.");
        return result;
    } catch (err: unknown) {
        console.error("[Orbit Uninstall] Unexpected error during cleanup:", err);
        result.reason = (err as Error).message;
        return result;
    }
}

if (require.main === module) {
    runUninstall().catch((err) => {
        console.error("[Orbit Uninstall] Fatal error:", err);
        process.exit(1);
    });
}
