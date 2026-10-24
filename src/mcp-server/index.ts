/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 César Vissouze (Venturi-exe / VNTR.CORP)
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
import { resolveInside, assertProjectKey, assertSafeFileName, isDenied, redactPath } from "../core/paths.js";
import { writeAtomic, writeJsonAtomic, readJsonSafe, ensureDirSafe } from "../core/fsx.js";
import { moveToTrash } from "../core/trash.js";

const server = new McpServer({
    name: "orbit",
    version: "0.2.7",
});

function getIpcDirs() {
    const ipcRoot = getIpcRoot();
    return {
        ipcRoot,
        requests: path.join(ipcRoot, IPC_DIRS.REQUESTS),
        responses: path.join(ipcRoot, IPC_DIRS.RESPONSES),
        impacts: path.join(ipcRoot, IPC_DIRS.IMPACTS),
    };
}

async function ensureIpcDirs(): Promise<void> {
    const dirs = getIpcDirs();
    await ensureDirSafe(dirs.requests);
    await ensureDirSafe(dirs.responses);
    await ensureDirSafe(dirs.impacts);
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

/**
 * Polls the responses directory asynchronously until a response file appears.
 * Returns the parsed response data. Cleans up both request and response files.
 */
async function pollForResponse(requestId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const dirs = getIpcDirs();
    const responseFile = path.join(dirs.responses, `${requestId}.json`);
    const requestFile = path.join(dirs.requests, `${requestId}.json`);
    const pollInterval = 500;
    const startTime = Date.now();

    while (Date.now() - startTime <= timeoutMs) {
        try {
            if (fs.existsSync(responseFile)) {
                const data = await readJsonSafe<Record<string, unknown>>(responseFile);
                try { await fs.promises.unlink(responseFile); } catch { /* ok */ }
                try { await fs.promises.unlink(requestFile); } catch { /* ok */ }
                return data;
            }
        } catch (err) {
            try { await fs.promises.unlink(responseFile); } catch { /* ok */ }
            try { await fs.promises.unlink(requestFile); } catch { /* ok */ }
            throw err;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    try { await fs.promises.unlink(requestFile); } catch { /* ok */ }
    throw new Error("Form timed out after 5 minutes without a response.");
}

server.tool(
    "orbit_planner",
    "Submit this form before writing or modifying any file OR generating complex text-only output (e.g., blog posts, documentation, structured plans) when: a new feature or page is being built, an existing file is being changed, the task is ambiguous or missing detail, you have a better approach to suggest, the change has side effects on other parts of the project, or multiple valid approaches exist. Do not call this tool if the task is fully specified, unambiguous, has no better alternative, and has no side effects on other files.",
    {
        title: z.string().describe("What decision needs alignment"),
        description: z.string().optional().describe("Why the agent is asking"),
        fields: z.array(fieldSchema).max(5).describe("Form fields, 5 maximum"),
        showExecuteButton: z.boolean().optional().default(false).describe("Show an 'Execute Plan' button. Use only during deep prompt refining loops."),
    },
    async ({ title, description, fields, showExecuteButton }) => {
        try {
            await ensureIpcDirs();
            const dirs = getIpcDirs();

            const requestId = generateRequestId();
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

            // Write request file atomically
            const requestFile = path.join(dirs.requests, `${requestId}.json`);
            await writeJsonAtomic(requestFile, request);

            // Poll for response (5 minute timeout)
            let response: Record<string, any>;
            try {
                response = await pollForResponse(requestId, 5 * 60 * 1000);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "timeout",
                                    dismissed: true,
                                    error: redactPath(message),
                                    message: "Alignment form timed out after 5 minutes of inactivity. Proceeding in safe mode.",
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            const action = response.action ?? "submit";

            if (action === "execute") {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "execute",
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
                                    dismissed: true,
                                    message: "Inactivity timeout occurred. Proceeding without this planning context.",
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            if (response.dismissed) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    action: "dismiss",
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
            const projCartDir = path.join(brainRoot, sanitizedProject, "cartograph");
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
                const entries = await fs.promises.readdir(brainRoot);
                const projects: string[] = [];
                for (const entry of entries) {
                    const fullPath = path.join(brainRoot, entry);
                    try {
                        const stats = await fs.promises.stat(fullPath);
                        if (stats.isDirectory() && fs.existsSync(path.join(fullPath, "memories"))) {
                            projects.push(entry);
                        }
                    } catch { /* skip */ }
                }
                return { content: [{ type: "text" as const, text: JSON.stringify(projects) }] };
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
                const projDir = path.join(brainRoot, sanitized);
                const memoriesDir = path.join(projDir, "memories");
                const sessionsDir = path.join(memoriesDir, "sessions");
                const conceptsDir = path.join(memoriesDir, "concepts");
                const factsDir = path.join(memoriesDir, "facts");
                const archiveDir = path.join(projDir, "archive");
                const cartographDir = path.join(projDir, "cartograph");

                await ensureDirSafe(sessionsDir);
                await ensureDirSafe(conceptsDir);
                await ensureDirSafe(factsDir);
                await ensureDirSafe(archiveDir);
                await ensureDirSafe(cartographDir);

                const protocolPath = path.join(memoriesDir, "PROTOCOL.md");
                if (!fs.existsSync(protocolPath)) {
                    const protocolContent = `# Orbit Memory Protocol (v1.0)

## 1. The Observation Format
Every major task or discovery MUST be recorded in an \`<observation>\` block.

\`\`\`xml
<observation>
  <meta>
    <title>[High-level Task Name]</title>
    <type>[feature | bugfix | research | refactor]</type>
    <project>${sanitized}</project>
    <timestamp>YYYY-MM-DD HH:MM</timestamp>
  </meta>

  <narrative>
    Brief description of what was done and key decisions.
  </narrative>

  <facts>
    - [Truths discovered during this task]
  </facts>

  <concepts>
    #tag1 #tag2
  </concepts>

  <files>
    <read>[file path]</read>
    <modified>[file path]</modified>
  </files>
</observation>
\`\`\`

## 2. Memory Lifecycle
1. **Capture**: Write the observation to \`memories/sessions/SESSION_[ID].md\`.
2. **Index**: Update \`memories/INDEX.md\` with new concepts and session links.
3. **Consolidate**: Move recurring facts into \`memories/facts/\`.
4. **Retrieve**: Before starting a task, search \`memories/\` for relevant context.

## 3. Storage Hierarchy
- \`sessions/\`: Timestamped observations from every task.
- \`concepts/\`: Deep dives into specific topics.
- \`facts/\`: Atomic, immutable truths about the project.
`;
                    await writeAtomic(protocolPath, protocolContent);
                }

                const indexPath = path.join(memoriesDir, "INDEX.md");
                if (!fs.existsSync(indexPath)) {
                    const indexContent = `# Memory Index

This index maps concepts and tags to specific memory files. Update this after every observation.

## Project Map
- **${sanitized}**: This project directory.

## Concepts and Tags
[Agent-populated during "update memory system"]

## Recent Sessions
[Agent-populated during "update memory system"]
`;
                    await writeAtomic(indexPath, indexContent);
                }

                const globalContextPath = path.join(brainRoot, "global_context_summary.md");
                if (fs.existsSync(globalContextPath)) {
                    let globalContent = await fs.promises.readFile(globalContextPath, "utf-8");
                    const entries = await fs.promises.readdir(brainRoot);
                    const validProjects: string[] = [];
                    for (const entry of entries) {
                        const fullPath = path.join(brainRoot, entry);
                        try {
                            const stats = await fs.promises.stat(fullPath);
                            if (stats.isDirectory() && fs.existsSync(path.join(fullPath, "memories"))) {
                                validProjects.push(entry);
                            }
                        } catch { /* skip */ }
                    }

                    const projectsList = validProjects.map((p) => `- **${p}**`).join("\n");
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
                const cartographDir = path.join(brainRoot, sanitized, "cartograph");
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
                const entries = await fs.promises.readdir(brainRoot);
                const allReports: Record<string, { filename: string; summary: string; taskId: string }[]> = {};

                for (const proj of entries) {
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
                            allReports[proj] = reports;
                        }
                    }
                }
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
                const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
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
                const cartographDir = path.join(brainRoot, sanitizedProj, "cartograph");
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
                const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
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

                const srcPath = path.join(brainRoot, sanitizedSrc, "cartograph", sanitizedFile);
                const tgtDir = path.join(brainRoot, sanitizedTgt, "cartograph");
                const tgtPath = path.join(tgtDir, sanitizedFile);

                if (!fs.existsSync(srcPath)) {
                    throw new Error(`Source report file not found: ${filename} in project ${sourceProject}`);
                }

                await ensureDirSafe(tgtDir);
                const raw = await fs.promises.readFile(srcPath, "utf-8");
                const parsed = JSON.parse(raw);
                if (typeof parsed === "object" && parsed !== null) {
                    parsed.projectName = targetProject;
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
                const trashed: string[] = [];

                for (const fn of filenames) {
                    const sanitizedFile = assertSafeFileName(fn);
                    const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
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
                const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
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
