# Antigravity Alignment

Pre-execution alignment panel for AI agents in the Antigravity IDE.

## What It Does

Before writing or modifying any file, the agent submits a form to confirm intent, surface better approaches, and get explicit approval. The form appears in the sidebar panel.

## When the Agent Submits a Form

- A new feature or page is being built
- Any existing file, component, style, or behavior is being modified
- The task is ambiguous or missing required detail
- The agent identifies a better implementation than what was asked
- A change has side effects on other parts of the project
- Multiple valid approaches exist and the choice affects structure or output

## When No Form Appears

The agent proceeds immediately when all of the following are true:
- The task is fully specified with no missing information
- No ambiguity exists about the intended output
- No better implementation approach exists worth surfacing
- No side effects on other parts of the project

## Installation

1. Download the `.vsix` file from Releases
2. In Antigravity/VS Code: Extensions > ... > Install from VSIX
3. Add the MCP server to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "antigravity-alignment": {
      "command": "node",
      "args": ["<path-to-extension>/out/mcp-server/index.js"]
    }
  }
}
```

## Field Types

- **single-choice**: Radio group (all include "Other - describe below")
- **multi-choice**: Checkbox group (all include "Other - describe below")
- **free-text**: Text input or textarea

## Dismiss

Every form includes a dismiss option. If dismissed, the agent proceeds with the original prompt and existing context only.

## Development

```bash
npm install
npm run compile
# Press F5 to launch Extension Development Host
# Ctrl+Shift+P > "Interactive Forms: Test Alignment"
```
