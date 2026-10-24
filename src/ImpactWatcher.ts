/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 César Vissouze (Venturi-exe / VNTR.CORP)
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { ImpactReport } from "./types.js";
import { getIpcRoot, IPC_DIRS } from "./core/constants.js";
import { ensureDirSafe, readJsonSafe } from "./core/fsx.js";

/**
 * Watches the IPC impacts directory for post-execution impact reports from the MCP server.
 * When a report file appears, reads and deletes the file, then emits the parsed report.
 */
export class ImpactWatcher {
    private _pollInterval: ReturnType<typeof setInterval> | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _processing = new Set<string>();

    constructor(private readonly _onReport: (report: ImpactReport) => void) {
        this._outputChannel = vscode.window.createOutputChannel("Orbit");
    }

    private get _impactsDir(): string {
        return path.join(getIpcRoot(), IPC_DIRS.IMPACTS);
    }

    /**
     * Starts watching for impact report files.
     */
    public async start(): Promise<void> {
        await ensureDirSafe(this._impactsDir);

        this._outputChannel.appendLine("Orbit ImpactWatcher: Watching for impact reports...");
        this._pollInterval = setInterval(() => this._checkForReports(), 1000);
    }

    /**
     * Stops watching.
     */
    public stop(): void {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = undefined;
        }
    }

    /**
     * Scans the impacts directory for new impact report files.
     */
    private async _checkForReports(): Promise<void> {
        let files: string[];
        try {
            files = (await fs.promises.readdir(this._impactsDir)).filter((f) => f.endsWith(".json"));
        } catch {
            return;
        }

        for (const file of files) {
            const fileName = path.parse(file).name;

            if (this._processing.has(fileName)) continue;
            this._processing.add(fileName);

            const filePath = path.join(this._impactsDir, file);

            try {
                const report = await readJsonSafe<ImpactReport>(filePath);

                this._outputChannel.appendLine(
                    `Orbit ImpactWatcher: Report received for task ${report.taskId} ("${report.summary}")`
                );

                // Delete the file from the inbox folder now that we have read it safely
                try {
                    await fs.promises.unlink(filePath);
                } catch { /* ok */ }

                this._onReport(report);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                this._outputChannel.appendLine(`Orbit ImpactWatcher Error processing ${file}: ${message}`);
            } finally {
                this._processing.delete(fileName);
            }
        }
    }
}
