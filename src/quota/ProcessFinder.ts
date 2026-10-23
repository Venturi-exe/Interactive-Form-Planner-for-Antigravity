/**
 * ProcessFinder: Discovers the running local Language Server process,
 * parses connection arguments, and validates workspace matching boundaries.
 */

import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { testPort, Protocol } from "./http_client";

const execAsync = promisify(exec);

export interface LanguageServerInfo {
  port: number;
  csrfToken: string;
}

export interface ProcessInfo {
  pid: number;
  ppid?: number;
  extensionPort: number;
  csrfToken: string;
  workspaceId?: string;
}

export class ProcessFinder {
  private processName: string = "language_server_windows_x64.exe";

  constructor() {
    const arch = process.arch;
    if (process.platform === "win32") {
      this.processName = "language_server_windows_x64.exe";
    } else if (process.platform === "darwin") {
      this.processName = `language_server_macos${arch === "arm64" ? "_arm" : ""}`;
    } else {
      this.processName = `language_server_linux${arch === "arm64" ? "_arm" : "_x64"}`;
    }
  }

  /**
   * Main entry point to discover and connect to a running language server
   */
  async detect(): Promise<LanguageServerInfo | null> {
    try {
      const expectedIds = this.getExpectedWorkspaceIds();
      console.log(`[ProcessFinder] Scanning for ${this.processName}. Expected Workspace IDs:`, expectedIds);

      const processListCmd = this.getProcessListCommand(this.processName);
      let stdout = "";
      try {
        const res = await execAsync(processListCmd, { timeout: 8000 });
        stdout = res.stdout;
      } catch (err) {
        console.warn("[ProcessFinder] Primary process list query failed. Attempting fallback...");
        // Fallback command: try standard tasklist or wmic on Windows
        if (process.platform === "win32") {
          try {
            const fallbackCmd = 'wmic process where "name like \'%language_server%\'" get ProcessId,ParentProcessId,CommandLine /format:csv';
            const res = await execAsync(fallbackCmd, { timeout: 8000 });
            stdout = res.stdout;
          } catch (e) {
            console.error("[ProcessFinder] Fallback process query also failed:", e);
            return null;
          }
        } else {
          return null;
        }
      }

      const processes = this.parseProcessInfo(stdout);
      if (!processes || processes.length === 0) {
        console.warn("[ProcessFinder] No matching process found in process list.");
        return null;
      }

      console.log(`[ProcessFinder] Found ${processes.length} candidate processes.`);

      // Strict Workspace Filter: Prioritize processes matching expected Workspace IDs
      for (const proc of processes) {
        if (expectedIds.length > 0 && proc.workspaceId) {
          const isMatch = expectedIds.includes(proc.workspaceId) || 
            expectedIds.some(id => id.replace(/[._-]/g, "").toLowerCase() === proc.workspaceId!.replace(/[._-]/g, "").toLowerCase());
          
          if (!isMatch) {
            console.log(`[ProcessFinder] Skipping process PID ${proc.pid} due to workspace mismatch (Process Workspace: ${proc.workspaceId}).`);
            continue;
          }
        }

        console.log(`[ProcessFinder] Validating PID ${proc.pid} with extensionPort ${proc.extensionPort}...`);
        const serverInfo = await this.verifyAndConnect(proc);
        if (serverInfo) {
          return serverInfo;
        }
      }

      // If strict filter yielded nothing, attempt connection to any discovered local LS process
      // (This handles multi-root workspace folders or cold-starts where workspace ID is not yet synced)
      for (const proc of processes) {
        console.log(`[ProcessFinder] Last resort check for generic process PID ${proc.pid}...`);
        const serverInfo = await this.verifyAndConnect(proc);
        if (serverInfo) {
          return serverInfo;
        }
      }

      return null;
    } catch (error) {
      console.error("[ProcessFinder] Error during process detection:", error);
      return null;
    }
  }

