# Orbit

Orbit: Ultimate planning tool for Antigravity.

Orbit provides a complete loop alignment mechanism for AI agents in the Antigravity IDE, closing the gap between user intent and agent execution.

## The Dual-Alignment Philosophy

1. **Orbit Planner**: Aligns user intent with agent understanding before any code is written or modified (pre-execution alignment).
2. **Orbit Cartograph**: Aligns agent outputs, decisions, and actual code changes with user understanding after execution is complete (post-execution alignment).

---

## Architecture and Core Systems

### 1. Orbit Planner (Pre-Execution Alignment)
When a task is ambiguous or presents multiple architectural choices, the bundled `orbit` MCP server automatically triggers an interactive planning form:
- Reduces token waste by resolving questions and edge cases beforehand.
- Collects structured inputs (single-choice, multi-choice, and free-text fields).
- Supports **Deep Prompt Refining** via `@trigger deep prompt refining` to iteratively perfect plans before implementation.
- IPC v2 Protocol: Form requests are claimed atomically, supporting prompt cancellation and automated failure detection.
- Generates persistent planning receipts in the persistent Orbit-Brain.

### 2. Orbit Cartograph (Post-Execution Impact Mapping)
Once the agent completes its file modifications, it generates an impact report mapping all changes:
- Displays an interactive post-execution impact map utilizing vendored Cytoscape.js.
- Outlines every created, modified, moved, or deleted file visually.
- Details the specific reasons, downstream impacts, and user decisions driving each change.
- Preserves a dual-persistence history for auditing and recovery.

### 3. Layout v3 Brain Architecture
Orbit persists long-term architectural memory across sessions in `~/.orbit-brain/`:
- Multi-user compliant: Brain root is initialized with private permissions (`0o700`) and individual memory files with (`0o600`).
- Cross-platform lowercased project keys (`projects/<key>/`) for uniform access across Windows and Linux.
- 14-day TTL retention in `.trash/`: deletions are safely quarantined rather than permanently unlinked.
- Advisory cross-process locking (`.locks/`) to prevent race conditions during concurrent agent updates.

### 4. Non-Destructive IDE Integration
- Marker-bounded rules injection: Orbit injects its agent rules into `GEMINI.md` within explicit HTML comment markers (`<!-- ORBIT_RULES_START -->` and `<!-- ORBIT_RULES_END -->`), preserving all custom user instructions.
- Stable MCP server runtime: Bundled server is maintained at a stable path inside `globalStorageUri`, keeping tool registrations active across extension updates.
- Automated clean uninstall: Automatically removes the MCP server registration and Orbit rules markers upon extension uninstallation.

---

## Installation

### Primary Method: Open VSX (Recommended)
This extension is published to Open VSX and is integrated into Antigravity:
1. Open the **Extensions** sidebar in Antigravity (`Ctrl+Shift+X`).
2. Search for `Orbit` or `VNTRCORP.antigravity-interactive-form-planner-planning-tool`.
3. Click **Install**.

The extension automatically configures your agent rules and MCP server on first launch.

### Secondary Method: Manual Installation
1. Download the latest `.vsix` release.
2. In Antigravity: Extensions > `...` > **Install from VSIX**.

---

## Orbit Memory System Setup (Orbit-Brain)

The Orbit Memory System is a local, persistent knowledge and operating layer stored in your home directory (`~/.orbit-brain/`). It acts as a long-term memory for your AI agent, preserving architectural decisions, environments, and preferences across coding sessions.

### Configure Your Orbit-Brain

To configure your personalized Orbit-Brain using all your prior project history, previous agent sessions, planning receipts, and IDE logs, copy the configuration prompt below and paste it into the agent chat in Antigravity.

#### Orbit-Brain Configuration Prompt

```text
You are an expert AI software engineer and system architect. Your goal is to fully bootstrap and configure my local persistent memory system, known as "Orbit-Brain," which is stored at the root `~/.orbit-brain/`.

To make my Orbit-Brain completely customized for my actual projects, workflows, preferences, and workspace history, you must perform a comprehensive deep search and analysis of my prior work. Follow this step-by-step plan:

1. Locate Workspace History and IDE Data
   - Identify active workspace folders and currently open projects.
   - Search the local filesystem for the Antigravity App Data directory (typically under `~/.gemini/antigravity-ide`).
   - In that App Data folder, locate the `brain/` directory. This directory contains directories named with past conversation IDs, each containing files like `task.md`, `implementation_plan.md`, `walkthrough.md`, `scratch/` files, and `.system_generated/logs/transcript.jsonl`.
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
   - Group the extracted data by project (matching active workspace folders, lowercasing project keys).
   - Define my core workflows, preferences, environment variables, recurring tasks, and technology targets.

4. Initialize the Orbit-Brain Architecture
   - Ensure the central brain root is mapped to the standard user Orbit-Brain path (`~/.orbit-brain/`).
   - Create and populate the global coordination files:
     - `BRAIN_ARCHITECTURE.md`: Detailing the directory tree structure and the Coherence and Maintenance Protocol for keeping the brain in sync.
     - `global_context_summary.md`: Documenting the global environment setup (OS, shell, browser, package managers, tools) and my personalized developer profile.
     - `skills_reference.md`: Mapping specialized framework prefixes, skill rules, or custom instructions.

5. Generate Project-Specific Knowledge Layers
   - For each project directory registered under `~/.orbit-brain/projects/`, establish the long-term memory structures:
     - `memories/INDEX.md`: A mapped catalog linking concepts, tags, and past session summaries to specific memory observation files.
     - `memories/facts/`: Immutable truths about the project architecture, design system files, configurations, and user profile information.
     - `memories/PROTOCOL.md`: The rule system dictating how observations must be captured and logged in the session directory.
     - `memories/sessions/`: A timestamped folder. Populate this folder with generated historical session summaries synthesized from your scan of past conversation logs.

6. Verification and Final Report
   - Run verification checks to ensure all directories and files are successfully generated.
   - Output a detailed directory layout of the generated Orbit-Brain.
   - Provide a concise summary of the project profiles, concepts, and historical facts you extracted and initialized.
   - Explain how I can easily maintain this brain going forward (such as by running the "update memory system" command at the end of sessions).

Begin your research now by locating and scanning my current workspace folders and the Antigravity App Data `brain/` directory, then bootstrap the entire Orbit-Brain system!
```

---

*Note: This extension is designed exclusively for the Antigravity IDE and is published on Open VSX.*
