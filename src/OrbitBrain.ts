import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { ImpactReport } from "./types";

export class OrbitBrain {
  private readonly brainRoot: string;

  constructor() {
    this.brainRoot = process.env.ORBIT_BRAIN_DIR || path.join(os.homedir(), ".orbit-brain");
  }

  /** Ensures the root brain directory and global files exist. Called on extension activation. */
  public initialize(): void {
    if (!fs.existsSync(this.brainRoot)) {
      fs.mkdirSync(this.brainRoot, { recursive: true });
    }

    const brainArchPath = path.join(this.brainRoot, "BRAIN_ARCHITECTURE.md");
    if (!fs.existsSync(brainArchPath)) {
      const archContent = `<!--
[ORBIT MEMORY SYSTEM]
This file documents the structure of the Orbit Memory System.
The agent uses this to navigate project context, architectural decisions, and persistent memory.

COHERENCE & MAINTENANCE PROTOCOL (Use when running "update memory system"):
1. Summarize Session: Aggregate all conversation context from the active session.
2. Project Directory Sync: Ensure a directory exists for each project worked on.
3. Capture & Index Memories: Write an <observation> to <project>/memories/sessions/ and update INDEX.md.
4. Archive Historical Data: Move deprecated notes to <project>/archive/.
5. Context Sync: Update BRAIN_ARCHITECTURE.md and global_context_summary.md.
-->

# Orbit Memory System

## Tree Structure

[Auto-updated by the agent during "update memory system"]
`;
      fs.writeFileSync(brainArchPath, archContent, "utf-8");
    }

    const globalContextPath = path.join(this.brainRoot, "global_context_summary.md");
    if (!fs.existsSync(globalContextPath)) {
      const platformStr = os.platform();
      const releaseStr = os.release();
      const shellStr = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");
      const globalContent = `<!--
[ORBIT MEMORY SYSTEM]
Global environment and tooling context. Updated automatically by the agent.
-->

# Global Context Summary

## Environment
- **OS**: ${platformStr} ${releaseStr}
- **Shell**: ${shellStr}

## Registered Projects
[Auto-populated from workspace folders]

## Notes
[Agent-populated during "update memory system"]
`;
      fs.writeFileSync(globalContextPath, globalContent, "utf-8");
    }
  }

