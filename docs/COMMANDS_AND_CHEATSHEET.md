# Orbit Commands and Cheatsheet

## Assistant chat phrases

These phrases depend on the assistant rules installed by Orbit or your custom integration. They are not VS Code Command Palette IDs.

| Phrase | Purpose |
| --- | --- |
| `@brain <topic>` | Retrieve mapped facts, features, tasks, and sessions for the relevant project. |
| `update memory system` | Summarize the session, synchronize project memory and its index, and preserve a source-linked timeline. |
| `@trigger deep prompt refining` | Start iterative planner forms and refine the plan until **Execute Plan** is selected. |

For the complete initial setup prompt, see [Orbit Brain Setup](ORBIT_BRAIN_SETUP.md).

## Setup, repair, and removal

Open the Command Palette with `Ctrl+Shift+P` and search for the displayed title.

| Command ID | Displayed title | Purpose |
| --- | --- | --- |
| `orbit.setup` | Orbit: Run Setup Wizard | Choose assistant rules integration and MCP runtime registration. |
| `orbit.repair` | Orbit: Repair Configuration | Refresh the server registration and repair configured rules. Manual integration mode is respected. |
| `orbit.showSpecification` | Orbit: View Integration Specification | Open tool contracts for a custom assistant prompt. |
| `orbit.copySpecification` | Orbit: Copy Specification to Clipboard | Copy the integration specification. |
| `orbit.copySnippet` | Orbit: Copy Assistant Rules to Clipboard | Copy the standard assistant rules. |
| `orbit.removeIntegration` | Orbit: Remove Integration | Choose whether to keep or archive memory, restore a rules backup, or explicitly purge data. |

## Orbit Planner and panel commands

| Command ID | Displayed title |
| --- | --- |
| `orbit.showPanel` | Orbit: Show Panel |
| `orbit.openSettings` | Orbit: Open Settings |
| `orbit.openMainTab` | Orbit: Maximize Panel View |
| `orbit.openMainTabPlanner` | Orbit: Open Planner in Main Tab |
| `orbit.openMainTabCartograph` | Orbit: Open Cartograph in Main Tab |
| `orbit.openHub` | Orbit: Open Cartograph Hub |

Planner forms support **Submit**, **Dismiss**, clarification requests, and optionally **Execute Plan**. A pending tool response leaves the form active. For the bundled MCP transport, continue with `orbit_planner({ resumeRequestId: "<requestId>" })`. The separate France Student bridge uses `orbit_planner_poll` with waits from 1 to 15 seconds.

## Orbit Cartograph actions

- Submit impact mapping through `write_impact_report`, including the owning project, changed file paths, and reasons.
- Select a report in Cartograph, then select a node to inspect its file change or task details.
- Open Orbit Hub to browse projects, search reports, compare selections, and inspect timelines.
- Review confirmation prompts for report removal, moves, and merges. Deletion routes reports through recoverable trash.
- Open Settings to adjust planner inactivity thresholds, diagram zoom sensitivity, and detail panel height.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `orbit_planner` | Create or resume a planning form. |
| `orbit_memory` | Read or manage project memory and Cartograph reports through the supported action schema. |
| `write_impact_report` | Record file changes and planning context for visual inspection. |

## Development demos

`orbit.testPlanner` and `orbit.testCartograph` are development commands for planner and Cartograph demos. Their Command Palette entries appear only in development mode.
