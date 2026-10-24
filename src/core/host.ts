import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export interface HostInfo {
    isAntigravity: boolean;
    geminiDir: string;
    configDir: string;
    mcpConfigPath: string;
    mcpConfigPaths: string[];
    geminiMdPath: string;
}

/**
 * Determines whether a directory path belongs to an Antigravity installation (M-01).
 * Checks the parent folder of 'extensions' (e.g. .vscode vs .antigravity / .antigravity-ide).
 * Does NOT rely on substring matching on extension names.
 */
export function isAntigravityExtensionDir(dirPath: string): boolean {
    if (!dirPath || typeof dirPath !== "string") {
        return false;
    }
    const resolved = path.resolve(dirPath);
    const segments = resolved.split(/[\\/]/);
    const extIdx = segments.map((s) => s.toLowerCase()).lastIndexOf("extensions");
    if (extIdx <= 0) {
        return false;
    }

    const editorFolder = segments[extIdx - 1].toLowerCase();
    if (
        editorFolder === ".antigravity" ||
        editorFolder === "antigravity" ||
        editorFolder === "antigravity-ide" ||
        editorFolder === ".antigravity-ide"
    ) {
        return true;
    }
    // .vscode, .vscode-insiders, .vscode-server, code, etc.
    return false;
}

/**
 * Extracts the owning editor name from a globalStorage path (M-01).
 * Inspects directory hierarchy: e.g. .../<Editor>/User/globalStorage/...
 * Returns 'antigravity', 'vscode', or 'unknown'.
 */
export function getStorageOwner(storagePath: string): "antigravity" | "vscode" | "unknown" {
    if (!storagePath || typeof storagePath !== "string") {
        return "unknown";
    }
    const resolved = path.resolve(storagePath);
    const segments = resolved.split(/[\\/]/).map((s) => s.toLowerCase());
    const gsIdx = segments.lastIndexOf("globalstorage");
    if (gsIdx < 1) {
        return "unknown";
    }

    let editorSegment = segments[gsIdx - 1];
    if (editorSegment === "user" && gsIdx >= 2) {
        editorSegment = segments[gsIdx - 2];
    }

    if (
        editorSegment === "antigravity" ||
        editorSegment === "antigravity-ide" ||
        editorSegment === ".antigravity" ||
        editorSegment === ".antigravity-ide"
    ) {
        return "antigravity";
    }
    if (
        editorSegment === "code" ||
        editorSegment.startsWith("code ") ||
        editorSegment.startsWith("code-") ||
        editorSegment === ".vscode" ||
        editorSegment.startsWith(".vscode")
    ) {
        return "vscode";
    }
    return "unknown";
}

/**
 * Detects the host environment and configuration paths.
 * Supports Antigravity IDE (~/.gemini/antigravity-ide) and Antigravity CLI (~/.gemini/antigravity).
 * Supports detecting host environment from caller directory when appName is not available (M-01).
 * Discovers all existing candidate mcp_config.json files for multi-host cleanup (Q-01).
 */
export function detectHost(appName?: string, callerDir?: string): HostInfo {
    const homeDir = os.homedir();
    const geminiDir = path.join(homeDir, ".gemini");

    const ideConfigPath = path.join(geminiDir, "antigravity-ide", "mcp_config.json");
    const cliConfigPath = path.join(geminiDir, "antigravity", "mcp_config.json");

    const mcpConfigPaths: string[] = [];
    if (fs.existsSync(ideConfigPath)) {
        mcpConfigPaths.push(ideConfigPath);
    }
    if (fs.existsSync(cliConfigPath)) {
        mcpConfigPaths.push(cliConfigPath);
    }
    if (mcpConfigPaths.length === 0) {
        mcpConfigPaths.push(ideConfigPath);
    }

    let configDir = path.join(geminiDir, "antigravity-ide");
    if (!fs.existsSync(configDir) && fs.existsSync(path.join(geminiDir, "antigravity"))) {
        configDir = path.join(geminiDir, "antigravity");
    }

    // V-02 & M-01 Minimal Host Gate: Rely on appName or structural callerDir inspection
    let isAntigravity = false;
    if (appName) {
        isAntigravity = /antigravity/i.test(appName);
    } else if (callerDir) {
        isAntigravity = isAntigravityExtensionDir(callerDir);
    }

    return {
        isAntigravity,
        geminiDir,
        configDir,
        mcpConfigPath: path.join(configDir, "mcp_config.json"),
        mcpConfigPaths,
        geminiMdPath: path.join(geminiDir, "GEMINI.md"),
    };
}

