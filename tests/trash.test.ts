import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { moveToTrash, listTrash, restoreFromTrash, purgeExpiredTrash } from "../src/core/trash.js";

describe("trash operations", () => {
    let mockBrainRoot: string;

    beforeEach(() => {
        mockBrainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-trash-test-"));
    });

    afterEach(() => {
        try {
            fs.rmSync(mockBrainRoot, { recursive: true, force: true });
        } catch { /* cleanup */ }
    });

    it("moveToTrash moves file into .trash directory with timestamp prefix", async () => {
        const testFile = path.join(mockBrainRoot, "important_report.json");
        fs.writeFileSync(testFile, JSON.stringify({ data: "preserve me" }), "utf-8");

        const destPath = await moveToTrash(testFile, mockBrainRoot);

        expect(fs.existsSync(testFile)).toBe(false);
        expect(fs.existsSync(destPath)).toBe(true);
        expect(destPath).toContain(".trash");
        expect(path.basename(destPath)).toContain("important_report.json");
    });

    it("listTrash enumerates files in .trash", async () => {
        const file1 = path.join(mockBrainRoot, "file1.txt");
        const file2 = path.join(mockBrainRoot, "file2.txt");
        fs.writeFileSync(file1, "12345", "utf-8");
        fs.writeFileSync(file2, "1234567890", "utf-8");

        await moveToTrash(file1, mockBrainRoot);
        await moveToTrash(file2, mockBrainRoot);

        const list = await listTrash(mockBrainRoot);
        expect(list.length).toBe(2);
        const originalNames = list.map((item) => item.originalName).sort();
        expect(originalNames).toEqual(["file1.txt", "file2.txt"]);
    });

    it("restoreFromTrash restores file back to destination", async () => {
        const testFile = path.join(mockBrainRoot, "restore_me.txt");
        fs.writeFileSync(testFile, "restorable content", "utf-8");

        const trashedPath = await moveToTrash(testFile, mockBrainRoot);
        const trashedFileName = path.basename(trashedPath);

        const targetRestorePath = path.join(mockBrainRoot, "restored", "restore_me.txt");
        await restoreFromTrash(trashedFileName, targetRestorePath, mockBrainRoot);

        expect(fs.existsSync(targetRestorePath)).toBe(true);
        expect(fs.readFileSync(targetRestorePath, "utf-8")).toBe("restorable content");
        expect(fs.existsSync(trashedPath)).toBe(false);
    });

    it("purgeExpiredTrash removes files older than TTL", async () => {
        const trashDir = path.join(mockBrainRoot, ".trash");
        fs.mkdirSync(trashDir, { recursive: true });

        const oldFile = path.join(trashDir, "20200101_ancient.txt");
        const freshFile = path.join(trashDir, "20261024_fresh.txt");

        fs.writeFileSync(oldFile, "old", "utf-8");
        fs.writeFileSync(freshFile, "fresh", "utf-8");

        // Manually adjust oldFile's mtime to 30 days in the past
        const pastTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        fs.utimesSync(oldFile, pastTime, pastTime);

        const purged = await purgeExpiredTrash(14 * 24 * 60 * 60 * 1000, mockBrainRoot);
        expect(purged).toBe(1);

        expect(fs.existsSync(oldFile)).toBe(false);
        expect(fs.existsSync(freshFile)).toBe(true);
    });
});
