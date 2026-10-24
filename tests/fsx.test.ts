import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { writeAtomic, writeJsonAtomic, readJsonSafe, ensureDirSafe } from "../src/core/fsx.js";

describe("fsx atomic operations", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-fsx-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("writeAtomic creates target file cleanly and removes temporary sibling", async () => {
        const target = path.join(tempDir, "sub", "target.txt");
        await writeAtomic(target, "hello atomic world");

        expect(fs.existsSync(target)).toBe(true);
        expect(fs.readFileSync(target, "utf-8")).toBe("hello atomic world");

        // Verify no leftover .tmp files
        const parentDir = path.dirname(target);
        const files = fs.readdirSync(parentDir);
        expect(files).toEqual(["target.txt"]);
    });

    it("writeJsonAtomic serializes JSON and preserves formatting", async () => {
        const target = path.join(tempDir, "data.json");
        const payload = { key: "value", num: 42, list: [1, 2, 3] };

        await writeJsonAtomic(target, payload);

        expect(fs.existsSync(target)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(target, "utf-8"));
        expect(parsed).toEqual(payload);
    });

    it("readJsonSafe parses valid JSON", async () => {
        const target = path.join(tempDir, "read.json");
        fs.writeFileSync(target, JSON.stringify({ status: "ok" }), "utf-8");

        const result = await readJsonSafe<{ status: string }>(target);
        expect(result.status).toBe("ok");
    });

    it("readJsonSafe rejects files that exceed maxSizeBytes", async () => {
        const target = path.join(tempDir, "big.json");
        const bigContent = JSON.stringify({ data: "x".repeat(1000) });
        fs.writeFileSync(target, bigContent, "utf-8");

        await expect(readJsonSafe(target, 500)).rejects.toThrow("exceeds maximum permitted limit");
    });

    it("ensureDirSafe creates nested directories", async () => {
        const nested = path.join(tempDir, "a", "b", "c");
        await ensureDirSafe(nested);
        expect(fs.existsSync(nested)).toBe(true);
    });
});
