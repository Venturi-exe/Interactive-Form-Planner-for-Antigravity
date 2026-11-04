/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 Venturi-exe / VNTRCORP
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getBrainRoot, getIpcRoot, IPC_DIRS } from "../core/constants.js";
import { resolveInside, assertProjectKey, assertSafeFileName, isDenied, redactPath, getProjectDir } from "../core/paths.js";
import { writeAtomic, writeJsonAtomic, readJsonSafe, ensureDirSafe } from "../core/fsx.js";
import { moveToTrash } from "../core/trash.js";
import {
    getIpcDirs as getPlannerIpcDirs,
    ensureAllIpcDirs,
    pollForResponseSlice,
    pruneExpiredIpcFiles,
} from "../core/plannerIpc.js";

declare const __ORBIT_VERSION__: string | undefined;

const server = new McpServer({
    name: "orbit",
    version: typeof __ORBIT_VERSION__ !== "undefined" ? __ORBIT_VERSION__ : "0.4.0",
});

function getIpcDirs() {
    return getPlannerIpcDirs(getIpcRoot());
}

async function ensureIpcDirs(): Promise<void> {
    await ensureAllIpcDirs(getIpcRoot());
}

// Background periodic pruning of expired IPC files (>30m TTL) every 5 minutes
const pruneInterval = setInterval(() => {
    pruneExpiredIpcFiles(getIpcRoot()).catch(() => {});
}, 5 * 60 * 1000);
if (typeof pruneInterval.unref === "function") {
    pruneInterval.unref();
}

const fieldSchema = z.object({
    id: z.string().describe("Unique identifier for this field"),
    label: z.string().describe("Label displayed to the user"),
    type: z
        .enum(["single-choice", "multi-choice", "free-text"])
        .describe("single-choice: radio group. multi-choice: checkbox group. free-text: text input."),
    options: z
        .array(z.string())
        .optional()
        .describe("Options for single-choice and multi-choice fields. The webview auto-appends an 'Other' option."),
    required: z.boolean().optional().default(false).describe("Whether the field must be answered"),
    placeholder: z.string().optional().describe("Placeholder text for free-text fields"),
});

