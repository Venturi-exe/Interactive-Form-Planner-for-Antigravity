import * as fs from "fs";
import * as path from "path";
import { writeAtomic } from "./fsx.js";

export const ORBIT_START_MARKER = "<!-- ORBIT_RULES_V1_START -->";
export const ORBIT_END_MARKER = "<!-- ORBIT_RULES_V1_END -->";

const LEGACY_START_MARKER = "<!-- ORBIT_RULES_START -->";
const LEGACY_END_MARKER = "<!-- ORBIT_RULES_END -->";

/**
 * Finds the start and end indices of Orbit rules markers in content.
 * Supports current v1 markers and legacy markers.
 */
function findMarkers(content: string): { start: number; end: number; endMarkerLen: number } | null {
    const start = content.indexOf(ORBIT_START_MARKER);
    const end = content.indexOf(ORBIT_END_MARKER);

    // If either v1 marker is present, use v1 (detects matching or orphaned v1 markers)
    if (start !== -1 || end !== -1) {
        return { start, end, endMarkerLen: ORBIT_END_MARKER.length };
    }

    // Only fallback to legacy markers if neither v1 marker is present
    const legStart = content.indexOf(LEGACY_START_MARKER);
    const legEnd = content.indexOf(LEGACY_END_MARKER);
    if (legStart !== -1 || legEnd !== -1) {
        return { start: legStart, end: legEnd, endMarkerLen: LEGACY_END_MARKER.length };
    }

    return null;
}

/**
 * Injects or updates Orbit rules inside GEMINI.md within explicit versioned HTML comment markers.
 * If markers already exist, only the content between them is updated.
 * Non-Orbit user rules and instructions are completely preserved.
 * Windows CRLF line endings are preserved.
 * Backs up GEMINI.md before modification.
 */
