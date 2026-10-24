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
import { FormViewProvider } from "./FormViewProvider.js";
import type { AlignmentFormRequest, AlignmentFormResponse } from "./types.js";
import { getIpcRoot, IPC_DIRS } from "./core/constants.js";
import { ensureDirSafe, writeJsonAtomic, readJsonSafe } from "./core/fsx.js";

/**
 * Watches the IPC requests directory for planning form requests from the MCP server.
 * Implements IPC v2 atomic claiming, cancellation, and response delivery.
 */
export class McpBridge {
    private _pollInterval: ReturnType<typeof setInterval> | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _processing = new Set<string>();

    constructor(private readonly _formViewProvider: FormViewProvider) {
        this._outputChannel = vscode.window.createOutputChannel("Orbit");
    }

    private get _dirs() {
        const root = getIpcRoot();
        return {
            requests: path.join(root, IPC_DIRS.REQUESTS),
            claimed: path.join(root, IPC_DIRS.CLAIMED),
            cancelled: path.join(root, IPC_DIRS.CANCELLED),
            responses: path.join(root, IPC_DIRS.RESPONSES),
            failed: path.join(root, IPC_DIRS.FAILED),
        };
    }

    /**
     * Starts watching for planning request files.
     */
    public async start(): Promise<void> {
        const dirs = this._dirs;
        await ensureDirSafe(dirs.requests);
        await ensureDirSafe(dirs.claimed);
        await ensureDirSafe(dirs.cancelled);
        await ensureDirSafe(dirs.responses);
        await ensureDirSafe(dirs.failed);

        this._outputChannel.appendLine("Orbit IPC v2: Watching for planning requests...");
        this._pollInterval = setInterval(() => this._checkForRequests(), 500);
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
     * Scans the requests directory for new form request files and atomically claims them.
     */
    private async _checkForRequests(): Promise<void> {
        const dirs = this._dirs;
        let files: string[];
        try {
            files = (await fs.promises.readdir(dirs.requests)).filter((f) => f.endsWith(".json"));
        } catch {
            return;
        }

        for (const file of files) {
            const requestId = file.replace(".json", "");

            if (this._processing.has(requestId)) continue;
            this._processing.add(requestId);

            const requestPath = path.join(dirs.requests, file);
            const claimedPath = path.join(dirs.claimed, file);

            try {
                // IPC v2: Atomic claim via rename
                try {
                    await fs.promises.rename(requestPath, claimedPath);
                } catch {
                    // Already claimed or cancelled
                    this._processing.delete(requestId);
                    continue;
                }

                const request = await readJsonSafe<AlignmentFormRequest>(claimedPath);
                this._outputChannel.appendLine(
                    `Orbit IPC v2: Claimed request ${request.requestId} "${request.title}"`
                );

                // Check if cancelled before showing form
                const cancelledPath = path.join(dirs.cancelled, file);
                if (fs.existsSync(cancelledPath)) {
                    try { await fs.promises.unlink(claimedPath); } catch { /* ok */ }
                    try { await fs.promises.unlink(cancelledPath); } catch { /* ok */ }
                    this._outputChannel.appendLine(`Orbit IPC v2: Request ${request.requestId} was cancelled.`);
                    continue;
                }

                // Show the form in the webview
                const result = await this._formViewProvider.showForm(request);

                // Write response file atomically
                const response: AlignmentFormResponse = {
                    requestId: request.requestId,
                    action: result.action,
                    dismissed: result.dismissed,
                    data: result.data,
                    clarificationRequest: result.clarificationRequest,
                    specificClarifications: result.specificClarifications,
                    partialAnswers: result.partialAnswers,
                };

                const responsePath = path.join(dirs.responses, file);
                await writeJsonAtomic(responsePath, response);

                // Clean up claimed file after response delivery
                try {
                    await fs.promises.unlink(claimedPath);
                } catch { /* ok */ }

                this._outputChannel.appendLine(
                    `Orbit IPC v2: Response delivered for ${request.requestId} (action: ${result.action})`
                );
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                this._outputChannel.appendLine(`Orbit IPC v2 Error processing ${file}: ${message}`);

                // Write failure marker for client
                try {
                    const failedPath = path.join(dirs.failed, file);
                    await writeJsonAtomic(failedPath, { requestId, error: message });
                    if (fs.existsSync(claimedPath)) {
                        await fs.promises.unlink(claimedPath);
                    }
                } catch { /* ignore */ }
            } finally {
                this._processing.delete(requestId);
            }
        }
    }
}
