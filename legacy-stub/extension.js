"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// legacy-stub/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var os = __toESM(require("os"));
function cleanupDeadLegacyMcpEntries(extensionId) {
  try {
    const homeDir = os.homedir();
    const candidateConfigs = [
      path.join(homeDir, ".gemini", "antigravity-ide", "mcp_config.json"),
      path.join(homeDir, ".gemini", "antigravity", "mcp_config.json")
    ];
    for (const configPath of candidateConfigs) {
      if (!fs.existsSync(configPath)) continue;
      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw);
        if (!config?.mcpServers || typeof config.mcpServers !== "object") continue;
        let modified = false;
        for (const key of ["antigravity-planner", "orbit"]) {
          const entry = config.mcpServers[key];
          if (entry?.args && Array.isArray(entry.args) && typeof entry.args[0] === "string") {
            const scriptPath = entry.args[0].toLowerCase();
            const isThisLegacyExt = scriptPath.includes(extensionId.toLowerCase()) || scriptPath.includes("antigravity-pre-execution-form-planner") || scriptPath.includes("antigravity-interactive-form-planner-planning-tool");
            if (isThisLegacyExt && !fs.existsSync(entry.args[0])) {
              delete config.mcpServers[key];
              modified = true;
            }
          }
        }
        if (modified) {
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        }
      } catch {
      }
    }
  } catch {
  }
}
function activate(context) {
  cleanupDeadLegacyMcpEntries(context.extension.id);
  const actionTakenKey = "orbit.legacyNoticeActionTaken_027";
  if (context.globalState.get(actionTakenKey)) {
    return;
  }
  const lastPromptKey = "orbit.legacyNoticeLastPrompt_027";
  const lastPrompt = context.globalState.get(lastPromptKey, 0);
  const now = Date.now();
  if (now - lastPrompt < 24 * 60 * 60 * 1e3) {
    return;
  }
  context.globalState.update(lastPromptKey, now);
  const message = "Orbit: This legacy extension is deprecated and replaced by Orbit.";
  const installOrbit = "Install Orbit";
  const uninstallThis = "Uninstall This Extension";
  vscode.window.showWarningMessage(message, installOrbit, uninstallThis).then(async (selection) => {
    if (selection === installOrbit) {
      context.globalState.update(actionTakenKey, true);
      try {
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          "VNTRCORP.orbit"
        );
        vscode.window.showInformationMessage("Orbit installed successfully.");
      } catch {
        vscode.env.openExternal(
          vscode.Uri.parse("https://open-vsx.org/extension/VNTRCORP/orbit")
        );
      }
    } else if (selection === uninstallThis) {
      context.globalState.update(actionTakenKey, true);
      cleanupDeadLegacyMcpEntries(context.extension.id);
      await vscode.commands.executeCommand(
        "workbench.extensions.uninstallExtension",
        context.extension.id
      );
    }
  });
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
