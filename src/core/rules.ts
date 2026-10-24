import * as fs from "fs";
import * as path from "path";
import { writeAtomic } from "./fsx.js";

export const ORBIT_START_MARKER = "<!-- ORBIT_RULES_START -->";
export const ORBIT_END_MARKER = "<!-- ORBIT_RULES_END -->";

/**
 * Injects or updates Orbit rules inside GEMINI.md within explicit HTML comment markers.
 * If markers already exist, only the content between them is updated.
 * Non-Orbit user rules and instructions are completely preserved.
 */
export async function injectOrbitRules(
    geminiMdPath: string,
    rulesContent: string
): Promise<boolean> {
    const block = `${ORBIT_START_MARKER}\n${rulesContent.trim()}\n${ORBIT_END_MARKER}\n`;

    if (!fs.existsSync(geminiMdPath)) {
        const dir = path.dirname(geminiMdPath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await writeAtomic(geminiMdPath, `# Agent Instructions\n\n${block}`);
        return true;
    }

    const current = await fs.promises.readFile(geminiMdPath, "utf-8");
    const startIndex = current.indexOf(ORBIT_START_MARKER);
    const endIndex = current.indexOf(ORBIT_END_MARKER);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const before = current.substring(0, startIndex);
        const after = current.substring(endIndex + ORBIT_END_MARKER.length);
        const updated = `${before.trimEnd()}\n\n${block}\n${after.trimStart()}`.trim() + "\n";
        await writeAtomic(geminiMdPath, updated);
        return true;
    }

    // Clean up any legacy untagged Orbit sections if present
    let cleaned = current;
    if (cleaned.includes("## Orbit Planner") || cleaned.includes("## Orbit Memory System")) {
        cleaned = cleaned.replace(/## Orbit Planner: Mandatory Usage Policy[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Deep Prompt Refining[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Planning Receipt[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Planner: Clarification Rule[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Planner: Timeout Rule[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Cartograph: Impact Tracking Rule[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Cartograph: Rich Planning Context and Trigger Rules[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Memory System[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Cartograph: Auto-Merge Protocol[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Cartograph: Organize All Reports[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Cartograph: Merged Report Format[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Orbit Cartograph: Artifact Protocol[\s\S]*?(?=##|$)/, "");
        cleaned = cleaned.replace(/## Walkthrough Report Format[\s\S]*?(?=##|$)/, "");
    }

    const newContent = `${cleaned.trim()}\n\n${block}`.trim() + "\n";
    await writeAtomic(geminiMdPath, newContent);
    return true;
}

/**
 * Removes the Orbit rules block from GEMINI.md.
 */
export async function removeOrbitRules(geminiMdPath: string): Promise<boolean> {
    if (!fs.existsSync(geminiMdPath)) {
        return false;
    }

    const current = await fs.promises.readFile(geminiMdPath, "utf-8");
    const startIndex = current.indexOf(ORBIT_START_MARKER);
    const endIndex = current.indexOf(ORBIT_END_MARKER);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const before = current.substring(0, startIndex).trimEnd();
        const after = current.substring(endIndex + ORBIT_END_MARKER.length).trimStart();
        let updated = before && after ? `${before}\n\n${after}\n` : (before || after ? `${before || after}\n` : "");
        if (updated.trim() === "# Agent Instructions") {
            updated = "";
        }
        await writeAtomic(geminiMdPath, updated);
        return true;
    }

    return false;
}
