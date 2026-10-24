/**
 * Orbit uninstall hook.
 * Executed automatically by VS Code when the extension is uninstalled.
 */
import * as fs from "fs";
import * as jsonc from "jsonc-parser";
import { detectHost } from "./core/host.js";
import { removeOrbitRules } from "./core/rules.js";
import { writeAtomic } from "./core/fsx.js";

export async function runUninstall(): Promise<void> {
    try {
        console.log("[Orbit Uninstall] Starting clean removal...");
        const host = detectHost();

        // 1. Remove Orbit rules block from GEMINI.md
        if (fs.existsSync(host.geminiMdPath)) {
            try {
                const removed = await removeOrbitRules(host.geminiMdPath);
                if (removed) {
                    console.log("[Orbit Uninstall] Removed Orbit marker rules from GEMINI.md");
                }
            } catch (err) {
                console.error("[Orbit Uninstall] Failed to clean GEMINI.md:", err);
            }
        }

        // 2. Remove orbit MCP server registration from mcp_config.json
        if (fs.existsSync(host.mcpConfigPath)) {
            try {
                const raw = fs.readFileSync(host.mcpConfigPath, "utf-8");
                const errors: jsonc.ParseError[] = [];
                const config = jsonc.parse(raw, errors, { allowTrailingComma: true });

                // V-03: If mcp_config.json has parse errors, abort immediately to protect user configuration
                if (errors.length > 0 || config === undefined || typeof config !== "object" || config === null) {
                    console.error("[Orbit Uninstall] Syntax errors detected in mcp_config.json. Aborting MCP server cleanup to avoid corrupting user configuration.");
                    return;
                }

                if (config.mcpServers && config.mcpServers.orbit) {
                    const orbitEntry = config.mcpServers.orbit;
                    // V-03: Verify that mcpServers.orbit actually belongs to Orbit before removal
                    const isOrbitServer =
                        (Array.isArray(orbitEntry.args) && orbitEntry.args.some((a: unknown) => typeof a === "string" && (a.includes("orbit") || a.includes("mcp-server")))) ||
                        (typeof orbitEntry.command === "string" && orbitEntry.command.includes("orbit"));

                    if (isOrbitServer) {
                        // Backup before modifying if backup does not already exist
                        const backupPath = `${host.mcpConfigPath}.orbit.bak`;
                        if (!fs.existsSync(backupPath)) {
                            fs.copyFileSync(host.mcpConfigPath, backupPath);
                        }

                        // Use jsonc.modify and applyEdits to preserve comments, indentation, and trailing commas
                        const edits = jsonc.modify(raw, ["mcpServers", "orbit"], undefined, {
                            formattingOptions: { insertSpaces: true, tabSize: 2 },
                        });
                        const updated = jsonc.applyEdits(raw, edits);
                        await writeAtomic(host.mcpConfigPath, updated);
                        console.log("[Orbit Uninstall] Removed Orbit MCP server from mcp_config.json");
                    } else {
                        console.log("[Orbit Uninstall] mcpServers.orbit does not appear to belong to Orbit. Skipping removal.");
                    }
                }
            } catch (err) {
                console.error("[Orbit Uninstall] Failed to clean mcp_config.json:", err);
            }
        }

        console.log("[Orbit Uninstall] Cleanup completed successfully.");
    } catch (err) {
        console.error("[Orbit Uninstall] Unexpected error during cleanup:", err);
    }
}

if (require.main === module) {
    runUninstall().catch((err) => {
        console.error("[Orbit Uninstall] Fatal error:", err);
        process.exit(1);
    });
}

