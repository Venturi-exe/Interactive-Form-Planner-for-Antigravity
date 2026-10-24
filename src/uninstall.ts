/**
 * Orbit uninstall hook.
 * Executed automatically by VS Code when the extension is uninstalled.
 */
import * as fs from "fs";
import * as jsonc from "jsonc-parser";
import { detectHost } from "./core/host.js";
import { removeOrbitRules } from "./core/rules.js";

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

                if (config && config.mcpServers && config.mcpServers.orbit) {
                    delete config.mcpServers.orbit;
                    fs.writeFileSync(host.mcpConfigPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
                    console.log("[Orbit Uninstall] Removed Orbit MCP server from mcp_config.json");
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
