import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";

export interface UpdateMcpConfigResult {
    success: boolean;
    error?: string;
    backedUp?: boolean;
}

/**
 * Safely updates mcp_config.json to register the Orbit MCP server.
 * Uses jsonc-parser to preserve compatibility with JSON with comments/trailing commas.
 * If the existing file has syntax errors, halts immediately without modifying or overwriting.
 * If modifying an existing file, creates a backup file at <path>.orbit.bak first.
 */
export function updateMcpConfig(
    mcpConfigPath: string,
    serverPath: string
): UpdateMcpConfigResult {
    let mcpConfig: any = { mcpServers: {} };
    let backedUp = false;

    if (fs.existsSync(mcpConfigPath)) {
        const raw = fs.readFileSync(mcpConfigPath, "utf-8");
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

        mcpConfig = parsed;
        if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object" || Array.isArray(mcpConfig.mcpServers)) {
            mcpConfig.mcpServers = {};
        }

        // Backup existing file before modifications
        try {
            fs.copyFileSync(mcpConfigPath, `${mcpConfigPath}.orbit.bak`);
            backedUp = true;
        } catch (err: any) {
            return {
                success: false,
                error: `Failed to create backup at ${mcpConfigPath}.orbit.bak: ${err.message}`,
            };
        }
    } else {
        const dir = path.dirname(mcpConfigPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // Clean up legacy server name if present
    if (mcpConfig.mcpServers["antigravity-planner"]) {
        delete mcpConfig.mcpServers["antigravity-planner"];
    }

    // Register or update the orbit MCP server
    const normalizedServerPath = serverPath.replace(/\\/g, "/");
    mcpConfig.mcpServers["orbit"] = {
        command: "node",
        args: [normalizedServerPath],
    };

    try {
        fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
        return { success: true, backedUp };
    } catch (err: any) {
        return {
            success: false,
            error: `Failed to write updated configuration to ${mcpConfigPath}: ${err.message}`,
        };
    }
}
