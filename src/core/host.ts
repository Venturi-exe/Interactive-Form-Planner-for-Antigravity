import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export interface HostInfo {
    isAntigravity: boolean;
    geminiDir: string;
    configDir: string;
    mcpConfigPath: string;
    geminiMdPath: string;
}

/**
 * Detects the host environment and configuration paths.
 * Supports Antigravity IDE (~/.gemini/antigravity-ide) and Antigravity CLI (~/.gemini/antigravity).
 */
export function detectHost(appName?: string): HostInfo {
    const homeDir = os.homedir();
    const geminiDir = path.join(homeDir, ".gemini");

    let configDir = path.join(geminiDir, "antigravity-ide");
    if (!fs.existsSync(configDir) && fs.existsSync(path.join(geminiDir, "antigravity"))) {
        configDir = path.join(geminiDir, "antigravity");
    }

    // V-02 Minimal Host Gate: Strictly rely on appName containing "antigravity".
    // Do NOT treat standard VS Code with Gemini CLI installed as Antigravity host.
    const isAntigravity = Boolean(appName && /antigravity/i.test(appName));

    return {
        isAntigravity,
        geminiDir,
        configDir,
        mcpConfigPath: path.join(configDir, "mcp_config.json"),
        geminiMdPath: path.join(geminiDir, "GEMINI.md"),
    };
}