function generateRequestId(): string {
    return `align_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

server.tool(
    "orbit_planner",
    "Submit this form before writing or modifying any file OR generating complex text-only output (e.g., blog posts, documentation, structured plans) when: a new feature or page is being built, an existing file is being changed, the task is ambiguous or missing detail, you have a better approach to suggest, the change has side effects on other parts of the project, or multiple valid approaches exist. If a previous call returned action: 'pending', provide resumeRequestId to continue waiting without creating a new form.",
    {
        resumeRequestId: z
            .string()
            .optional()
            .describe("Request ID of an active planner form to resume polling after a pending slice."),
        title: z.string().optional().describe("What decision needs alignment (required for new requests)"),
        description: z.string().optional().describe("Why the agent is asking"),
        fields: z.array(fieldSchema).max(5).optional().describe("Form fields, 5 maximum (required for new requests)"),
        showExecuteButton: z.boolean().optional().default(false).describe("Show an 'Execute Plan' button. Use only during deep prompt refining loops."),
    },
    async ({ resumeRequestId, title, description, fields, showExecuteButton }, extra) => {
        try {
            await ensureIpcDirs();
            const dirs = getIpcDirs();
            const ipcRoot = getIpcRoot();

            // Background prune of expired IPC files (>30m TTL)
            pruneExpiredIpcFiles(ipcRoot).catch(() => {});

            let requestId: string;

            if (resumeRequestId) {
                assertSafeFileName(resumeRequestId);
                requestId = resumeRequestId;

                // Verify the request exists in claimed, responses, or requests
                const requestFile = path.join(dirs.requests, `${requestId}.json`);
                const claimedFile = path.join(dirs.claimed, `${requestId}.json`);
                const responseFile = path.join(dirs.responses, `${requestId}.json`);

                if (!fs.existsSync(requestFile) && !fs.existsSync(claimedFile) && !fs.existsSync(responseFile)) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify(
                                    {
                                        action: "timeout",
                                        requestId,
                                        dismissed: true,
                                        message: `Planner session ${requestId} was not found or has expired. Please submit a new planner request.`,
                                    },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }
            } else {
                if (!title || !fields) {
                    throw new Error("Parameters 'title' and 'fields' are required when creating a new planner form.");
                }
                requestId = generateRequestId();
                const finalFields = [...fields];
                if (!finalFields.some((f) => f.id === "anything_else")) {
                    finalFields.push({
                        id: "anything_else",
                        label: "Anything else to consider?",
                        type: "free-text",
                        required: false,
                        placeholder: "Type any other details, requirements, or constraints here...",
                    });
                }

                const request = {
                    requestId,
                    title,
                    description: description ?? "",
                    fields: finalFields,
                    showExecuteButton: showExecuteButton ?? false,
                };

                const requestFile = path.join(dirs.requests, `${requestId}.json`);
                await writeJsonAtomic(requestFile, request);
            }

            // Bounded poll slice (40s default) with host cancellation signal forwarded
            const outcome = await pollForResponseSlice({
                ipcRoot,
                requestId,
                origin: "antigravity",
                signal: extra?.signal,
            });

            if (outcome.outcome === "pending") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "pending",
                                    requestId: outcome.requestId,
                                    resumeRequestId: outcome.requestId,
                                    userActive: outcome.userActive,
                                    remainingInactivitySec: outcome.remainingInactivitySec,
                                    message: "Form is active and awaiting user input. Call orbit_planner with resumeRequestId to continue waiting.",
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (outcome.outcome === "unclaimed_timeout") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "timeout",
                                    requestId,
                                    dismissed: true,
                                    message: outcome.message,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (outcome.outcome === "inactivity_timeout") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "timeout",
                                    requestId,
                                    dismissed: true,
                                    message: outcome.message,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (outcome.outcome === "cancelled") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "timeout",
                                    requestId,
                                    dismissed: true,
                                    message: outcome.message || "Planning was cancelled.",
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (outcome.outcome === "failed") {
                throw new Error(outcome.error);
            }

            // outcome.outcome === "response"
            const response = outcome.response;
            const action = response.action ?? "submit";

            if (action === "execute") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "execute",
                                    requestId,
                                    message: "User clicked Execute Plan. Stop planning. Generate a post planning analysis, then begin implementation.",
                                    data: response.data ?? response,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (action === "clarification") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "clarification",
                                    requestId,
                                    message: "User requested clarification on the planning questions. Halt planning or coding activities and directly address the user's questions in chat.",
                                    question: response.clarificationRequest || "",
                                    specificClarifications: response.specificClarifications || [],
                                    partialAnswers: response.partialAnswers || {},
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (action === "timeout") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "timeout",
                                    requestId,
                                    dismissed: true,
                                    message: response.message || "Inactivity timeout occurred. Proceeding without this planning context.",
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (response.dismissed || action === "dismiss") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "dismiss",
                                    requestId,
                                    dismissed: true,
                                    message: "User chose to skip. Proceed with the original prompt and existing context only. Do not apply assumptions from unanswered fields.",
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                action: "submit",
                                requestId,
                                data: response.data ?? response,
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                isError: true,
                content: [
                    {
                        type: "text" as const,
                        text: `Error in orbit_planner: ${redactPath(message)}`,
                    },
                ],
            };
        }
    }
);

server.tool(
    "write_impact_report",
    "Submit a structured report describing all files changed (created, edited, moved, or deleted) OR any important planning decisions/roadmaps aligned on during the current response turn. This is the final action of a completed turn and must be called if files were changed, orbit_planner was used, or important manual planning occurred. Scope is strictly limited to the current response turn.",
    {
        taskId: z.string().describe("Unique task/session identifier"),
        timestamp: z.string().describe("ISO 8601 timestamp of when the task completed"),
        summary: z.string().describe("Short one-line summary of what was accomplished"),
        changes: z.array(
            z.object({
                filePath: z.string().describe("Path of the modified file relative to the workspace root"),
                changeType: z.enum(["edited", "moved", "deleted", "created"]).describe("Type of modification made to the file"),
                promptExcerpt: z.string().optional().describe("Portion of user prompt authorizing this change, or 'Agent-initiated'"),
                alignmentToolOutput: z.record(z.any()).nullable().optional().describe("The alignment form output collected during the task, or null"),
                description: z.string().optional().describe("Rich human-readable description of what was changed and why in this file"),
            })
        ).describe("List of all file changes made during the task"),
        sessionId: z.string().optional().describe("Optional identifier to group related tasks/session"),
        projectName: z.string().optional().describe("Name of the project this report belongs to, matching a directory in the orbit-brain. If unknown, omit and it will be placed in Default."),
        planningContext: z.object({
            questionsAsked: z.array(z.string()).optional().describe("List of alignment questions asked during this turn"),
            userDecisions: z.array(
                z.object({
                    question: z.string().describe("Alignment question asked"),
                    answer: z.string().describe("User's selected option or write-in answer"),
                })
            ).optional().describe("List of user decisions and choices made"),
            assumptions: z.array(z.string()).optional().describe("Technical or scope assumptions identified by the agent"),
            roadmap: z.array(z.string()).optional().describe("Step-by-step execution roadmap completed during this turn"),
            outOfScope: z.array(z.string()).optional().describe("Items explicitly marked out of scope"),
            notes: z.string().optional().describe("Additional planning context or comments"),
        }).optional().describe("Structured planning context gathered from the agent's work during this response turn"),
    },
    async ({ taskId, timestamp, summary, changes, sessionId, projectName, planningContext }) => {
        try {
            await ensureIpcDirs();
            const dirs = getIpcDirs();

            const resolvedSessionId = sessionId || path.basename(process.cwd()) || "default_session";
            const report = {
                taskId,
                timestamp,
                summary,
                changes,
                sessionId: resolvedSessionId,
                projectName,
                planningContext,
            };

            const reportId = crypto.randomUUID();
            const fileId = `report_${reportId}`;
            const filePath = path.join(dirs.impacts, `${fileId}.json`);

            // Write impact report atomically
            await writeJsonAtomic(filePath, report);

            const sanitizedProject = assertProjectKey(projectName || "_default");
            const brainRoot = getBrainRoot();
            const projDir = getProjectDir(brainRoot, sanitizedProject);
            const projCartDir = path.join(projDir, "cartograph");
            const existingReports: { filename: string; summary: string; taskId: string }[] = [];

            if (fs.existsSync(projCartDir)) {
                const files = (await fs.promises.readdir(projCartDir)).filter((f) => f.endsWith(".json"));
                for (const file of files) {
                    try {
                        const parsed = await readJsonSafe<{ summary?: string; taskId?: string }>(path.join(projCartDir, file));
                        existingReports.push({
                            filename: file,
                            summary: parsed.summary || "",
                            taskId: parsed.taskId || "",
                        });
                    } catch { /* skip corrupt or unreadable files */ }
                }
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                success: true,
                                message: `Impact report successfully written to ${redactPath(filePath)}`,
                                projectReports: existingReports,
                                mergeHint: existingReports.length > 0
                                    ? `${existingReports.length} existing report(s) found for project "${projectName || "Default"}". Review summaries for potential merges.`
                                    : "No existing reports for this project.",
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                isError: true,
                content: [
                    {
                        type: "text" as const,
                        text: `Error in write_impact_report: ${redactPath(message)}`,
                    },
                ],
            };
        }
    }
);

server.tool(
    "orbit_memory",
    "Read or write to the Orbit Memory System. Use to discover registered projects, read project context, write session observations, update project indexes, or manage Cartograph reports.",
    {
        action: z.enum([
            "list_projects",
            "read_file",
            "write_file",
            "ensure_project",
            "list_cartograph_reports",
            "list_all_cartograph_reports",
            "read_cartograph_report",
            "write_cartograph_report",
            "delete_cartograph_report",
            "move_cartograph_report",
            "bulk_delete_cartograph_reports",
            "update_cartograph_report",
        ]).describe("Action to perform on the memory system"),
        projectName: z.string().optional().describe("Name of the project. Required for ensure_project, list_cartograph_reports, read_cartograph_report, write_cartograph_report, and delete_cartograph_report actions."),
        filePath: z.string().optional().describe("Relative path within the brain or project directory. Required for read_file and write_file actions."),
        content: z.string().optional().describe("File content for write_file and write_cartograph_report actions."),
        filename: z.string().optional().describe("The filename of the cartograph report. Required for read_cartograph_report, write_cartograph_report, delete_cartograph_report, and move_cartograph_report actions."),
        sourceProject: z.string().optional().describe("The source project name. Required for move_cartograph_report action."),
        targetProject: z.string().optional().describe("The target project name. Required for move_cartograph_report action."),
        filenames: z.array(z.string()).optional().describe("Filenames for bulk operations."),
        updates: z.record(z.any()).optional().describe("Partial updates for update operations."),
    },
    async ({ action, projectName, filePath, content, filename, sourceProject, targetProject, filenames, updates }) => {
        try {
            const brainRoot = getBrainRoot();

            if (action === "list_projects") {
                if (!fs.existsSync(brainRoot)) {
                    return { content: [{ type: "text" as const, text: JSON.stringify([]) }] };
                }
                const projects = new Set<string>();

                // 1. Scan Layout v3 projects/ directory
                const v3ProjectsDir = path.join(brainRoot, "projects");
                if (fs.existsSync(v3ProjectsDir)) {
                    try {
                        const entries = await fs.promises.readdir(v3ProjectsDir);
                        for (const entry of entries) {
                            const fullPath = path.join(v3ProjectsDir, entry);
                            try {
                                const stats = await fs.promises.stat(fullPath);
                                if (stats.isDirectory()) {
                                    projects.add(entry.toLowerCase());
                                }
                            } catch { /* skip */ }
                        }
                    } catch { /* skip */ }
                }

                // 2. Scan top-level for backwards compatibility
                try {
                    const entries = await fs.promises.readdir(brainRoot);
                    for (const entry of entries) {
                        if (entry === "projects" || entry.startsWith(".")) continue;
                        const fullPath = path.join(brainRoot, entry);
                        try {
                            const stats = await fs.promises.stat(fullPath);
                            if (stats.isDirectory() && fs.existsSync(path.join(fullPath, "memories"))) {
                                projects.add(entry.toLowerCase());
                            }
                        } catch { /* skip */ }
                    }
                } catch { /* skip */ }

                return { content: [{ type: "text" as const, text: JSON.stringify(Array.from(projects).sort()) }] };
            }

            if (action === "read_file") {
                if (!filePath) {
                    throw new Error("filePath is required for read_file action");
                }
                const fullPath = resolveInside(brainRoot, filePath);
                if (!fs.existsSync(fullPath)) {
                    throw new Error(`File not found: ${filePath}`);
                }
                const fileContent = await fs.promises.readFile(fullPath, "utf-8");
                return { content: [{ type: "text" as const, text: fileContent }] };
            }

            if (action === "write_file") {
                if (!filePath) {
                    throw new Error("filePath is required for write_file action");
                }
                if (content === undefined) {
                    throw new Error("content is required for write_file action");
                }
                if (isDenied(filePath)) {
                    throw new Error(`Write access denied for administrative or protected path: ${filePath}`);
                }
                const fullPath = resolveInside(brainRoot, filePath);
                await writeAtomic(fullPath, content);
                return { content: [{ type: "text" as const, text: `Successfully wrote file to ${redactPath(filePath)}` }] };
            }

            if (action === "ensure_project") {
                if (!projectName) {
                    throw new Error("projectName is required for ensure_project action");
                }
                const sanitized = assertProjectKey(projectName);
                const projDir = resolveInside(brainRoot, path.join("projects", sanitized));
                const cartographDir = path.join(projDir, "cartograph");
                const memoriesDir = path.join(projDir, "memories");
                const sessionsDir = path.join(memoriesDir, "sessions");
                const featuresDir = path.join(memoriesDir, "features");
                const tasksDir = path.join(memoriesDir, "tasks");
                const archiveDir = path.join(projDir, "archive");

                await ensureDirSafe(cartographDir);
                await ensureDirSafe(sessionsDir);
                await ensureDirSafe(featuresDir);
                await ensureDirSafe(tasksDir);
                await ensureDirSafe(archiveDir);

                const protocolPath = path.join(memoriesDir, "PROTOCOL.md");
                if (!fs.existsSync(protocolPath)) {
                    const protocolContent = `# Topic-Based Memory Protocol (v3.0)

This project organizes memories by specific topics (features, components, tasks, or bug fixes) rather than by conversation session.

## 1. The Topic Format
Every topic should have its own dedicated markdown file in \`memories/features/\` or \`memories/tasks/\`.
Append new updates to existing topic files using a chronological timeline format.

Example Timeline Entry:
\`\`\`markdown
### [YYYY-MM-DD HH:MM] [Summary of Changes]
- **What was changed**: Specific summary of files edited and code modifications.
- **Why the changes were made**: Rationale and user intent.
- **Project state**: Context or version at the time.
- **Relation to prior changes**: How these changes relate to previous work.
\`\`\`

## 2. Memory Lifecycle
1. **Capture**: Consolidate session work into topic files in \`memories/features/\` (for long-lived capabilities) or \`memories/tasks/\` (for specific fixes/issues).
2. **Append**: If a file for the topic exists, append the new changes chronologically; do not create duplicate files.
3. **Index**: Update \`memories/INDEX.md\`'s Active Topics section to link the modified files.

## 3. Storage Hierarchy
- \`features/\`: Topic files for features, components, UI layouts, and styling.
- \`tasks/\`: Topic files for specific tasks, issues, and bug fixes.
- \`sessions/\`: Working session logs and context records.
`;
                    await writeAtomic(protocolPath, protocolContent);
                }

                const indexPath = path.join(memoriesDir, "INDEX.md");
                if (!fs.existsSync(indexPath)) {
                    const indexContent = `# Memory Index

This index maps active topics and tags to their respective memory files. Update this when creating or appending to a topic file.

## Project Map
- **${sanitized}**: This project directory.

## Concepts and Tags
[Agent-populated during "update memory system"]

## Active Topics
### Features & Components
[Agent-populated during "update memory system"]

### Tasks & Bug Fixes
[Agent-populated during "update memory system"]
`;
                    await writeAtomic(indexPath, indexContent);
                }

                const globalContextPath = path.join(brainRoot, "global_context_summary.md");
                if (fs.existsSync(globalContextPath)) {
                    let globalContent = await fs.promises.readFile(globalContextPath, "utf-8");
                    const validProjects = new Set<string>();

                    const v3Dir = path.join(brainRoot, "projects");
                    if (fs.existsSync(v3Dir)) {
                        try {
                            const pEntries = await fs.promises.readdir(v3Dir);
                            for (const e of pEntries) {
                                try {
                                    if ((await fs.promises.stat(path.join(v3Dir, e))).isDirectory()) {
                                        validProjects.add(e.toLowerCase());
                                    }
                                } catch { /* skip */ }
                            }
                        } catch { /* skip */ }
                    }

                    try {
                        const rEntries = await fs.promises.readdir(brainRoot);
                        for (const e of rEntries) {
                            if (e === "projects" || e.startsWith(".")) continue;
                            try {
                                const fullPath = path.join(brainRoot, e);
                                if ((await fs.promises.stat(fullPath)).isDirectory() && fs.existsSync(path.join(fullPath, "memories"))) {
                                    validProjects.add(e.toLowerCase());
                                }
                            } catch { /* skip */ }
                        }
                    } catch { /* skip */ }

                    const projectsList = Array.from(validProjects).sort().map((p) => `- **${p}**`).join("\n");
                    const regex = /(## Registered Projects\s*)([\s\S]*?)(?=\n\n##|$)/;
                    if (regex.test(globalContent)) {
                        globalContent = globalContent.replace(regex, `$1\n${projectsList}\n`);
                    } else {
                        globalContent += `\n\n## Registered Projects\n${projectsList}\n`;
                    }
                    await writeAtomic(globalContextPath, globalContent);
                }

                return { content: [{ type: "text" as const, text: `Project ${sanitized} ensured and memory scaffold created.` }] };
            }

            if (action === "list_cartograph_reports") {
                if (!projectName) {
                    throw new Error("projectName is required for list_cartograph_reports action");
                }
                const sanitized = assertProjectKey(projectName);
                const projDir = getProjectDir(brainRoot, sanitized);
                const cartographDir = path.join(projDir, "cartograph");
                if (!fs.existsSync(cartographDir)) {
                    return { content: [{ type: "text" as const, text: JSON.stringify([]) }] };
                }
                const files = (await fs.promises.readdir(cartographDir)).filter((file) => file.endsWith(".json"));
                const reports: { filename: string; summary: string; taskId: string }[] = [];
                for (const file of files) {
                    try {
                        const parsed = await readJsonSafe<{ summary?: string; taskId?: string }>(path.join(cartographDir, file));
                        reports.push({
                            filename: file,
                            summary: parsed.summary || "",
                            taskId: parsed.taskId || "",
                        });
                    } catch { /* skip corrupt */ }
                }
                return { content: [{ type: "text" as const, text: JSON.stringify(reports, null, 2) }] };
            }

            if (action === "list_all_cartograph_reports") {
                if (!fs.existsSync(brainRoot)) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({}) }] };
                }
                const allReports: Record<string, { filename: string; summary: string; taskId: string }[]> = {};

                // 1. Scan Layout v3 projects/ directory
                const v3Dir = path.join(brainRoot, "projects");
                if (fs.existsSync(v3Dir)) {
                    try {
                        const pEntries = await fs.promises.readdir(v3Dir);
                        for (const proj of pEntries) {
                            const cartographDir = path.join(v3Dir, proj, "cartograph");
                            if (fs.existsSync(cartographDir)) {
                                const files = (await fs.promises.readdir(cartographDir)).filter((file) => file.endsWith(".json"));
                                const reports: { filename: string; summary: string; taskId: string }[] = [];
                                for (const file of files) {
                                    try {
                                        const parsed = await readJsonSafe<{ summary?: string; taskId?: string }>(path.join(cartographDir, file));
                                        reports.push({
                                            filename: file,
                                            summary: parsed.summary || "",
                                            taskId: parsed.taskId || "",
                                        });
                                    } catch { /* skip corrupt */ }
                                }
                                if (reports.length > 0) {
                                    allReports[proj.toLowerCase()] = reports;
                                }
                            }
                        }
                    } catch { /* skip */ }
                }

                // 2. Scan legacy root for projects not already found in projects/
                try {
                    const entries = await fs.promises.readdir(brainRoot);
                    for (const proj of entries) {
                        if (proj === "projects" || proj.startsWith(".")) continue;
                        const projKey = proj.toLowerCase();
                        if (allReports[projKey]) continue; // prefer v3
                        const cartographDir = path.join(brainRoot, proj, "cartograph");
                        if (fs.existsSync(cartographDir)) {
                            const files = (await fs.promises.readdir(cartographDir)).filter((file) => file.endsWith(".json"));
                            const reports: { filename: string; summary: string; taskId: string }[] = [];
                            for (const file of files) {
                                try {
                                    const parsed = await readJsonSafe<{ summary?: string; taskId?: string }>(path.join(cartographDir, file));
                                    reports.push({
                                        filename: file,
                                        summary: parsed.summary || "",
                                        taskId: parsed.taskId || "",
                                    });
                                } catch { /* skip corrupt */ }
                            }
                            if (reports.length > 0) {
                                allReports[projKey] = reports;
                            }
                        }
                    }
                } catch { /* skip */ }

                return { content: [{ type: "text" as const, text: JSON.stringify(allReports, null, 2) }] };
            }

            if (action === "read_cartograph_report") {
                if (!projectName) {
                    throw new Error("projectName is required for read_cartograph_report action");
                }
                if (!filename) {
                    throw new Error("filename is required for read_cartograph_report action");
                }
                const sanitizedProj = assertProjectKey(projectName);
                const sanitizedFile = assertSafeFileName(filename);
                const projDir = getProjectDir(brainRoot, sanitizedProj);
                const fullPath = path.join(projDir, "cartograph", sanitizedFile);
                if (!fs.existsSync(fullPath)) {
                    throw new Error(`Report file not found: ${filename} in project ${projectName}`);
                }
                const fileContent = await fs.promises.readFile(fullPath, "utf-8");
                return { content: [{ type: "text" as const, text: fileContent }] };
            }

            if (action === "write_cartograph_report") {
                if (!projectName) {
                    throw new Error("projectName is required for write_cartograph_report action");
                }
                if (!filename) {
                    throw new Error("filename is required for write_cartograph_report action");
                }
                if (content === undefined) {
                    throw new Error("content is required for write_cartograph_report action");
                }
                const sanitizedProj = assertProjectKey(projectName);
                const sanitizedFile = assertSafeFileName(filename);
                const projDir = resolveInside(brainRoot, path.join("projects", sanitizedProj));
                const cartographDir = path.join(projDir, "cartograph");
                await ensureDirSafe(cartographDir);

                const fullPath = path.join(cartographDir, sanitizedFile);
                await writeAtomic(fullPath, content);
                return { content: [{ type: "text" as const, text: `Successfully wrote cartograph report to ${filename} under project ${projectName}` }] };
            }

            if (action === "delete_cartograph_report") {
                if (!projectName) {
                    throw new Error("projectName is required for delete_cartograph_report action");
                }
                if (!filename) {
                    throw new Error("filename is required for delete_cartograph_report action");
                }
                const sanitizedProj = assertProjectKey(projectName);
                const sanitizedFile = assertSafeFileName(filename);
                const projDir = getProjectDir(brainRoot, sanitizedProj);
                const fullPath = path.join(projDir, "cartograph", sanitizedFile);
                if (!fs.existsSync(fullPath)) {
                    throw new Error(`Report file not found for deletion: ${filename} in project ${projectName}`);
                }
                await moveToTrash(fullPath, brainRoot);
                return { content: [{ type: "text" as const, text: `Successfully moved cartograph report ${filename} to trash under project ${projectName}` }] };
            }

            if (action === "move_cartograph_report") {
                if (!sourceProject) {
                    throw new Error("sourceProject is required for move_cartograph_report action");
                }
                if (!targetProject) {
                    throw new Error("targetProject is required for move_cartograph_report action");
                }
                if (!filename) {
                    throw new Error("filename is required for move_cartograph_report action");
                }
                const sanitizedSrc = assertProjectKey(sourceProject);
                const sanitizedTgt = assertProjectKey(targetProject);
                const sanitizedFile = assertSafeFileName(filename);

                const srcProjDir = getProjectDir(brainRoot, sanitizedSrc);
                const srcPath = path.join(srcProjDir, "cartograph", sanitizedFile);
                const tgtProjDir = resolveInside(brainRoot, path.join("projects", sanitizedTgt));
                const tgtDir = path.join(tgtProjDir, "cartograph");
                const tgtPath = path.join(tgtDir, sanitizedFile);

                if (!fs.existsSync(srcPath)) {
                    throw new Error(`Source report file not found: ${filename} in project ${sourceProject}`);
                }

                await ensureDirSafe(tgtDir);
                const raw = await fs.promises.readFile(srcPath, "utf-8");
                const parsed = JSON.parse(raw);
                if (typeof parsed === "object" && parsed !== null) {
                    parsed.projectName = sanitizedTgt;
                }

                await writeJsonAtomic(tgtPath, parsed);
                await moveToTrash(srcPath, brainRoot);

                return { content: [{ type: "text" as const, text: `Successfully moved cartograph report ${filename} from project ${sourceProject} to project ${targetProject}` }] };
            }

            if (action === "bulk_delete_cartograph_reports") {
                if (!projectName) {
                    throw new Error("projectName is required for bulk_delete_cartograph_reports action");
                }
                if (!filenames || filenames.length === 0) {
                    throw new Error("filenames is required for bulk_delete_cartograph_reports action");
                }
                const sanitizedProj = assertProjectKey(projectName);
                const projDir = getProjectDir(brainRoot, sanitizedProj);
                const trashed: string[] = [];

                for (const fn of filenames) {
                    const sanitizedFile = assertSafeFileName(fn);
                    const fullPath = path.join(projDir, "cartograph", sanitizedFile);
                    if (fs.existsSync(fullPath)) {
                        await moveToTrash(fullPath, brainRoot);
                        trashed.push(fn);
                    }
                }
                return { content: [{ type: "text" as const, text: `Successfully moved ${trashed.length} cartograph reports to trash under project ${projectName}` }] };
            }

            if (action === "update_cartograph_report") {
                if (!projectName) {
                    throw new Error("projectName is required for update_cartograph_report action");
                }
                if (!filename) {
                    throw new Error("filename is required for update_cartograph_report action");
                }
                if (!updates) {
                    throw new Error("updates is required for update_cartograph_report action");
                }
                const sanitizedProj = assertProjectKey(projectName);
                const sanitizedFile = assertSafeFileName(filename);
                const projDir = getProjectDir(brainRoot, sanitizedProj);
                const fullPath = path.join(projDir, "cartograph", sanitizedFile);
                if (!fs.existsSync(fullPath)) {
                    throw new Error(`Report file not found for update: ${filename} in project ${projectName}`);
                }

                const report = await readJsonSafe<Record<string, unknown>>(fullPath);
                const merged = { ...report, ...updates };
                await writeJsonAtomic(fullPath, merged);
                return { content: [{ type: "text" as const, text: `Successfully updated cartograph report ${filename} under project ${projectName}` }] };
            }

            throw new Error(`Unknown action: ${action}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                isError: true,
                content: [
                    {
                        type: "text" as const,
                        text: `Error in orbit_memory: ${redactPath(message)}`,
                    },
                ],
            };
        }
    }
);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    process.stderr.write(`Alignment MCP server error: ${error}\n`);
    process.exit(1);
});
