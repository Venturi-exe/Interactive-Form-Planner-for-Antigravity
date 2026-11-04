# Orbit

Orbit brings planning forms, visual change reports, and persistent project memory to Antigravity IDE.

Publisher: **VNTRCORP**. Extension ID: **VNTRCORP.orbit**. Release: **0.4.1**.

## Orbit 0.4.1

- **Interactive Setup Wizard**: choose whether to append Orbit rules, replace them after a backup, or integrate manually. Configure the bundled MCP server through the same workflow.
- **Bounded Planner Slices**: keep forms open across short tool calls, track user and agent activity, and retain submitted answers for retries.
- **Orbit Cartograph and Orbit Hub**: inspect file changes, decisions, project reports, and timelines in the sidebar or an editor panel.
- **Sidebar and settings fixes**: preserve navigation after timeout or clarification, restore settings scrolling, and remove obsolete quota controls.
- **Consistent project keys**: use `_default` for unassigned work and read historical default aliases without renaming existing folders.

## Install Orbit

### Open VSX

1. Open Extensions in Antigravity with `Ctrl+Shift+X`.
2. Search for `VNTRCORP.orbit` and select **Orbit**.
3. Install the extension and follow the setup wizard.

[View Orbit on Open VSX](https://open-vsx.org/extension/VNTRCORP/orbit).

### Manual VSIX

1. Obtain `orbit-0.4.1.vsix` from the release package.
2. Open Extensions, select the `...` menu, then **Install from VSIX**.
3. Select the package and reload Antigravity when prompted.
4. Run **Orbit: Run Setup Wizard** if setup has not completed.

The extension preserves custom assistant instructions when you choose append or manual integration. Review the wizard's choices before replacing an existing rules file.

## Orbit Planner

The bundled `orbit` MCP server exposes `orbit_planner`, `orbit_memory`, and `write_impact_report`. Orbit Planner displays single-choice, multiple-choice, and text fields for decisions that need user input.

Calls use bounded waiting slices. If a reply contains `action: "pending"`, continue the same request with `orbit_planner({ resumeRequestId })`. A pending reply is not permission to start dependent changes. Submitted answers remain available for 30 minutes.

Use `@trigger deep prompt refining` to request iterative planning with the **Execute Plan** button. Follow the active assistant's rules for clarification, timeout, and cancellation.

## Orbit Cartograph and Orbit Hub

Cartograph maps file changes and their reasons. Select a report or graph node to inspect paths, decisions, planning notes, and timelines. Orbit Hub adds project browsing, search, comparison, and report operations. Report removal uses recoverable trash.

Open the Hub with **Orbit: Open Cartograph Hub**. Use **Orbit: Open Cartograph in Main Tab** for an editor view or **Orbit: Maximize Panel View** for the combined view.

## Orbit Brain

Orbit stores project context under `~/.orbit-brain/` using Layout v3:

```text
projects/<project-key>/
  cartograph/
  archive/
  memories/
    INDEX.md
    PROTOCOL.md
    sessions/
    features/
    tasks/
```

Environment recording is disabled by default. Setup and removal honor the calling editor's storage ownership so stock VS Code and Antigravity integrations can be handled separately.

- [Full Orbit Brain setup and assistant bootstrap prompt](docs/ORBIT_BRAIN_SETUP.md)
- [Commands and interaction cheatsheet](docs/COMMANDS_AND_CHEATSHEET.md)

Chat phrases such as `@brain` are assistant workflow instructions supplied by the installed rules, rather than standalone editor commands. For a custom assistant prompt, use **Orbit: View Integration Specification** or **Orbit: Copy Assistant Rules to Clipboard**.

## Development and packaging

```powershell
npm ci
npm run typecheck
npx vitest run
npx eslint src/
node esbuild.js --production
npx @vscode/vsce package --no-dependencies -o dist/orbit-0.4.1.vsix
node scripts/check-vsix.mjs dist/orbit-0.4.1.vsix
node scripts/smoke-vsix.mjs dist/orbit-0.4.1.vsix
```

The production build bundles the extension, MCP server, uninstall hook, and React webviews. `form.js` is maintained as plain JavaScript. Packaging excludes sourcemaps, tests, scripts, and personal memory data. The smoke check starts the packaged MCP server with an isolated brain directory.

## License

Orbit is licensed for personal, non-commercial use under [LICENSE.txt](LICENSE.txt). First-party attribution: **Venturi-exe / VNTRCORP**. Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
