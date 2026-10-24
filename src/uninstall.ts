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
import { removeOrbitRules } from "./core/rules.js";
import { writeAtomic, createRollingBackup } from "./core/fsx.js";

export interface UninstallOptions {
    appName?: string;
    callerDir?: string;
    globalStoragePath?: string;
    mcpConfigPath?: string;
    geminiMdPath?: string;
}

export interface UninstallResult {
    success: boolean;
    removedServer: boolean;
    removedRules: boolean;
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

    // Fallback check for standalone uninstall execution (where globalStoragePath is not injected) (M-01)
    if (!globalStoragePath) {
        const lowerArg0 = arg0.toLowerCase();
        const isMcpBundle =
            (lowerArg0.endsWith("index.js") || lowerArg0.includes("mcp-server")) &&
            (lowerArg0.includes("orbit") || lowerArg0.includes("antigravity-interactive-form-planner") || lowerArg0.includes("vntrcorp"));

        if (isMcpBundle) {
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
        const mcpConfigPath = options?.mcpConfigPath || host.mcpConfigPath;
        const geminiMdPath = options?.geminiMdPath || host.geminiMdPath;
        const globalStoragePath = options?.globalStoragePath;

        // 1. Remove orbit MCP server registration from mcp_config.json FIRST
        // If mcp_config.json has parse errors, abort immediately before modifying GEMINI.md
        if (fs.existsSync(mcpConfigPath)) {
            try {
                const raw = fs.readFileSync(mcpConfigPath, "utf-8");
                const errors: jsonc.ParseError[] = [];
                const config = jsonc.parse(raw, errors, { allowTrailingComma: true });

                // V-03: If mcp_config.json has parse errors, abort immediately to protect user configuration
                if (errors.length > 0 || config === undefined || typeof config !== "object" || config === null) {
                    const msg = "[Orbit Uninstall] Syntax errors detected in mcp_config.json. Aborting MCP server cleanup to avoid corrupting user configuration.";
                    console.error(msg);
                    result.reason = "Syntax errors detected in mcp_config.json";
                    return result;
                }

                if (config.mcpServers && typeof config.mcpServers === "object") {
                    let updatedRaw = raw;
                    const formatOpts = { formattingOptions: { insertSpaces: true, tabSize: 2 } };
                    let backedUp = false;

                    // Only candidates are "orbit" and "antigravity-planner" (N-01)
                    for (const key of ["orbit", "antigravity-planner"]) {
                        const entry = config.mcpServers[key];
                        if (entry && isOrbitServerEntry(key, entry, globalStoragePath, host.isAntigravity)) {
                            // Backup before modifying using rolling backup (N-01: keep last 3)
                            if (!backedUp) {
                                await createRollingBackup(mcpConfigPath, 3);
                                backedUp = true;
                            }

                            const edits = jsonc.modify(updatedRaw, ["mcpServers", key], undefined, formatOpts);
                            updatedRaw = jsonc.applyEdits(updatedRaw, edits);
                            result.removedServer = true;
                        }
                    }

                    if (result.removedServer && updatedRaw !== raw) {
                        await writeAtomic(mcpConfigPath, updatedRaw);
                    }
                }
            } catch (err: unknown) {
                console.error("[Orbit Uninstall] Failed to clean mcp_config.json:", err);
                result.reason = (err as Error).message;
                return result;
            }
        }

        // 2. Remove Orbit rules block from GEMINI.md
        // Only remove if host is Antigravity (M-01: stock VS Code must NEVER remove GEMINI.md rules)
        // Cleaned after mcp_config.json so parse errors in mcp_config.json do not leave GEMINI.md half-uninstalled
        const shouldCleanRules = host.isAntigravity;
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
