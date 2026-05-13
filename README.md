# Interactive Form Planner for Antigravity

Pre-execution planning panel for AI agents in the Antigravity IDE. 

Triggers an interactive planning form when agent intent is ambiguous, *before* any code/file is written or changes, reducing token waste and aligning agent intent upfront.

## Demo

![Demo](https://raw.githubusercontent.com/Venturi-exe/Interactive-Form-Planner-for-Antigravity/main/assets/Demo.gif)

## Customize Layout

You can drag the form panel and place it wherever it fits your workflow best (e.g., right below the agent chat).

![Customize Layout](https://raw.githubusercontent.com/Venturi-exe/Interactive-Form-Planner-for-Antigravity/main/assets/After-Download-Customize-layout.gif)

## Installation

### Primary Method: Open VSX (Recommended)
Because this extension is published to Open VSX, it is fully integrated into Antigravity:
1. Open the **Extensions** sidebar in Antigravity (`Ctrl+Shift+X`).
2. Search for `Interactive Form Planner` or `VNTRCORP.antigravity-interactive-form-planner-planning-tool`.
3. Click **Install**.

The extension will automatically configure your agent and MCP server on first launch!

### Secondary Method: Manual GitHub Release
1. Download the latest `.vsix` from the GitHub Releases page.
2. In Antigravity: Extensions > `...` > **Install from VSIX**.

## How It Works

This extension enforces a rigorous planning protocol between the user and the agent. It integrates three core mechanisms to ensure project integrity and clarity.

### 1. The Planning Form
The agent proceeds immediately without a form if the task is unambiguous. However, the `antigravity-planner` MCP server triggers an interactive panel before any code is modified when:
- A new feature or page is being built.
- The task is ambiguous or missing required detail.
- The agent identifies a better implementation than what was asked.
- Multiple valid approaches exist and the choice affects structure.

**Field Types:**
- **single-choice**: Radio group (includes "Other").
- **multi-choice**: Checkbox group (includes "Other").
- **free-text**: Text input or textarea.

Every form includes a **Dismiss** option. If dismissed, the agent proceeds with the original prompt and existing context only.

### 2. Post Planning Analysis
After every form submission (standard or via Deep Prompt Refining), the agent generates a structured Markdown artifact **before writing any code**.
- **Location**: `[workspace-root]/post_planning_analysis/post_planning_analysis_[task-name].md`
- **Contents**: Historical questions, user decisions, technical assumptions, permissions, and an execution roadmap.

### 3. Deep Prompt Refining
Triggered by adding `@trigger deep prompt refining` to your message, this feature starts an iterative planning loop.

**Step-by-Step Walkthrough:**
1. **Initiate**: Add `@trigger deep prompt refining` to your prompt.
2. **Review**: The agent sends a planning form with an "Execute Plan" button.
3. **Iterate**: Submit the form with your feedback. The agent will update the plan and send a new form for further refinement.
4. **Finalize**: Once the plan is perfect, click **Execute Plan**. 
5. **Execution**: The agent generates the Post Planning Analysis and begins implementing the task immediately.

---

*Note: This extension is designed for the Antigravity IDE*
