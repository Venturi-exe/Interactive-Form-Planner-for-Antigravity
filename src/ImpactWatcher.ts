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
import * as os from "os";
import type { ImpactReport } from "./types.js";

const IPC_DIR = path.join(os.homedir(), ".antigravity-forms");
const IMPACTS_DIR = path.join(IPC_DIR, "impacts");
const HISTORY_DIR = path.join(IMPACTS_DIR, "history");

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

    /**
     * Starts watching for impact report files.
     */
    public start(): void {
        fs.mkdirSync(IMPACTS_DIR, { recursive: true });
        fs.mkdirSync(HISTORY_DIR, { recursive: true });

        this._outputChannel.appendLine("Watching for impact reports...");
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
            files = fs.readdirSync(IMPACTS_DIR).filter((f) => f.endsWith(".json"));
        } catch {
            return;
        }

        for (const file of files) {
            const fileName = path.parse(file).name;

            // Skip if already being processed
            if (this._processing.has(fileName)) continue;
            this._processing.add(fileName);

            const filePath = path.join(IMPACTS_DIR, file);

            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const report: ImpactReport = JSON.parse(content);

                this._outputChannel.appendLine(
                    `Impact report received for task: ${report.taskId} ("${report.summary}")`
                );

                // Delete the file from the inbox folder now that we have it
                try {
                    fs.unlinkSync(filePath);
                } catch {
                    /* ok */
                }

                // Fire the callback to let the extension process it
                this._onReport(report);

            } catch (err) {
                this._outputChannel.appendLine(`Error processing impact report ${file}: ${err}`);
            } finally {
                this._processing.delete(fileName);
            }
        }
    }
}