  /** Creates a project directory with full memory scaffold if it doesn't exist. */
  public ensureProject(projectName: string): void {
    const sanitized = this.sanitizeProjectName(projectName);
    if (!sanitized) return;

    const projDir = path.join(this.brainRoot, sanitized);
    const memoriesDir = path.join(projDir, "memories");
    const featuresDir = path.join(memoriesDir, "features");
    const tasksDir = path.join(memoriesDir, "tasks");
    const conceptsDir = path.join(memoriesDir, "concepts");
    const factsDir = path.join(memoriesDir, "facts");
    const archiveDir = path.join(projDir, "archive");
    const cartographDir = path.join(projDir, "cartograph");

    fs.mkdirSync(featuresDir, { recursive: true });
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(conceptsDir, { recursive: true });
    fs.mkdirSync(factsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(cartographDir, { recursive: true });

    const protocolPath = path.join(memoriesDir, "PROTOCOL.md");
    if (!fs.existsSync(protocolPath)) {
      const protocolContent = `# Topic-Based Memory Protocol (v2.0)

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
4. **Facts**: Discoveries or immutable truths go into \`memories/facts/\`.

## 3. Storage Hierarchy
- \`features/\`: Topic files for features, components, UI layouts, and styling.
- \`tasks/\`: Topic files for specific tasks, issues, and bug fixes.
- \`facts/\`: Atomic, immutable truths about the project.
`;
      fs.writeFileSync(protocolPath, protocolContent, "utf-8");
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
      fs.writeFileSync(indexPath, indexContent, "utf-8");
    }

    this.updateGlobalContextProjects();
  }

  /** Returns list of all registered project directory names recursively. */
  public listProjects(): string[] {
    if (!fs.existsSync(this.brainRoot)) {
      return [];
    }
    const projects: string[] = [];
    const walk = (dir: string) => {
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir);
      } catch (e) {
        return;
      }
      let hasMemories = false;
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            if (file === "memories" || file === "cartograph") {
              hasMemories = true;
            } else if (file !== "archive" && file !== "concepts" && file !== "facts" && file !== "features" && file !== "tasks" && file !== "sessions") {
              walk(fullPath);
            }
          }
        } catch {
          /* ignore stat error */
        }
      }
      if (hasMemories) {
        const relative = path.relative(this.brainRoot, dir).replace(/\\/g, '/');
        if (relative) {
          projects.push(relative);
        }
      }
    };
    try {
      walk(this.brainRoot);
    } catch (e) {
      console.error("Failed to list projects recursively:", e);
    }
    return projects;
  }

  /** Returns the brain root path. */
  public getBrainRoot(): string {
    return this.brainRoot;
  }

  /** Auto-detects projects from VS Code workspace folders and ensures they exist in the brain. */
  public syncWorkspaceProjects(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    for (const folder of folders) {
      const name = folder.name || path.basename(folder.uri.fsPath);
      if (name) {
        this.ensureProject(name);
      }
    }
  }

  private sanitizeProjectName(name: string): string {
    return name.split('/').map(part => part.replace(/[^a-zA-Z0-9\-_]/g, "_")).join('/');
  }

  private updateGlobalContextProjects(): void {
    const globalContextPath = path.join(this.brainRoot, "global_context_summary.md");
    if (!fs.existsSync(globalContextPath)) return;

    try {
      let content = fs.readFileSync(globalContextPath, "utf-8");
      const projects = this.listProjects();
      const projectsList = projects.map(p => `- **${p}**`).join("\n");

      const regex = /(## Registered Projects\s*)([\s\S]*?)(?=\n\n##|$)/;
      if (regex.test(content)) {
        content = content.replace(regex, `$1\n${projectsList}\n`);
      } else {
        content += `\n\n## Registered Projects\n${projectsList}\n`;
      }
      fs.writeFileSync(globalContextPath, content, "utf-8");
    } catch (e) {
      console.error("Failed to update global_context_summary.md:", e);
    }
  }

  /** Lists all cartograph reports for a specific project. */
  public listCartographReports(projectName: string): { filename: string; report: ImpactReport }[] {
    const sanitized = this.sanitizeProjectName(projectName);
    if (!sanitized) return [];

    const cartographDir = path.join(this.brainRoot, sanitized, "cartograph");
    if (!fs.existsSync(cartographDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(cartographDir).filter(file => file.endsWith(".json"));
      const reports: { filename: string; report: ImpactReport }[] = [];
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(cartographDir, file), "utf-8");
          const report = JSON.parse(content) as ImpactReport;
          reports.push({ filename: file, report });
        } catch (e) {
          console.error(`Failed to read cartograph report file ${file}:`, e);
        }
      }
      return reports;
    } catch (e) {
      console.error(`Failed to list cartograph reports for project ${projectName}:`, e);
      return [];
    }
  }

  /** Writes/saves a cartograph report to disk. Returns the written filename. */
  public writeCartographReport(projectName: string, report: ImpactReport, filename?: string): string {
    const sanitized = this.sanitizeProjectName(projectName);
    this.ensureProject(sanitized);

    const cartographDir = path.join(this.brainRoot, sanitized, "cartograph");
    const name = filename || `${report.taskId.replace(/[^a-zA-Z0-9\-_]/g, "_")}_${report.timestamp.replace(/[^a-zA-Z0-9\-_]/g, "_")}.json`;
    const fullPath = path.join(cartographDir, name);

    fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), "utf-8");
    return name;
  }

  /** Deletes a specific cartograph report. */
  public deleteCartographReport(projectName: string, filename: string): void {
    const sanitized = this.sanitizeProjectName(projectName);
    const fullPath = path.join(this.brainRoot, sanitized, "cartograph", filename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  /** Moves a cartograph report from one project to another. */
  public moveCartographReport(sourceProject: string, targetProject: string, filename: string): void {
    const sourceSanitized = this.sanitizeProjectName(sourceProject);
    const targetSanitized = this.sanitizeProjectName(targetProject);
    this.ensureProject(targetSanitized);

    const sourcePath = path.join(this.brainRoot, sourceSanitized, "cartograph", filename);
    if (!fs.existsSync(sourcePath)) return;

    try {
      const content = fs.readFileSync(sourcePath, "utf-8");
      const report = JSON.parse(content) as ImpactReport;
      
      // Update report projectName metadata
      report.projectName = targetSanitized;

      this.writeCartographReport(targetSanitized, report, filename);
      fs.unlinkSync(sourcePath);
    } catch (e) {
      console.error(`Failed to move cartograph report ${filename} from ${sourceProject} to ${targetProject}:`, e);
    }
  }

  /** Reads the project-specific semantic tag registry. */
  public readTagRegistry(projectName: string): Record<string, { color: string; label: string }> {
    const sanitized = this.sanitizeProjectName(projectName);
    const registryPath = path.join(this.brainRoot, sanitized, "cartograph-tags.json");
    if (!fs.existsSync(registryPath)) {
      const defaultRegistry = {
        feat: { color: "var(--tag-color-emerald, #10b981)", label: "Feature" },
        fix: { color: "var(--tag-color-rose, #f43f5e)", label: "Bug Fix" },
        docs: { color: "var(--tag-color-amber, #f59e0b)", label: "Documentation" },
        refactor: { color: "var(--tag-color-violet, #8b5cf6)", label: "Refactoring" },
      };
      return defaultRegistry;
    }

    try {
      const content = fs.readFileSync(registryPath, "utf-8");
      const data = JSON.parse(content);
      return data.registry || data;
    } catch (e) {
      console.error(`Failed to read tag registry for project ${projectName}:`, e);
      return {};
    }
  }

  /** Writes the project-specific semantic tag registry. */
  public writeTagRegistry(projectName: string, registry: Record<string, { color: string; label: string }>): void {
    const sanitized = this.sanitizeProjectName(projectName);
    this.ensureProject(sanitized);
    const registryPath = path.join(this.brainRoot, sanitized, "cartograph-tags.json");

    try {
      const data = { registry };
      fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error(`Failed to write tag registry for project ${projectName}:`, e);
    }
  }

  /** Migrates existing legacy reports from ~/.antigravity-forms/impacts/history/ to ~/.orbit-brain/ */
  public migrateFromLegacy(): void {
    const sentinelPath = path.join(this.brainRoot, ".migrated");
    if (fs.existsSync(sentinelPath)) {
      return;
    }

    const legacyDir = path.join(os.homedir(), ".antigravity-forms", "impacts", "history");
    if (!fs.existsSync(legacyDir)) {
      // Nothing to migrate, write sentinel and exit
      fs.writeFileSync(sentinelPath, "migrated", "utf-8");
      return;
    }

    try {
      const files = fs.readdirSync(legacyDir).filter(file => file.endsWith(".json"));
      for (const file of files) {
        const fullLegacyPath = path.join(legacyDir, file);
        try {
          const content = fs.readFileSync(fullLegacyPath, "utf-8");
          const report = JSON.parse(content) as ImpactReport;
          const projName = report.projectName || "Default";
          
          this.writeCartographReport(projName, report);
          fs.unlinkSync(fullLegacyPath);
        } catch (e) {
          console.error(`Failed to migrate legacy report file ${file}:`, e);
        }
      }
      fs.writeFileSync(sentinelPath, "migrated", "utf-8");
    } catch (e) {
      console.error("Failed to migrate legacy reports:", e);
    }
  }
}
