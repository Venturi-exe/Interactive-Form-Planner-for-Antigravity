# Orbit

Orbit : Ultimate planning tool for antigravity.

Orbit provides a complete loop alignment mechanism for AI agents in the Antigravity IDE, closing the gap between user intent and agent execution.

## The Dual-Alignment Philosophy

1. **Orbit Planner**: Aligns user intent with agent understanding *before* any code is written or modified (pre-execution alignment).
2. **Orbit Cartograph**: Aligns agent outputs, decisions, and actual code changes with user understanding *after* execution is complete (post-execution alignment).

---

## Features

### 1. Orbit Planner (Pre-Execution)
When a task is ambiguous or has multiple architectural approaches, the `orbit` MCP server automatically triggers an interactive planning form:
- Reduces token waste by resolving questions beforehand.
- Collects structured input (single-choice, multi-choice, and free-text fields).
- Supports **Deep Prompt Refining** via `@trigger deep prompt refining` to iteratively perfect plans before execution.
- Generates a persistent `planning_receipt_[task-name].md` inside `.antigravity-brain/projects/orbit/` prior to any code generation.

### 2. Orbit Cartograph (Post-Execution)
Once the agent completes its file modifications, it generates an impact report mapping all changes:
- Displays an interactive post-execution impact map utilizing locally vendored **Cytoscape.js**.
- Outlines every added, modified, moved, or deleted file visually.
- Details the specific reasons, downstream impacts, and user prompts driving each change.
- Preserves a dual-persistence history for auditing and recovery.

---

## Installation

### Primary Method: Open VSX (Recommended)
Because this extension is published to Open VSX, it is fully integrated into Antigravity:
1. Open the **Extensions** sidebar in Antigravity (`Ctrl+Shift+X`).
2. Search for `Orbit` or `VNTRCORP.antigravity-interactive-form-planner-planning-tool`.
3. Click **Install**.

The extension will automatically configure your agent and MCP server on first launch!

### Secondary Method: Manual Installation
1. Download the latest `.vsix` from the releases.
2. In Antigravity: Extensions > `...` > **Install from VSIX**.

---

## Orbit Memory System Setup (Orbit-Brain)

The Orbit Memory System is a local, persistent knowledge and operating layer stored in your home directory (`~/.orbit-brain/`). It acts as a long-term brain for your AI agent, preserving architectural decisions, environments, and preferences across coding sessions.

### Configure Your Orbit-Brain

To configure your personalized Orbit-Brain using all your prior project history, previous agent sessions, planning receipts, and IDE logs, copy the comprehensive configuration prompt below and paste it into the agent chat in Antigravity.

#### Orbit-Brain Configuration Prompt

```text
You are an expert AI software engineer and system architect. Your goal is to fully bootstrap and configure my local persistent memory system, known as "Orbit-Brain," which is stored at the root `~/.orbit-brain/`.

To make my Orbit-Brain completely customized for my actual projects, workflows, preferences, and workspace history, you must perform a comprehensive deep search and analysis of my prior work. Follow this step-by-step plan:

1. Locate Workspace History & IDE Data
   - Identify active VS Code workspace folders and currently open projects.
   - Search the local filesystem for the Antigravity App Data directory (typically under `~/.gemini/antigravity-ide`).
   - In that App Data folder, locate the `brain/` directory. This directory contains directories named with past conversation IDs, each containing files like `task.md`, `implementation_plan.md`, `walkthrough.md`, `scratch/` files, and `.system_generated/logs/transcript.jsonl` (the full history of my past conversations with the AI).
   - Locate global agent config files in the home directory or workspace, such as `~/.gemini/GEMINI.md`.

2. Deep Scan and Extract Context
   - Scan the project codebases in the current workspace to identify their tech stacks, main APIs, design languages, coding styles, and dependency trees.
   - Scan the past conversation folders and transcript files under the IDE brain folder. Retrieve details about:
     - Key architectural decisions and why they were made.
     - Challenging bugs, gotchas, and how they were resolved.
     - My developer persona, coding style preferences, tools used, and naming conventions.
     - Core system constraints and rules established in `GEMINI.md`.
     - Summarized session outputs, notes, and temporary scratchpad scripts.

3. Synthesize and Organize My Context
   - Group the extracted data by project (matching my active workspace folders).
   - Define my core workflows, preferences, environment variables, recurring tasks, and technology targets.

4. Initialize the Orbit-Brain Architecture
   - Ensure the central brain root is mapped to the standard user Orbit-Brain path (`~/.orbit-brain/`).
   - Create and populate the global coordination files:
     - `BRAIN_ARCHITECTURE.md`: Detailing the exact directory tree structure and the Coherence and Maintenance Protocol for keeping the brain in sync.
     - `global_context_summary.md`: Documenting the global environment setup (OS, shell, browser, package managers, tools) and my personalized developer profile.
     - `skills_reference.md`: Mapping specialized framework prefixes, skill rules, or custom instructions.

5. Generate Project-Specific Knowledge Layers
   - For each project directory registered under `~/.orbit-brain/`, establish the long-term memory structures:
     - `memories/INDEX.md`: A mapped catalog linking concepts, tags, and past session summaries to specific memory observation files.
     - `memories/facts/`: Immutable truths about the project architecture, design system files, configurations, and user profile information.
     - `memories/PROTOCOL.md`: The rule system dictating how observations must be captured and logged in the session directory.
     - `memories/sessions/`: A timestamped folder. Populate this folder with generated historical session summaries (e.g. `SESSION_YYYYMMDD_TASK_NAME.md`) synthesized from your scan of my past Antigravity conversation logs, so that my past history is preserved and indexed!

6. Verification and Final Report
   - Run verification checks to ensure all directories and files are successfully generated.
   - Output a beautiful, detailed directory layout of the generated Orbit-Brain.
   - Provide a concise summary of the project profiles, concepts, and historical facts you extracted and initialized.
   - Explain how I can easily maintain this brain going forward (such as by running the "update memory system" command at the end of sessions).

Begin your research now by locating and scanning my current workspace folders and the Antigravity App Data `brain/` directory, then bootstrap the entire Orbit-Brain system!
```

---

*Note: This extension is designed exclusively for the Antigravity IDE.*

