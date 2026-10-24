import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";
import { writeAtomic } from "./fsx.js";

export interface UpdateMcpConfigResult {
    success: boolean;
    error?: string;
    backedUp?: boolean;
}

/**
 * Safely updates mcp_config.json to register the Orbit MCP server.
 * Uses jsonc-parser modify/applyEdits to preserve comments, formatting, and other servers.
 * If the existing file has syntax errors, halts immediately without modifying or overwriting.
 * If modifying an existing file, creates a backup file at <path>.orbit.bak if one does not already exist.
 */
export async function updateMcpConfig(
    mcpConfigPath: string,
    serverPath: string,
    nodeCommand: string = "node"
): Promise<UpdateMcpConfigResult> {
    let backedUp = false;
    const normalizedServerPath = serverPath.replace(/\\/g, "/");

    if (fs.existsSync(mcpConfigPath)) {
        let raw = fs.readFileSync(mcpConfigPath, "utf-8");
        const errors: jsonc.ParseError[] = [];
        const parsed = jsonc.parse(raw, errors, { allowTrailingComma: true });

        if (errors.length > 0 || parsed === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            const errorDetails = errors
                .map((e) => `offset ${e.offset}, error code ${e.error}`)
                .join("; ");
            return {
                success: false,
                error: `Failed to parse ${mcpConfigPath}: syntax errors detected (${errorDetails || "invalid JSON structure"}). Setup halted to protect existing configuration.`,
            };
        }

        // Backup existing file before modifications if backup does not already exist (V-09: preserve original)
        const backupPath = `${mcpConfigPath}.orbit.bak`;
        if (!fs.existsSync(backupPath)) {
            try {
                fs.copyFileSync(mcpConfigPath, backupPath);
                backedUp = true;
            } catch (err: unknown) {
                return {
                    success: false,
                    error: `Failed to create backup at ${backupPath}: ${(err as Error).message}`,
                };
            }
        }

        const formatOpts = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

        // Ensure mcpServers object exists
        if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
            const edits = jsonc.modify(raw, ["mcpServers"], {}, formatOpts);
            raw = jsonc.applyEdits(raw, edits);
        }

        // Clean up legacy server name only if it was registered for orbit / planner
        if (parsed.mcpServers && parsed.mcpServers["antigravity-planner"]) {
            const legacyArgs = parsed.mcpServers["antigravity-planner"]?.args;
            const isOrbitLegacy = Array.isArray(legacyArgs) && legacyArgs.some((a: unknown) =>
                typeof a === "string" && (a.includes("orbit") || a.includes("planner") || a.includes("mcp-server"))
            );
            if (isOrbitLegacy) {
                const edits = jsonc.modify(raw, ["mcpServers", "antigravity-planner"], undefined, formatOpts);
                raw = jsonc.applyEdits(raw, edits);
            }
        }

        // Register or update orbit MCP server while preserving user fields (like env or disabled)
        if (parsed.mcpServers && parsed.mcpServers["orbit"] && typeof parsed.mcpServers["orbit"] === "object") {
            const editsCmd = jsonc.modify(raw, ["mcpServers", "orbit", "command"], nodeCommand, formatOpts);
            raw = jsonc.applyEdits(raw, editsCmd);
            const editsArgs = jsonc.modify(raw, ["mcpServers", "orbit", "args"], [normalizedServerPath], formatOpts);
            raw = jsonc.applyEdits(raw, editsArgs);
        } else {
            const editsOrbit = jsonc.modify(
                raw,
                ["mcpServers", "orbit"],
                {
                    command: nodeCommand,
                    args: [normalizedServerPath],
                },
                formatOpts
            );
            raw = jsonc.applyEdits(raw, editsOrbit);
        }

        const originalRaw = fs.readFileSync(mcpConfigPath, "utf-8");
        if (raw !== originalRaw) {
            try {
                await writeAtomic(mcpConfigPath, raw);
            } catch (err: unknown) {
                return {
                    success: false,
                    error: `Failed to write updated configuration to ${mcpConfigPath}: ${(err as Error).message}`,
                };
            }
        }

        return { success: true, backedUp };
    } else {
        const dir = path.dirname(mcpConfigPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const initialConfig = {
            mcpServers: {
                orbit: {
                    command: nodeCommand,
                    args: [normalizedServerPath],
                },
            },
        };

        try {
            await writeAtomic(mcpConfigPath, JSON.stringify(initialConfig, null, 2) + "\n");
            return { success: true, backedUp: false };
        } catch (err: unknown) {
            return {
                success: false,
                error: `Failed to write new configuration to ${mcpConfigPath}: ${(err as Error).message}`,
            };
        }
    }
}
