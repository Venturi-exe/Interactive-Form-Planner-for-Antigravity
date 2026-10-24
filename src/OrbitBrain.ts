import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { ImpactReport } from "./types.js";
import { initBrainFromTemplate, migrateToLayoutV3 } from "./core/migration.js";
import { moveToTrash } from "./core/trash.js";
import { writeJsonAtomic, writeAtomic, ensureDirSafe } from "./core/fsx.js";
import { resolveInside, assertSafeFileName, normalizeProjectKey } from "./core/paths.js";
import { withLock } from "./core/lock.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vscodeModule: any;
try {
  vscodeModule = require("vscode");
} catch {
  vscodeModule = undefined;
}

export class OrbitBrain {
  private readonly brainRoot: string;

  constructor() {
    this.brainRoot = process.env.ORBIT_BRAIN_DIR || path.join(os.homedir(), ".orbit-brain");
  }

  /** Ensures the root brain directory and global files exist. Executes migrations sequentially under brain lock. */
  public async initialize(): Promise<void> {
    await ensureDirSafe(this.brainRoot);

    try {
      await withLock(
        "brain-init",
        async () => {
          // 1. Fresh install: init template before any summary files are created
          const templateDir = path.join(__dirname, "..", "media", "brain-template");
          await initBrainFromTemplate(templateDir, this.brainRoot);

          // 2. Migrate legacy reports from ~/.antigravity-forms
          await this.migrateFromLegacy();

          // 3. Migrate brain to Layout v3
          await migrateToLayoutV3(this.brainRoot);

          // 4. Create or update summary files atomically
          const brainArchPath = path.join(this.brainRoot, "BRAIN_ARCHITECTURE.md");
          if (!fs.existsSync(brainArchPath)) {
            const archContent = `<!--
[ORBIT MEMORY SYSTEM]
This file documents the structure of the Orbit Memory System (Layout v3).
The agent uses this to navigate project context, architectural decisions, and persistent memory.

COHERENCE & MAINTENANCE PROTOCOL (Use when running "update memory system"):
1. Summarize Session: Aggregate all conversation context from the active session.
2. Project Directory Sync: Ensure a directory exists under projects/<project_key>/ for each project worked on.
3. Capture & Index Memories: Write an <observation> to projects/<project_key>/memories/sessions/ and update INDEX.md.
4. Archive Historical Data: Move deprecated notes to projects/<project_key>/archive/.
5. Context Sync: Update BRAIN_ARCHITECTURE.md and global_context_summary.md.
-->

# Orbit Memory System (Layout v3)

## Tree Structure

[Auto-updated by the agent during "update memory system"]
`;
            await writeAtomic(brainArchPath, archContent);
          }

          const globalContextPath = path.join(this.brainRoot, "global_context_summary.md");
          if (!fs.existsSync(globalContextPath)) {
            let recordEnv = false;
            try {
              if (vscodeModule && vscodeModule.workspace && typeof vscodeModule.workspace.getConfiguration === "function") {
                recordEnv = vscodeModule.workspace.getConfiguration("orbit.privacy").get("recordEnvironment", false) ?? false;
              } else {
                recordEnv = process.env.ORBIT_RECORD_ENVIRONMENT === "true";
              }
            } catch {
              recordEnv = false;
            }

            const platformStr = recordEnv ? `${os.platform()} ${os.release()}` : "[Redacted / privacy disabled]";
            const shellStr = recordEnv ? (process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash")) : "[Redacted / privacy disabled]";
            const globalContent = `<!--
[ORBIT MEMORY SYSTEM]
Global environment and tooling context. Updated automatically by the agent.
-->

# Global Context Summary

## Environment
- **OS**: ${platformStr}
- **Shell**: ${shellStr}

## Registered Projects
[Auto-populated from workspace folders]

## Notes
[Agent-populated during "update memory system"]
`;
            await writeAtomic(globalContextPath, globalContent);
          }

          this.updateGlobalContextEnvironment();
        },
        { brainRoot: this.brainRoot }
      );
    } catch (err) {
      console.warn("OrbitBrain initialization completed with warning:", err);
    }
  }

  /** Resolves project root directory supporting both Layout v3 and legacy Layout v2. */
  public getProjectDir(projectName: string): string {
    const key = this.sanitizeProjectName(projectName).toLowerCase();
    const v3Path = path.join(this.brainRoot, "projects", key);
    if (fs.existsSync(v3Path)) {
      return v3Path;
    }
    const legacyPath = path.join(this.brainRoot, key);
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    return v3Path;
  }

  /** Creates a project directory with full memory scaffold if it doesn't exist. */
  public ensureProject(projectName: string): void {
    const sanitized = this.sanitizeProjectName(projectName);
    if (!sanitized) return;

    const projDir = path.join(this.brainRoot, "projects", sanitized.toLowerCase());
    const reportsDir = path.join(projDir, "reports");
    const cartographDir = path.join(projDir, "cartograph");
    const memoriesDir = path.join(projDir, "memories");
    const sessionsDir = path.join(memoriesDir, "sessions");
    const featuresDir = path.join(memoriesDir, "features");
    const tasksDir = path.join(memoriesDir, "tasks");
    const conceptsDir = path.join(memoriesDir, "concepts");
    const factsDir = path.join(memoriesDir, "facts");
    const archiveDir = path.join(projDir, "archive");

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(cartographDir, { recursive: true });
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(conceptsDir, { recursive: true });
    fs.mkdirSync(factsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });

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
- **${sanitized.toLowerCase()}**: This project directory.

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

  /** Returns list of all registered project directory names. */
  public listProjects(): string[] {
    if (!fs.existsSync(this.brainRoot)) {
      return [];
    }
    const projects = new Set<string>();

    // 1. Scan Layout v3 projects/ directory
    const v3ProjectsDir = path.join(this.brainRoot, "projects");
    if (fs.existsSync(v3ProjectsDir)) {
      try {
        const entries = fs.readdirSync(v3ProjectsDir);
        for (const entry of entries) {
          const fullPath = path.join(v3ProjectsDir, entry);
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              projects.add(entry.toLowerCase());
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // 2. Scan top-level for backwards compatibility
    try {
      const entries = fs.readdirSync(this.brainRoot);
      for (const entry of entries) {
        if (entry === "projects" || entry.startsWith(".")) continue;
        const fullPath = path.join(this.brainRoot, entry);
        try {
          if (fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, "memories"))) {
            projects.add(entry.toLowerCase());
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return Array.from(projects).sort();
  }

  /** Returns the brain root path. */
  public getBrainRoot(): string {
    return this.brainRoot;
  }

  /** Auto-detects projects from VS Code workspace folders and ensures they exist in the brain. */
  public syncWorkspaceProjects(): void {
    const folders = vscodeModule?.workspace?.workspaceFolders;
    if (!folders) return;

    for (const folder of folders) {
      const name = folder.name || path.basename(folder.uri.fsPath);
      if (name) {
        this.ensureProject(name);
      }
    }
  }

  private sanitizeProjectName(name: string): string {
    return normalizeProjectKey(name);
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

  private updateGlobalContextEnvironment(): void {
    const globalContextPath = path.join(this.brainRoot, "global_context_summary.md");
    if (!fs.existsSync(globalContextPath)) return;

    let recordEnv = false;
    try {
      if (vscodeModule && vscodeModule.workspace && typeof vscodeModule.workspace.getConfiguration === "function") {
        recordEnv = vscodeModule.workspace.getConfiguration("orbit.privacy").get("recordEnvironment", false) ?? false;
      } else {
        recordEnv = process.env.ORBIT_RECORD_ENVIRONMENT === "true";
      }
    } catch {
      recordEnv = false;
    }

    const platformStr = recordEnv ? `${os.platform()} ${os.release()}` : "[Redacted / privacy disabled]";
    const shellStr = recordEnv ? (process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash")) : "[Redacted / privacy disabled]";
    const envBlock = `- **OS**: ${platformStr}\n- **Shell**: ${shellStr}`;

    try {
      let content = fs.readFileSync(globalContextPath, "utf-8");
      const regex = /(## Environment\s*)([\s\S]*?)(?=\n\n##|$)/;
      if (regex.test(content)) {
        content = content.replace(regex, `$1\n${envBlock}\n`);
      } else {
        content += `\n\n## Environment\n${envBlock}\n`;
      }
      fs.writeFileSync(globalContextPath, content, "utf-8");
    } catch (e) {
      console.error("Failed to update environment in global_context_summary.md:", e);
    }
  }

  /** Lists all cartograph reports for a specific project. */
  public listCartographReports(projectName: string): { filename: string; report: ImpactReport }[] {
    const projDir = this.getProjectDir(projectName);
    const cartographDir = path.join(projDir, "cartograph");
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

  /** Writes/saves a cartograph report to disk atomically. Returns the written filename. */
  public writeCartographReport(projectName: string, report: ImpactReport, filename?: string): string {
    const projDir = this.getProjectDir(projectName);
    const cartographDir = path.join(projDir, "cartograph");
    fs.mkdirSync(cartographDir, { recursive: true });

    const safeName = filename
      ? assertSafeFileName(filename)
      : `${report.taskId.replace(/[^a-zA-Z0-9\-_]/g, "_")}_${report.timestamp.replace(/[^a-zA-Z0-9\-_]/g, "_")}.json`;
    const fullPath = resolveInside(cartographDir, safeName);

    writeJsonAtomic(fullPath, report).catch((err) => {
      console.error(`Failed atomic write of cartograph report ${safeName}:`, err);
    });
    return safeName;
  }

  /** Deletes a specific cartograph report by moving it to .trash. */
  public deleteCartographReport(projectName: string, filename: string): void {
    const safeName = assertSafeFileName(filename);
    const projDir = this.getProjectDir(projectName);
    const cartographDir = path.join(projDir, "cartograph");
    const fullPath = resolveInside(cartographDir, safeName);
    if (fs.existsSync(fullPath)) {
      moveToTrash(fullPath, this.brainRoot).catch((err) => {
        console.error(`Failed to move cartograph report to trash ${safeName}:`, err);
      });
    }
  }

  /** Moves a cartograph report from one project to another safely. */
  public moveCartographReport(sourceProject: string, targetProject: string, filename: string): void {
    const safeName = assertSafeFileName(filename);
    const sourceDir = this.getProjectDir(sourceProject);
    const targetDir = this.getProjectDir(targetProject);
    this.ensureProject(targetProject);

    const sourceCartographDir = path.join(sourceDir, "cartograph");
    const sourcePath = resolveInside(sourceCartographDir, safeName);
    if (!fs.existsSync(sourcePath)) return;

    try {
      const content = fs.readFileSync(sourcePath, "utf-8");
      const report = JSON.parse(content) as ImpactReport;
      
      // Update report projectName metadata
      report.projectName = this.sanitizeProjectName(targetProject).toLowerCase();

      this.writeCartographReport(targetProject, report, safeName);
      moveToTrash(sourcePath, this.brainRoot).catch((err) => {
        console.error(`Failed to move old report to trash: ${safeName}`, err);
      });
    } catch (e) {
      console.error(`Failed to move cartograph report ${safeName} from ${sourceProject} to ${targetProject}:`, e);
    }
  }

  /** Reads the project-specific semantic tag registry. */
  public readTagRegistry(projectName: string): Record<string, { color: string; label: string }> {
    const projDir = this.getProjectDir(projectName);
    const registryPath = path.join(projDir, "cartograph-tags.json");
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
      return data.registry || {};
    } catch (e) {
      console.error(`Failed to read tag registry for project ${projectName}:`, e);
      return {};
    }
  }

  /** Writes the project-specific semantic tag registry. */
  public writeTagRegistry(projectName: string, registry: Record<string, { color: string; label: string }>): void {
    const projDir = this.getProjectDir(projectName);
    this.ensureProject(projectName);
    const registryPath = path.join(projDir, "cartograph-tags.json");

    try {
      const data = { registry };
      writeJsonAtomic(registryPath, data).catch((err) => {
        console.error(`Failed atomic write of tag registry for project ${projectName}:`, err);
      });
    } catch (e) {
      console.error(`Failed to write tag registry for project ${projectName}:`, e);
    }
  }

  /** Migrates existing legacy reports from ~/.antigravity-forms/impacts/history/ to ~/.orbit-brain/ */
  public async migrateFromLegacy(): Promise<void> {
    const sentinelPath = path.join(this.brainRoot, ".migrated");
    if (fs.existsSync(sentinelPath)) {
      return;
    }

    const legacyDir = path.join(os.homedir(), ".antigravity-forms", "impacts", "history");
    if (!fs.existsSync(legacyDir)) {
      await writeAtomic(sentinelPath, "migrated\n");
      return;
    }

    try {
      const files = fs.readdirSync(legacyDir).filter(file => file.endsWith(".json"));
      for (const file of files) {
        const fullLegacyPath = path.join(legacyDir, file);
        try {
          const content = await fs.promises.readFile(fullLegacyPath, "utf-8");
          const report = JSON.parse(content) as ImpactReport;
          const projName = report.projectName || "_default";
          
          this.writeCartographReport(projName, report);
          await moveToTrash(fullLegacyPath, this.brainRoot).catch(() => {});
        } catch (e) {
          console.error(`Failed to migrate legacy report file ${file}:`, e);
        }
      }
      await writeAtomic(sentinelPath, "migrated\n");
    } catch (e) {
      console.error("Failed to migrate legacy reports:", e);
    }
  }
}
