# Interactive Form Planner for Antigravity

Pre-execution alignment panel for AI agents in the Antigravity IDE. 

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
2. Search for `Interactive Form Planner` or `VNTRCORP.antigravity-alignment`.
3. Click **Install**.

The extension will automatically configure your agent and MCP server on first launch!

### Secondary Method: Manual GitHub Release
1. Download the latest `.vsix` from the GitHub Releases page.
2. In Antigravity: Extensions > `...` > **Install from VSIX**.

## How It Works

When installed, this extension automatically injects an `Alignment Rule` into your `GEMINI.md` file and registers the `antigravity-alignment` MCP server. 

The agent proceeds immediately without a form if the task is unambiguous. However, the agent will submit a form to the sidebar before modifying code when:
- A new feature or page is being built
- The task is ambiguous or missing required detail
- The agent identifies a better implementation than what was asked
- Multiple valid approaches exist and the choice affects structure or output

## Field Types & Dismiss

- **single-choice**: Radio group (all include "Other - describe below")
- **multi-choice**: Checkbox group (all include "Other - describe below")
- **free-text**: Text input or textarea

Every form includes a **Dismiss** option. If dismissed, the agent proceeds with the original prompt and existing context only.