  private async verifyAndConnect(info: ProcessInfo): Promise<LanguageServerInfo | null> {
    let ports = await this.getListeningPorts(info.pid);

    if (info.extensionPort > 0 && !ports.includes(info.extensionPort)) {
      ports = [info.extensionPort, ...ports];
    }

    for (const port of ports) {
      const result = await testPort(
        "127.0.0.1",
        port,
        "/exa.language_server_pb.LanguageServerService/GetUserStatus",
        {
          "X-Codeium-Csrf-Token": info.csrfToken,
          "Connect-Protocol-Version": "1",
        },
        JSON.stringify({ wrapper_data: {} })
      );

      if (result.success) {
        console.log(`[ProcessFinder] Successfully verified connection on port ${port}.`);
        return {
          port,
          csrfToken: info.csrfToken,
        };
      }
    }
    return null;
  }

  private async getListeningPorts(pid: number): Promise<number[]> {
    try {
      if (process.platform === "win32") {
        const cmd = `chcp 65001 >nul && powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort; if ($p) { $p | Sort-Object -Unique }"`;
        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        return this.parsePortNumbers(stdout);
      } else {
        const cmd = `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        return this.parseUnixPorts(stdout, pid);
      }
    } catch {
      return [];
    }
  }

  private parsePortNumbers(stdout: string): number[] {
    const ports: number[] = [];
    const lines = stdout.trim().split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d+$/.test(trimmed)) {
        const port = parseInt(trimmed, 10);
        if (port > 0 && port <= 65535) {
          ports.push(port);
        }
      }
    }
    return [...new Set(ports)].sort((a, b) => a - b);
  }

  private parseUnixPorts(stdout: string, pid: number): number[] {
    const ports: number[] = [];
    const pidStr = String(pid);
    const lines = stdout.split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1] === pidStr) {
        const portMatch = line.match(/(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/i);
        if (portMatch) {
          ports.push(parseInt(portMatch[1], 10));
        }
      }
    }
    return [...new Set(ports)].sort((a, b) => a - b);
  }

  private getProcessListCommand(processName: string): string {
    if (process.platform === "win32") {
      const script = `
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
        $n = '${processName}';
        $f = 'name=''' + $n + '''';
        $p = Get-CimInstance Win32_Process -Filter $f -ErrorAction SilentlyContinue;
        if ($p) { @($p) | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress } else { '[]' }
      `.replace(/\n\s+/g, " ").trim();
      return `chcp 65001 >nul && powershell -ExecutionPolicy Bypass -NoProfile -Command "${script}"`;
    } else {
      const grepPattern = processName.length > 0 ? `[${processName[0]}]${processName.slice(1)}` : processName;
      return `ps -A -ww -o pid,ppid,args | grep "${grepPattern}"`;
    }
  }

  private parseProcessInfo(stdout: string): ProcessInfo[] | null {
    try {
      const trimmed = stdout.trim();
      if (!trimmed) return null;

      // 1. JSON Parsing (Windows PowerShell)
      if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.includes("ProcessId")) {
        const firstBracket = trimmed.indexOf("[");
        const firstBrace = trimmed.indexOf("{");
        let jsonStr = trimmed;
        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
          jsonStr = trimmed.substring(firstBracket);
        } else if (firstBrace !== -1) {
          jsonStr = trimmed.substring(firstBrace);
        }

        if (jsonStr.startsWith("[") || jsonStr.startsWith("{")) {
          const data = JSON.parse(jsonStr);
          const processList = Array.isArray(data) ? data : [data];
          const results: ProcessInfo[] = [];

          for (const item of processList) {
            const commandLine = item.CommandLine || "";
            const pid = item.ProcessId;
            const ppid = item.ParentProcessId;

            if (!pid) continue;

            const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
            const tokenMatch = commandLine.match(/--csrf_token[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);
            const wsMatch = commandLine.match(/--workspace_id[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);

            if (tokenMatch?.[1]) {
              // Ensure process is an Antigravity/Codeium related language server
              if (!commandLine.includes("--app_data_dir") || !/app_data_dir\s+["']?antigravity/i.test(commandLine)) {
                continue;
              }

              results.push({
                pid,
                ppid,
                extensionPort: portMatch?.[1] ? parseInt(portMatch[1], 10) : 0,
                csrfToken: tokenMatch[1],
                workspaceId: wsMatch?.[1],
              });
            }
          }
          return results.length > 0 ? results : null;
        }
      }

      // 2. CSV WMIC Parsing
      if (stdout.includes("CommandLine") && stdout.includes("ProcessId")) {
        const lines = stdout.trim().split("\n");
        const results: ProcessInfo[] = [];

        for (const line of lines) {
          const row = line.trim();
          if (!row || row.startsWith("Node,")) continue;

          if (!row.includes("--extension_server_port")) continue;

          const idsMatch = row.match(/,(\d+),(\d+)\s*$/);
          if (!idsMatch) continue;

          const ppid = parseInt(idsMatch[1], 10);
          const pid = parseInt(idsMatch[2], 10);
          const commandLine = row;

          const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
          const tokenMatch = commandLine.match(/--csrf_token[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);
          const wsMatch = commandLine.match(/--workspace_id[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);

          if (tokenMatch?.[1]) {
            if (!commandLine.includes("--app_data_dir") || !/app_data_dir\s+["']?antigravity/i.test(commandLine)) {
              continue;
            }

            results.push({
              pid,
              ppid,
              extensionPort: portMatch?.[1] ? parseInt(portMatch[1], 10) : 0,
              csrfToken: tokenMatch[1],
              workspaceId: wsMatch?.[1],
            });
          }
        }
        return results.length > 0 ? results : null;
      }

      // 3. Unix `ps` Parsing
      const lines = trimmed.split("\n");
      const results: ProcessInfo[] = [];
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (match) {
          const pid = parseInt(match[1], 10);
          const ppid = parseInt(match[2], 10);
          const cmd = match[3];

          if (cmd.includes("--extension_server_port")) {
            const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/);
            const tokenMatch = cmd.match(/--csrf_token[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);
            const wsMatch = cmd.match(/--workspace_id[=\s]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);

            if (tokenMatch?.[1]) {
              if (!cmd.includes("--app_data_dir") || !/app_data_dir\s+["']?antigravity/i.test(cmd)) {
                continue;
              }

              results.push({
                pid,
                ppid,
                extensionPort: portMatch ? parseInt(portMatch[1], 10) : 0,
                csrfToken: tokenMatch[1],
                workspaceId: wsMatch?.[1],
              });
            }
          }
        }
      }
      return results.length > 0 ? results : null;

    } catch (e) {
      console.error("[ProcessFinder] Error parsing process info:", e);
      return null;
    }
  }

  private getExpectedWorkspaceIds(): string[] {
    const folders = vscode.workspace.workspaceFolders || [];
    const ids = folders.map((folder) => {
      const rootPath = folder.uri.fsPath;
      if (process.platform === "win32") {
        return this.normalizeWindowsPath(rootPath);
      } else {
        return this.normalizeUnixPath(rootPath);
      }
    });

    const workspaceFile = vscode.workspace.workspaceFile;
    if (workspaceFile && workspaceFile.scheme === 'file') {
      const fsPath = workspaceFile.fsPath;
      const id = process.platform === "win32" ? this.normalizeWindowsPath(fsPath) : this.normalizeUnixPath(fsPath);
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  private normalizeWindowsPath(path: string): string {
    const driveMatch = path.match(/^([A-Za-z]):(.*)/);
    if (!driveMatch) {
      return this.normalizeUnixPath(path);
    }

    const driveLetter = driveMatch[1].toLowerCase();
    const restOfPath = driveMatch[2];

    const segments = restOfPath.split(/[\\/]/);
    const encodedSegments = segments
      .filter((s) => s.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join("_");

    const normalizedRest = encodedSegments.replace(/[^a-zA-Z0-9]/g, "_");
    return `file_${driveLetter}_3A_${normalizedRest}`;
  }

  private normalizeUnixPath(path: string): string {
    const normalizedSlashes = path.replace(/\\/g, "/");
    const urlEncoded = normalizedSlashes
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const normalizedPath = urlEncoded
      .replace(/^[^a-zA-Z0-9]+/, "")
      .replace(/[^a-zA-Z0-9]+$/, "")
      .replace(/[^a-zA-Z0-9]/g, "_");

    return `file_${normalizedPath}`;
  }
}
