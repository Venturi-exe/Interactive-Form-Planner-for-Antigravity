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
 * Supports detecting host environment from caller directory when appName is not available (M-01).
 */
export function detectHost(appName?: string, callerDir?: string): HostInfo {
    const homeDir = os.homedir();
    const geminiDir = path.join(homeDir, ".gemini");

    let configDir = path.join(geminiDir, "antigravity-ide");
    if (!fs.existsSync(configDir) && fs.existsSync(path.join(geminiDir, "antigravity"))) {
        configDir = path.join(geminiDir, "antigravity");
    }

    // V-02 & M-01 Minimal Host Gate: Strictly rely on appName or callerDir containing "antigravity".
    let isAntigravity = false;
    if (appName) {
        isAntigravity = /antigravity/i.test(appName);
    } else if (callerDir) {
        const norm = callerDir.toLowerCase();
        if (norm.includes("antigravity")) {
            isAntigravity = true;
        } else if (norm.includes(".vscode") || norm.includes("code")) {
            isAntigravity = false;
        }
    }

    return {
        isAntigravity,
        geminiDir,
        configDir,
        mcpConfigPath: path.join(configDir, "mcp_config.json"),
        geminiMdPath: path.join(geminiDir, "GEMINI.md"),
    };
}
