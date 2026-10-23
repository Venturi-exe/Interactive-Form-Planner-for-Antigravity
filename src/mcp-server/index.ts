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
import * as os from "os";

const IPC_DIR = path.join(os.homedir(), ".antigravity-forms");
const REQUESTS_DIR = path.join(IPC_DIR, "requests");
const RESPONSES_DIR = path.join(IPC_DIR, "responses");
const IMPACTS_DIR = path.join(IPC_DIR, "impacts");

// Ensure IPC directories exist
fs.mkdirSync(REQUESTS_DIR, { recursive: true });
fs.mkdirSync(RESPONSES_DIR, { recursive: true });
fs.mkdirSync(IMPACTS_DIR, { recursive: true });

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

const server = new McpServer({
    name: "orbit",
    version: "0.2.0",
});

function generateRequestId(): string {
    return `align_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Polls the responses directory until a response file appears for the given request.
 * Returns the parsed response data. Cleans up both request and response files.
 */
function pollForResponse(requestId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const responseFile = path.join(RESPONSES_DIR, `${requestId}.json`);
    const requestFile = path.join(REQUESTS_DIR, `${requestId}.json`);
    const pollInterval = 500;

    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = (): void => {
            if (Date.now() - startTime > timeoutMs) {
                // Clean up stale request file on timeout
                try { fs.unlinkSync(requestFile); } catch { /* already gone */ }
                reject(new Error("Form timed out after 5 minutes without a response."));
                return;
            }

            if (fs.existsSync(responseFile)) {
                try {
                    const raw = fs.readFileSync(responseFile, "utf-8");
                    const data = JSON.parse(raw) as Record<string, unknown>;
                    // Clean up IPC files
                    try { fs.unlinkSync(responseFile); } catch { /* ok */ }
                    try { fs.unlinkSync(requestFile); } catch { /* ok */ }
                    resolve(data);
                } catch (err) {
                    reject(err);
                }
                return;
            }

            setTimeout(check, pollInterval);
        };

        check();
    });
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

        // Write request file for the extension to pick up
        const requestFile = path.join(REQUESTS_DIR, `${requestId}.json`);
        fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));

        // Poll for response (5 minute timeout)
        let response: any;
        try {
            response = await pollForResponse(requestId, 5 * 60 * 1000);
        } catch (err: any) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                action: "timeout",
                                dismissed: true,
                                error: err.message || String(err),
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
                promptExcerpt: z.string().describe("Portion of user prompt authorizing this change, or 'Agent-initiated'"),
                alignmentToolOutput: z.record(z.any()).nullable().describe("The alignment form output collected during the task, or null"),
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

        const fileId = `report_${taskId}_${Date.now()}`;
        const filePath = path.join(IMPACTS_DIR, `${fileId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

        const sanitizedProject = (projectName || "Default").replace(/[^a-zA-Z0-9\-_]/g, "_");
        const brainRoot = path.join(os.homedir(), ".orbit-brain");
        const projCartDir = path.join(brainRoot, sanitizedProject, "cartograph");
        let existingReports: { filename: string; summary: string; taskId: string }[] = [];
        if (fs.existsSync(projCartDir)) {
            const files = fs.readdirSync(projCartDir).filter(f => f.endsWith(".json"));
            for (const file of files) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(path.join(projCartDir, file), "utf-8"));
                    existingReports.push({ filename: file, summary: parsed.summary, taskId: parsed.taskId });
                } catch { /* skip corrupt files */ }
            }
        }

        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            success: true,
                            message: `Impact report successfully written to ${filePath}`,
                            projectReports: existingReports,
                            mergeHint: existingReports.length > 0
                                ? `${existingReports.length} existing report(s) found for project "${projectName || "Default"}". Review summaries for potential merges.`
                                : "No existing reports for this project."
                        },
                        null,
                        2
                    ),
                },
            ],
        };
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
            "update_cartograph_report"
        ]).describe("Action to perform on the memory system"),
        projectName: z.string().optional().describe("Name of the project. Required for ensure_project, list_cartograph_reports, read_cartograph_report, write_cartograph_report, and delete_cartograph_report actions."),
        filePath: z.string().optional().describe("Relative path within the brain or project directory. Required for read_file and write_file actions."),
        content: z.string().optional().describe("File content for write_file and write_cartograph_report actions."),
        filename: z.string().optional().describe("The filename of the cartograph report. Required for read_cartograph_report, write_cartograph_report, delete_cartograph_report, and move_cartograph_report actions."),
        sourceProject: z.string().optional().describe("The source project name. Required for move_cartograph_report action."),
        targetProject: z.string().optional().describe("The target project name. Required for move_cartograph_report action."),
        filenames: z.array(z.string()).optional().describe("Filenames for bulk operations."),
        updates: z.record(z.any()).optional().describe("Partial updates for update operations.")
    },
    async ({ action, projectName, filePath, content, filename, sourceProject, targetProject, filenames, updates }) => {
        const brainRoot = path.join(os.homedir(), ".orbit-brain");

        if (action === "list_projects") {
            if (!fs.existsSync(brainRoot)) {
                return { content: [{ type: "text" as const, text: JSON.stringify([]) }] };
            }
            try {
                const projects = fs.readdirSync(brainRoot).filter(file => {
                    const fullPath = path.join(brainRoot, file);
                    if (!fs.statSync(fullPath).isDirectory()) return false;
                    return fs.existsSync(path.join(fullPath, "memories"));
                });
                return { content: [{ type: "text" as const, text: JSON.stringify(projects) }] };
            } catch (e: any) {
                throw new Error(`Failed to list projects: ${e.message}`);
            }
        }

        if (action === "read_file") {
            if (!filePath) {
                throw new Error("filePath is required for read_file action");
            }
            const fullPath = path.resolve(brainRoot, filePath);
            if (!fullPath.startsWith(brainRoot)) {
                throw new Error("Path traversal detected or access outside brain root is denied");
            }
            if (!fs.existsSync(fullPath)) {
                throw new Error(`File not found: ${filePath}`);
            }
            try {
                const fileContent = fs.readFileSync(fullPath, "utf-8");
                return { content: [{ type: "text" as const, text: fileContent }] };
            } catch (e: any) {
                throw new Error(`Failed to read file: ${e.message}`);
            }
        }

        if (action === "write_file") {
            if (!filePath) {
                throw new Error("filePath is required for write_file action");
            }
            if (content === undefined) {
                throw new Error("content is required for write_file action");
            }
            const fullPath = path.resolve(brainRoot, filePath);
            if (!fullPath.startsWith(brainRoot)) {
                throw new Error("Path traversal detected or access outside brain root is denied");
            }
            try {
                const dir = path.dirname(fullPath);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(fullPath, content, "utf-8");
                return { content: [{ type: "text" as const, text: `Successfully wrote file to ${filePath}` }] };
            } catch (e: any) {
                throw new Error(`Failed to write file: ${e.message}`);
            }
        }

        if (action === "ensure_project") {
            if (!projectName) {
                throw new Error("projectName is required for ensure_project action");
            }
            const sanitized = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            if (!sanitized) {
                throw new Error("Invalid project name");
            }
            try {
                const projDir = path.join(brainRoot, sanitized);
                const memoriesDir = path.join(projDir, "memories");
                const sessionsDir = path.join(memoriesDir, "sessions");
                const conceptsDir = path.join(memoriesDir, "concepts");
                const factsDir = path.join(memoriesDir, "facts");
                const archiveDir = path.join(projDir, "archive");
                const cartographDir = path.join(projDir, "cartograph");

                fs.mkdirSync(sessionsDir, { recursive: true });
                fs.mkdirSync(conceptsDir, { recursive: true });
                fs.mkdirSync(factsDir, { recursive: true });
                fs.mkdirSync(archiveDir, { recursive: true });
                fs.mkdirSync(cartographDir, { recursive: true });

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
                    fs.writeFileSync(protocolPath, protocolContent, "utf-8");
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
                    fs.writeFileSync(indexPath, indexContent, "utf-8");
                }

                const globalContextPath = path.join(brainRoot, "global_context_summary.md");
                if (fs.existsSync(globalContextPath)) {
                    let globalContent = fs.readFileSync(globalContextPath, "utf-8");
                    const listProjectsFunc = () => {
                        return fs.readdirSync(brainRoot).filter(file => {
                            const fullPath = path.join(brainRoot, file);
                            if (!fs.statSync(fullPath).isDirectory()) return false;
                            return fs.existsSync(path.join(fullPath, "memories"));
                        });
                    };
                    const projects = listProjectsFunc();
                    const projectsList = projects.map(p => `- **${p}**`).join("\n");
                    const regex = /(## Registered Projects\s*)([\s\S]*?)(?=\n\n##|$)/;
                    if (regex.test(globalContent)) {
                        globalContent = globalContent.replace(regex, `$1\n${projectsList}\n`);
                    } else {
                        globalContent += `\n\n## Registered Projects\n${projectsList}\n`;
                    }
                    fs.writeFileSync(globalContextPath, globalContent, "utf-8");
                }

                return { content: [{ type: "text" as const, text: `Project ${sanitized} ensured and memory scaffold created.` }] };
            } catch (e: any) {
                throw new Error(`Failed to ensure project: ${e.message}`);
            }
        }

        if (action === "list_cartograph_reports") {
            if (!projectName) {
                throw new Error("projectName is required for list_cartograph_reports action");
            }
            const sanitized = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const cartographDir = path.join(brainRoot, sanitized, "cartograph");
            if (!fs.existsSync(cartographDir)) {
                return { content: [{ type: "text" as const, text: JSON.stringify([]) }] };
            }
            try {
                const files = fs.readdirSync(cartographDir).filter(file => file.endsWith(".json"));
                const reports: { filename: string; summary: string; taskId: string }[] = [];
                for (const file of files) {
                    try {
                        const raw = fs.readFileSync(path.join(cartographDir, file), "utf-8");
                        const parsed = JSON.parse(raw);
                        reports.push({
                            filename: file,
                            summary: parsed.summary || "",
                            taskId: parsed.taskId || "",
                        });
                    } catch { /* skip corrupt */ }
                }
                return { content: [{ type: "text" as const, text: JSON.stringify(reports, null, 2) }] };
            } catch (e: any) {
                throw new Error(`Failed to list reports: ${e.message}`);
            }
        }

        if (action === "list_all_cartograph_reports") {
            if (!fs.existsSync(brainRoot)) {
                return { content: [{ type: "text" as const, text: JSON.stringify({}) }] };
            }
            try {
                const projects = fs.readdirSync(brainRoot).filter(file => {
                    const fullPath = path.join(brainRoot, file);
                    return fs.statSync(fullPath).isDirectory();
                });
                const allReports: Record<string, { filename: string; summary: string; taskId: string }[]> = {};
                for (const proj of projects) {
                    const cartographDir = path.join(brainRoot, proj, "cartograph");
                    if (fs.existsSync(cartographDir)) {
                        const files = fs.readdirSync(cartographDir).filter(file => file.endsWith(".json"));
                        const reports: { filename: string; summary: string; taskId: string }[] = [];
                        for (const file of files) {
                            try {
                                const raw = fs.readFileSync(path.join(cartographDir, file), "utf-8");
                                const parsed = JSON.parse(raw);
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
            } catch (e: any) {
                throw new Error(`Failed to list all reports: ${e.message}`);
            }
        }

        if (action === "read_cartograph_report") {
            if (!projectName) {
                throw new Error("projectName is required for read_cartograph_report action");
            }
            if (!filename) {
                throw new Error("filename is required for read_cartograph_report action");
            }
            const sanitizedProj = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const sanitizedFile = path.basename(filename);
            const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Report file not found: ${filename} in project ${projectName}`);
            }
            try {
                const fileContent = fs.readFileSync(fullPath, "utf-8");
                return { content: [{ type: "text" as const, text: fileContent }] };
            } catch (e: any) {
                throw new Error(`Failed to read report: ${e.message}`);
            }
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
            const sanitizedProj = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const sanitizedFile = path.basename(filename);
            const projDir = path.join(brainRoot, sanitizedProj);
            const cartographDir = path.join(projDir, "cartograph");
            
            // Ensure project and cartograph dir exists
            fs.mkdirSync(cartographDir, { recursive: true });
            
            const fullPath = path.join(cartographDir, sanitizedFile);
            try {
                fs.writeFileSync(fullPath, content, "utf-8");
                return { content: [{ type: "text" as const, text: `Successfully wrote cartograph report to ${filename} under project ${projectName}` }] };
            } catch (e: any) {
                throw new Error(`Failed to write report: ${e.message}`);
            }
        }

        if (action === "delete_cartograph_report") {
            if (!projectName) {
                throw new Error("projectName is required for delete_cartograph_report action");
            }
            if (!filename) {
                throw new Error("filename is required for delete_cartograph_report action");
            }
            const sanitizedProj = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const sanitizedFile = path.basename(filename);
            const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Report file not found for deletion: ${filename} in project ${projectName}`);
            }
            try {
                fs.unlinkSync(fullPath);
                return { content: [{ type: "text" as const, text: `Successfully deleted cartograph report ${filename} under project ${projectName}` }] };
            } catch (e: any) {
                throw new Error(`Failed to delete report: ${e.message}`);
            }
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
            const sanitizedSrc = sourceProject.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const sanitizedTgt = targetProject.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const sanitizedFile = path.basename(filename);
            
            const srcPath = path.join(brainRoot, sanitizedSrc, "cartograph", sanitizedFile);
            const tgtDir = path.join(brainRoot, sanitizedTgt, "cartograph");
            const tgtPath = path.join(tgtDir, sanitizedFile);
            
            if (!fs.existsSync(srcPath)) {
                throw new Error(`Source report file not found: ${filename} in project ${sourceProject}`);
            }
            try {
                // Ensure target directory exists
                fs.mkdirSync(tgtDir, { recursive: true });
                
                // Read original report and update its projectName if it has one
                const raw = fs.readFileSync(srcPath, "utf-8");
                let parsed = JSON.parse(raw);
                if (typeof parsed === "object" && parsed !== null) {
                    parsed.projectName = targetProject;
                }
                
                fs.writeFileSync(tgtPath, JSON.stringify(parsed, null, 2), "utf-8");
                fs.unlinkSync(srcPath);
                
                return { content: [{ type: "text" as const, text: `Successfully moved cartograph report ${filename} from project ${sourceProject} to project ${targetProject}` }] };
            } catch (e: any) {
                throw new Error(`Failed to move report: ${e.message}`);
            }
        }

        if (action === "bulk_delete_cartograph_reports") {
            if (!projectName) {
                throw new Error("projectName is required for bulk_delete_cartograph_reports action");
            }
            if (!filenames || filenames.length === 0) {
                throw new Error("filenames is required for bulk_delete_cartograph_reports action");
            }
            const sanitizedProj = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const deleted: string[] = [];
            try {
                for (const fn of filenames) {
                    const sanitizedFile = path.basename(fn);
                    const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                        deleted.push(fn);
                    }
                }
                return { content: [{ type: "text" as const, text: `Successfully deleted ${deleted.length} cartograph reports under project ${projectName}` }] };
            } catch (e: any) {
                throw new Error(`Failed to bulk delete reports: ${e.message}`);
            }
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
            const sanitizedProj = projectName.replace(/[^a-zA-Z0-9\-_]/g, "_");
            const sanitizedFile = path.basename(filename);
            const fullPath = path.join(brainRoot, sanitizedProj, "cartograph", sanitizedFile);
            if (!fs.existsSync(fullPath)) {
                throw new Error(`Report file not found for update: ${filename} in project ${projectName}`);
            }
            try {
                const raw = fs.readFileSync(fullPath, "utf-8");
                const report = JSON.parse(raw);
                
                // Partially merge updates
                const merged = { ...report, ...updates };
                fs.writeFileSync(fullPath, JSON.stringify(merged, null, 2), "utf-8");
                return { content: [{ type: "text" as const, text: `Successfully updated cartograph report ${filename} under project ${projectName}` }] };
            } catch (e: any) {
                throw new Error(`Failed to update report: ${e.message}`);
            }
        }

        throw new Error(`Unknown action: ${action}`);
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
