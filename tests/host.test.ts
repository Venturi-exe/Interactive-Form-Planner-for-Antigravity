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
});
