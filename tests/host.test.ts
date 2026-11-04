import { LEGACY_EXTENSION_IDS } from "../src/core/config";
import { describe, it, expect } from "vitest";
import { detectHost } from "../src/core/host";

describe("detectHost", () => {
    it("identifies Antigravity IDE when appName contains antigravity (case-insensitive)", () => {
        expect(detectHost("Antigravity").isAntigravity).toBe(true);
        expect(detectHost("antigravity-ide").isAntigravity).toBe(true);
        expect(detectHost("Google Antigravity IDE").isAntigravity).toBe(true);
    });

    it("does NOT identify standard VS Code or Cursor as Antigravity even if ~/.gemini exists", () => {
        expect(detectHost("Visual Studio Code").isAntigravity).toBe(false);
        expect(detectHost("Code - OSS").isAntigravity).toBe(false);
        expect(detectHost("Cursor").isAntigravity).toBe(false);
        expect(detectHost(undefined).isAntigravity).toBe(false);
        expect(detectHost("").isAntigravity).toBe(false);
    });

    it("correctly identifies host from real extension installation paths using directory hierarchy (M-01)", () => {
        const realExtensionDirName = `${LEGACY_EXTENSION_IDS[1]}-0.4.0`;

        // Stock VS Code on Windows - contains "antigravity" in extension name but parent of extensions is .vscode
        const vscodeCaller = `C:/Users/fixture-user/.vscode/extensions/${realExtensionDirName}/out`;
        expect(detectHost(undefined, vscodeCaller).isAntigravity).toBe(false);

        // VS Code Insiders
        const insidersCaller = `C:/Users/fixture-user/.vscode-insiders/extensions/${realExtensionDirName}/out`;
        expect(detectHost(undefined, insidersCaller).isAntigravity).toBe(false);

        // Antigravity on Windows (.antigravity, .antigravity-ide, or AppData/Roaming/Antigravity)
        const antigravityCaller = `C:/Users/fixture-user/.antigravity/extensions/${realExtensionDirName}/out`;
        expect(detectHost(undefined, antigravityCaller).isAntigravity).toBe(true);

        const antigravityIdeCaller = `C:/Users/fixture-user/.antigravity-ide/extensions/${realExtensionDirName}/out`;
        expect(detectHost(undefined, antigravityIdeCaller).isAntigravity).toBe(true);

        const antigravityRoamingCaller = `C:/Users/fixture-user/AppData/Roaming/Antigravity/extensions/${realExtensionDirName}/out`;
        expect(detectHost(undefined, antigravityRoamingCaller).isAntigravity).toBe(true);

        // Development repository path (e.g. C:/antigravity projects/Orbit/out)
        const devRepoCaller = `C:/antigravity projects/Orbit/out`;
        expect(detectHost(undefined, devRepoCaller).isAntigravity).toBe(false);
    });

    it("correctly extracts storage owner from User/globalStorage directory structure (M-01)", async () => {
        const { getStorageOwner } = await import("../src/core/host");
        const realExtensionDirName = LEGACY_EXTENSION_IDS[1];

        // VS Code storage on Windows
        const vscodeStorage = `C:/Users/fixture-user/AppData/Roaming/Code/User/globalStorage/${realExtensionDirName}/mcp-server/index.js`;
        expect(getStorageOwner(vscodeStorage)).toBe("vscode");

        // VS Code Insiders storage
        const insidersStorage = `C:/Users/fixture-user/AppData/Roaming/Code - Insiders/User/globalStorage/${realExtensionDirName}/mcp-server/index.js`;
        expect(getStorageOwner(insidersStorage)).toBe("vscode");

        // Antigravity storage
        const antigravityStorage = `C:/Users/fixture-user/AppData/Roaming/Antigravity/User/globalStorage/${realExtensionDirName}/mcp-server/index.js`;
        expect(getStorageOwner(antigravityStorage)).toBe("antigravity");

        // Linux/macOS paths
        expect(getStorageOwner(`/home/user/.config/Code/User/globalStorage/${realExtensionDirName}/mcp-server/index.js`)).toBe("vscode");
        expect(getStorageOwner(`/home/user/.config/Antigravity/User/globalStorage/${realExtensionDirName}/mcp-server/index.js`)).toBe("antigravity");

        // vntrcorp.orbit paths (N-07)
        expect(getStorageOwner(`C:/Users/fixture-user/AppData/Roaming/Code/User/globalStorage/vntrcorp.orbit/mcp-server/index.js`)).toBe("vscode");
        expect(getStorageOwner(`C:/Users/fixture-user/AppData/Roaming/Antigravity/User/globalStorage/vntrcorp.orbit/mcp-server/index.js`)).toBe("antigravity");
    });

    it("verifies vntrcorp.orbit-0.4.0 extension folder identifies host environment correctly (N-07)", () => {
        const orbitExtDir = "vntrcorp.orbit-0.4.0";
        expect(detectHost(undefined, `C:/Users/fixture-user/.vscode/extensions/${orbitExtDir}/out`).isAntigravity).toBe(false);
        expect(detectHost(undefined, `C:/Users/fixture-user/.antigravity/extensions/${orbitExtDir}/out`).isAntigravity).toBe(true);
        expect(detectHost(undefined, `C:/Users/fixture-user/.antigravity-ide/extensions/${orbitExtDir}/out`).isAntigravity).toBe(true);
    });

    it("populates mcpConfigPaths array with existing candidate files (Q-01)", () => {
        const host = detectHost("Antigravity");
        expect(Array.isArray(host.mcpConfigPaths)).toBe(true);
        expect(host.mcpConfigPaths.length).toBeGreaterThan(0);
        for (const p of host.mcpConfigPaths) {
            expect(p).toContain("mcp_config.json");
        }
    });
});
