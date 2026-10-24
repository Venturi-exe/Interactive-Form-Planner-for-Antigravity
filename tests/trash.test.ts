import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { moveToTrash, listTrash, restoreFromTrash, purgeExpiredTrash } from "../src/core/trash.js";

describe("trash operations (N-07, N-13)", () => {
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

    it("listTrash correctly extracts originalName from timestamp and uuid (N-13)", async () => {
        const file1 = path.join(mockBrainRoot, "file_with_underscores_v1.txt");
        const file2 = path.join(mockBrainRoot, "file2.txt");
        fs.writeFileSync(file1, "12345", "utf-8");
        fs.writeFileSync(file2, "1234567890", "utf-8");

        await moveToTrash(file1, mockBrainRoot);
        await moveToTrash(file2, mockBrainRoot);

        const list = await listTrash(mockBrainRoot);
        expect(list.length).toBe(2);
        const originalNames = list.map((item) => item.originalName).sort();
        expect(originalNames).toEqual(["file2.txt", "file_with_underscores_v1.txt"]);
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

    it("restoreFromTrash rejects path traversal and existing destination (N-07)", async () => {
        const testFile = path.join(mockBrainRoot, "source.txt");
        fs.writeFileSync(testFile, "data", "utf-8");
        const trashedPath = await moveToTrash(testFile, mockBrainRoot);
        const trashedFileName = path.basename(trashedPath);

        // Path traversal rejection
        await expect(
            restoreFromTrash(`../${trashedFileName}`, path.join(mockBrainRoot, "dest.txt"), mockBrainRoot)
        ).rejects.toThrow(/Invalid trashed file name/i);

        // Existing destination rejection
        const existingDest = path.join(mockBrainRoot, "already_exists.txt");
        fs.writeFileSync(existingDest, "do not overwrite", "utf-8");

        await expect(
            restoreFromTrash(trashedFileName, existingDest, mockBrainRoot)
        ).rejects.toThrow(/destination path already exists/i);

        expect(fs.readFileSync(existingDest, "utf-8")).toBe("do not overwrite");
    });

    it("purgeExpiredTrash measures age from timestamp prefix rather than file mtime (V-05, N-13)", async () => {
        const trashDir = path.join(mockBrainRoot, ".trash");
        fs.mkdirSync(trashDir, { recursive: true });

        // File trashed today, but with old modification time (edited 30 days ago)
        const recentlyTrashedOldFile = path.join(trashDir, "20261024T120000Z_12345678_old_edit.txt");
        fs.writeFileSync(recentlyTrashedOldFile, "edited long ago", "utf-8");
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        fs.utimesSync(recentlyTrashedOldFile, thirtyDaysAgo, thirtyDaysAgo);

        // File trashed 30 days ago, with fresh modification time (e.g. touched during restore attempt)
        const ancientTrash = path.join(trashDir, "20200101T000000Z_87654321_ancient.txt");
        fs.writeFileSync(ancientTrash, "ancient", "utf-8");
        fs.utimesSync(ancientTrash, new Date(), new Date());

        const purged = await purgeExpiredTrash(14 * 24 * 60 * 60 * 1000, mockBrainRoot);
        expect(purged).toBe(1);

        // Ancient trash must be purged, while recently trashed file MUST be preserved!
        expect(fs.existsSync(ancientTrash)).toBe(false);
        expect(fs.existsSync(recentlyTrashedOldFile)).toBe(true);
    });

    it("supports trashing, listing, and restoring whole directories (V-05)", async () => {
        const testSubdir = path.join(mockBrainRoot, "project_folder");
        fs.mkdirSync(testSubdir, { recursive: true });
        fs.writeFileSync(path.join(testSubdir, "subfile.txt"), "sub content", "utf-8");

        const trashedPath = await moveToTrash(testSubdir, mockBrainRoot);
        expect(fs.existsSync(testSubdir)).toBe(false);
        expect(fs.existsSync(trashedPath)).toBe(true);

        const list = await listTrash(mockBrainRoot);
        const folderEntry = list.find((item) => item.originalName === "project_folder");
        expect(folderEntry).toBeDefined();
        expect(folderEntry?.isDirectory).toBe(true);

        // Restore directory
        const restoredDir = path.join(mockBrainRoot, "restored_folder");
        await restoreFromTrash(path.basename(trashedPath), restoredDir, mockBrainRoot);
        expect(fs.existsSync(restoredDir)).toBe(true);
        expect(fs.readFileSync(path.join(restoredDir, "subfile.txt"), "utf-8")).toBe("sub content");
    });
});
