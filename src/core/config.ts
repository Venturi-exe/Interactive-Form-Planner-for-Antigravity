import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";
import { writeAtomic, createRollingBackup } from "./fsx.js";

// Historical package IDs used only for compatibility and removal of old registrations.
export const LEGACY_EXTENSION_IDS = [
    "vntrcorp.antigravity-pre-execution-form-planner",
    "vntrcorp.antigravity-interactive-form-planner-planning-tool",
] as const;

export interface UpdateMcpConfigResult {
    success: boolean;
    error?: string;
    backedUp?: boolean;
}

/**
 * Safely updates mcp_config.json to register the Orbit MCP server.
 * Uses jsonc-parser modify/applyEdits to preserve comments, formatting, and other servers.
 * If the existing file has syntax errors, halts immediately without modifying or overwriting.
 * Creates a rolling timestamped backup (keeping the last 3) before making changes.
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

        // N-14: Treat 0-byte or whitespace-only mcp_config.json as empty object instead of halting
        if (raw.trim().length === 0) {
            raw = "{\n  \"mcpServers\": {}\n}\n";
        }

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

        // Backup existing file before modifications using rolling backups (N-01 / N-14: keep last 3)
        try {
            await createRollingBackup(mcpConfigPath, 3);
            backedUp = true;
        } catch (err: unknown) {
            return {
                success: false,
                error: `Failed to create backup for ${mcpConfigPath}: ${(err as Error).message}`,
            };
        }

        const formatOpts = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

        // Ensure mcpServers object exists
        if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) {
            const edits = jsonc.modify(raw, ["mcpServers"], {}, formatOpts);
            raw = jsonc.applyEdits(raw, edits);
        }

        // N-14: Check if existing orbit server belongs to Orbit before overwriting
        if (parsed.mcpServers && parsed.mcpServers["orbit"]) {
            const existingOrbit = parsed.mcpServers["orbit"];
            if (typeof existingOrbit === "object" && existingOrbit !== null) {
                const existingArgs = existingOrbit.args;
                const arg0 = Array.isArray(existingArgs) && typeof existingArgs[0] === "string" ? existingArgs[0] : "";
                const isOrbit =
                    arg0.includes("mcp-server") ||
                    arg0.includes(".antigravity-forms") ||
                    arg0.includes("globalStorage") ||
                    arg0.includes("antigravity-interactive-form-planner") ||
                    (typeof existingOrbit.command === "string" && existingOrbit.command.includes("orbit") && arg0.endsWith("index.js"));

                if (!isOrbit) {
                    return {
                        success: false,
                        error: `Existing mcpServers.orbit entry does not appear to belong to Orbit. Setup halted to avoid overwriting third-party configuration.`,
                    };
                }
            }
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