export async function injectOrbitRules(
    geminiMdPath: string,
    rulesContent: string
): Promise<boolean> {
    const isWindows = process.platform === "win32";
    const newline = isWindows ? "\r\n" : "\n";
    const block = `${ORBIT_START_MARKER}${newline}${rulesContent.trim()}${newline}${ORBIT_END_MARKER}${newline}`;

    if (!fs.existsSync(geminiMdPath)) {
        const dir = path.dirname(geminiMdPath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
        await writeAtomic(geminiMdPath, `# Agent Instructions${newline}${newline}${block}`);
        return true;
    }

    const current = await fs.promises.readFile(geminiMdPath, "utf-8");
    const activeNewline = current.includes("\r\n") ? "\r\n" : "\n";

    // V-10: Backup GEMINI.md before first modification
    const backupPath = `${geminiMdPath}.orbit.bak`;
    if (!fs.existsSync(backupPath)) {
        try {
            await fs.promises.copyFile(geminiMdPath, backupPath);
        } catch (err) {
            console.warn(`[Orbit Rules] Failed to create backup at ${backupPath}:`, err);
        }
    }

    const markers = findMarkers(current);

    // V-10: Guard against orphaned markers
    if (markers) {
        if (markers.start !== -1 && markers.end === -1) {
            throw new Error(`Orphaned Orbit start marker detected in ${geminiMdPath} without matching end marker. Edit halted to protect user text.`);
        }
        if (markers.start === -1 && markers.end !== -1) {
            throw new Error(`Orphaned Orbit end marker detected in ${geminiMdPath} without matching start marker. Edit halted to protect user text.`);
        }
        if (markers.end < markers.start) {
            throw new Error(`Mismatched Orbit markers in ${geminiMdPath} (end marker precedes start marker). Edit halted to protect user text.`);
        }

        const before = current.substring(0, markers.start);
        const after = current.substring(markers.end + markers.endMarkerLen);
        const updated = `${before.trimEnd()}${activeNewline}${activeNewline}${block}${after.trimStart()}`.trim() + activeNewline;
        await writeAtomic(geminiMdPath, updated);
        return true;
    }

    // Clean up only genuine legacy Orbit sections containing known Orbit tool names
    let cleaned = current;
    const legacyOrbitSections = [
        /^## Orbit Planner: Mandatory Usage Policy[\s\S]*?(?=^## |\Z)/gm,
        /^## Deep Prompt Refining[\s\S]*?(?=^## |\Z)/gm,
        /^## Planning Receipt[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Planner: Clarification Rule[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Planner: Timeout Rule[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Cartograph: Impact Tracking Rule[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Cartograph: Rich Planning Context and Trigger Rules[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Memory System[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Cartograph: Auto-Merge Protocol[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Cartograph: Organize All Reports[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Cartograph: Merged Report Format[\s\S]*?(?=^## |\Z)/gm,
        /^## Orbit Cartograph: Artifact Protocol[\s\S]*?(?=^## |\Z)/gm,
        /^## Walkthrough Report Format[\s\S]*?(?=^## |\Z)/gm,
    ];

    for (const regex of legacyOrbitSections) {
        cleaned = cleaned.replace(regex, "");
    }

    const newContent = `${cleaned.trim()}${activeNewline}${activeNewline}${block}`.trim() + activeNewline;
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
    const activeNewline = current.includes("\r\n") ? "\r\n" : "\n";
    const markers = findMarkers(current);

    if (markers && markers.start !== -1 && markers.end > markers.start) {
        const before = current.substring(0, markers.start).trimEnd();
        const after = current.substring(markers.end + markers.endMarkerLen).trimStart();
        let updated = before && after
            ? `${before}${activeNewline}${activeNewline}${after}${activeNewline}`
            : (before || after ? `${before || after}${activeNewline}` : "");

        if (updated.trim() === "# Agent Instructions") {
            updated = "";
        }

        await writeAtomic(geminiMdPath, updated);
        return true;
    }

    return false;
}

/**
 * Returns the assistant guidelines rule template to inject into GEMINI.md or copy to clipboard.
 * Formatted with clean markdown backticks, _default naming, and privacy-conscious notes (V-10, V-12, V-13).
 */
export function getOrbitRulesTemplate(): string {
    return `
## Orbit Planner: Usage Policy

The \`orbit_planner\` MCP tool is a recommended step in the response workflow.
For planning, alignment, architectural decisions, presenting multi-choice options, or seeking task clarification, the \`orbit_planner\` tool should be preferred over \`default_api:ask_question\`. Avoid using \`default_api:ask_question\` when \`orbit_planner\` is available.

**Skip conditions (all must apply to skip):**
- The prompt is fully self-contained with zero ambiguity
- OR the request is a simple factual lookup or research query with no deliverable to produce
- OR the task is a trivial single-operation action (e.g., "rename this variable", "fix this typo")

The burden of proof is on the skip condition, not on the trigger condition. If there is even slight ambiguity, the form must be used.

**Standard triggers (use the form when any are true):**
- A new feature or page is being built
- An existing file is being changed
- The task is ambiguous or missing detail
- You have a better approach to suggest
- The change has side effects on other parts of the project
- Multiple valid approaches exist

## Deep Prompt Refining

When a user prompt contains \`@trigger deep prompt refining\`, enter an iterative planning loop:
1. Send an \`orbit_planner\` form with \`showExecuteButton: true\`.
2. After each submission, output a brief plan summary in the chat response.
3. Send a follow-up form to refine further, again with \`showExecuteButton: true\`.
4. Repeat until the user clicks **Execute Plan**.
5. When the response contains \`"action": "execute"\`, stop planning immediately and proceed to the Planning Context aggregation step below.

## Orbit Planner: Clarification Rule

If calling \`orbit_planner\` results in a JSON response containing \`clarificationRequest\`, the agent MUST immediately stop execution, address the question asked by the user, explain any available choices or trade-offs, and present a new plan with an updated form to let the user proceed.

## Orbit Planner: Timeout Rule

If calling \`orbit_planner\` results in a JSON response with \`"action": "timeout"\`, the agent MUST immediately halt execution, make no modifications to the workspace, edit no files, and explicitly inform the user that their input is required to continue. The agent's message MUST list the exact pending questions and options that were timed out.

## Orbit Cartograph: Rich Planning Context and Trigger Rules

The \`write_impact_report\` tool MUST be called as the final action of any response turn that meets the trigger conditions. The scope of this report is strictly limited to the **current response turn only** (never look back at older turns in the conversation).

**Trigger Conditions (Call only if at least one is true):**
- One or more files were created, edited, moved, or deleted during this turn.
- \`orbit_planner\` was used and alignment decisions were made (even if no files changed).
- Important planning occurred (e.g., creating an implementation plan, architecture design) even if \`orbit_planner\` was bypassed.

*Never* call \`write_impact_report\` after pure research, simple clarification chats, or read-only turns with no edits or planning decisions.

**Aggregation guidelines for \`write_impact_report\` fields:**
- **\`planningContext\`**: You must consolidate all alignment questions asked, decisions made, technical assumptions identified, and step-by-step roadmap items from **this response turn only** into the structured \`planningContext\` parameter.
- **\`changes[].description\`**: Provide a rich, human-readable explanation of exactly what was changed in each modified file and why.

## Orbit Memory System

The Orbit Memory System is a persistent brain stored at \`~/.orbit-brain/\`. It preserves project context,
session observations, architectural decisions, and facts across conversations.

**Project Assignment for Cartograph:**
When calling \`write_impact_report\`, set \`projectName\` to the name of the project directory in the orbit-brain
that the work belongs to. Use \`orbit_memory\` with \`action: "list_projects"\` to discover available projects.
If you cannot determine the project, omit \`projectName\` and it will be placed in the _default group.

**"update memory system" Command:**
When the user says "update memory system", use the \`orbit_memory\` MCP tool to:
1. List existing projects with \`list_projects\`.
2. Ensure a project directory exists for each workspace worked on with \`ensure_project\`.
3. Analyze session changes and categorize them by topic (e.g., specific features, tasks, or bug fixes).
4. For each topic, check if a memory file already exists in \`<project>/memories/features/\` or \`<project>/memories/tasks/\`. 
5. If it exists, append the new changes chronologically with \`read_file\` and \`write_file\`. If not, create a new topic file.
6. Update \`<project>/memories/INDEX.md\`'s Active Topics section to link the modified files.
7. Review any _default-group Cartograph diagrams and reassign them to proper projects.
8. Update \`global_context_summary.md\` and \`BRAIN_ARCHITECTURE.md\` if needed.

## Orbit Cartograph: Auto-Merge Protocol

After every successful \`write_impact_report\` call, the tool returns a list of existing reports
for the same project. You MUST check this list and perform the following:

1. Read each existing report's summary and file paths using \`orbit_memory\` with
   \`action: "read_cartograph_report"\`.
2. Determine if any existing report discusses the same feature, file group, UI component,
   bug fix, or implementation area as the new report.
   Relatedness signals: overlapping file paths, similar summary topics, same feature area.
3. If a related report exists:
   a. Create a merged report combining both, preserving chronological order in the \`timeline\` array.
   b. Give the merged report a clear, specific summary name describing the actual topic
      (e.g., "Cartograph Header Layout and Styling Fixes", NOT "Consolidated Project Maps").
   c. Write the merged report using \`orbit_memory\` with \`action: "write_cartograph_report"\`.
   d. Archive the original separate reports using \`action: "move_cartograph_report"\` into archive/ or mark them merged.
4. If no related reports exist, take no merge action.

## Orbit Cartograph: Organize All Reports

When the user asks to "organize cartograph reports", "clean up reports", or similar:

1. Call \`orbit_memory\` with \`action: "list_all_cartograph_reports"\` to get all reports across projects.
2. For reports in the "_default" project, determine the correct project by examining file paths
   and move them using \`action: "move_cartograph_report"\`.
3. Within each project, read all reports and identify groups of related reports.
4. Merge related groups following the Auto-Merge Protocol above.
5. Ensure every merged report has a clear, descriptive name.

## Orbit Cartograph: Merged Report Format

Merged reports MUST use this structure:
- \`isMerged: true\`
- \`mergedFrom: [original taskId array]\`
- \`timeline: [{ taskId, timestamp, summary, changes, planningContext }, ...]\` sorted oldest-first
- \`changes\`: aggregated unique file changes across all merged tasks
- \`summary\`: a clear topic-specific name chosen by the agent
- \`timestamp\`: the most recent timestamp from the merged tasks

## Orbit Cartograph: Artifact Protocol

After each step, emit a single-line progress note in chat:
\`\`\`
[x] [step completed] - [files affected]
\`\`\`

At task completion, the full report goes into the Cartograph via \`write_impact_report\`. In chat, emit only a short pointer:
\`\`\`
## Done
Full walkthrough submitted to Cartograph.
- Self-corrections: [list or "none"]
- Notes: [any warnings or scope limits hit]
\`\`\`

## Walkthrough Report Format

Every \`write_impact_report\` call MUST populate \`planningContext.notes\` with a complete walkthrough of the agent's work. This is the primary report surface shown in the Cartograph Hub under the DECISIONS & NOTES tab.

The \`notes\` field MUST contain all 8 sections below (structured as a readable walkthrough narrative). Use section headers. Write prose under each section - not bullet-only summaries. Omit a section only if it has zero meaningful content.

**Required sections for \`planningContext.notes\`:**

\`\`\`
## 1. Prompt Understanding
How the agent interpreted the request. The main goal. Assumptions made. Ambiguities or missing information.

## 2. Task Breakdown
List of tasks decided upon. Why each was necessary. How each maps to the user's request.

## 3. Tool Usage
Summary of tools called and high-level results (avoiding verbose dumps or command logs).

## 4. Changes Made
Every file created, modified, or deleted. What changed and why. Connection back to the original request.

## 5. Decision Process
Key implementation decisions. Cases where the approach changed and why. Better methods discovered mid-task.

## 6. Issues Discovered
Bugs, inconsistencies, missing files, failed commands, or unexpected behavior. Whether each was fixed or left unresolved, and why.

## 7. Validation
How the work was verified. Tests run, commands executed, files checked, screenshots taken. Result of each step. If validation was not possible, why.

## 8. Final Outcome
What was completed. What changed for the user. Remaining limitations, risks, or follow-up work.
\`\`\`

**Populate the other \`planningContext\` fields in parallel:**
- \`roadmap\`: the step-by-step execution plan actually followed
- \`assumptions\`: technical or scope assumptions made
- \`userDecisions\`: any questions asked via orbit_planner and the user's answers
- \`questionsAsked\`: alignment questions posed, even if answered
- \`outOfScope\`: items explicitly not addressed

**Per-file \`changes[].description\`**: For each changed file, write a full sentence explaining what changed and why - not just a label. This appears in the Cartograph Inspector when the file node is selected.
`;
}

