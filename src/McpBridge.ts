/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 Venturi-exe / VNTRCORP
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { FormViewProvider } from "./FormViewProvider.js";
import type { AlignmentFormRequest, DurablePlannerResponse } from "./types.js";
import { getIpcRoot, LIMITS } from "./core/constants.js";
import { writeJsonAtomic, readJsonSafe } from "./core/fsx.js";
import {
    getIpcDirs,
    ensureAllIpcDirs,
    writeUiHeartbeat,
    readAgentHeartbeat,
    isAgentDisconnected,
    getUiHeartbeatPath,
} from "./core/plannerIpc.js";

/**
 * Watches the IPC requests directory for planning form requests from MCP clients.
 * Implements single-form admission, non-reentrant scanning, UI activity heartbeats,
 * agent liveness tracking, and durable response retention.
 */
export class McpBridge {
    private _pollInterval: ReturnType<typeof setInterval> | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _isScanning = false;
    private _activeClaimedId: string | null = null;
    private _lastActivityWritten = 0;
    private _pendingActivityTimeout: ReturnType<typeof setTimeout> | undefined;
    private _lastAgentConnectionState = true;

    constructor(private readonly _formViewProvider: FormViewProvider) {
        this._outputChannel = vscode.window.createOutputChannel("Orbit");

        // Trailing-write activity listener from FormViewProvider
        this._formViewProvider.onUserActivity((requestId, timeoutMs) => {
            this._handleUserActivity(requestId, timeoutMs);
        });
    }

    private _handleUserActivity(requestId: string, timeoutMs: number): void {
        if (!this._activeClaimedId || this._activeClaimedId !== requestId) {
            return;
        }

        const now = Date.now();
        const root = getIpcRoot();

        const performWrite = () => {
            this._lastActivityWritten = Date.now();
            writeUiHeartbeat(root, {
                requestId,
                origin: "antigravity",
                claimedAt: this._lastActivityWritten,
                lastUserActivityAt: this._lastActivityWritten,
                inactivityTimeoutMs: timeoutMs,
            }).catch(() => { /* ignore */ });
        };

        if (now - this._lastActivityWritten >= LIMITS.PLANNER_UI_HEARTBEAT_THROTTLE_MS) {
            if (this._pendingActivityTimeout) {
                clearTimeout(this._pendingActivityTimeout);
                this._pendingActivityTimeout = undefined;
            }
            performWrite();
        } else {
            // Schedule trailing write so the final keystroke is not lost
            if (!this._pendingActivityTimeout) {
                const delay = LIMITS.PLANNER_UI_HEARTBEAT_THROTTLE_MS - (now - this._lastActivityWritten);
                this._pendingActivityTimeout = setTimeout(() => {
                    this._pendingActivityTimeout = undefined;
                    performWrite();
                }, Math.max(100, delay));
            }
        }
    }

    /**
     * Starts watching for planning request files.
     */
    public async start(): Promise<void> {
        const root = getIpcRoot();
        await ensureAllIpcDirs(root);

        this._outputChannel.appendLine("Orbit IPC v2: Watching for planning requests with single admission...");
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
        if (this._pendingActivityTimeout) {
            clearTimeout(this._pendingActivityTimeout);
            this._pendingActivityTimeout = undefined;
        }
    }

    /**
     * Scans the requests directory with non-reentrant admission and single active form control.
     */
    private async _checkForRequests(): Promise<void> {
        if (this._isScanning) return;
        this._isScanning = true;

        const root = getIpcRoot();
        const dirs = getIpcDirs(root);

        try {
            // 1. Agent liveness check on active form
            if (this._activeClaimedId) {
                const heartbeat = await readAgentHeartbeat(root, this._activeClaimedId);
                const isDisconnected = isAgentDisconnected(heartbeat);
                const isConnected = !isDisconnected;
                if (isConnected !== this._lastAgentConnectionState) {
                    this._lastAgentConnectionState = isConnected;
                    this._formViewProvider.setAgentConnectionStatus(this._activeClaimedId, isConnected);
                }
            }

            let files: string[];
            try {
                files = (await fs.promises.readdir(dirs.requests)).filter((f) => f.endsWith(".json"));
            } catch {
                return;
            }

            for (const file of files) {
                const requestId = file.replace(".json", "");
                const requestPath = path.join(dirs.requests, file);
                const claimedPath = path.join(dirs.claimed, file);

                // Single-Form Admission Gate: Reject subsequent requests if a form is already active
                if (this._activeClaimedId && this._activeClaimedId !== requestId) {
                    try {
                        await fs.promises.unlink(requestPath);
                        const failedPath = path.join(dirs.failed, file);
                        await writeJsonAtomic(failedPath, {
                            requestId,
                            error: "orbit.planner_busy: Another form is currently active in Orbit Planner. Please wait until it is submitted or dismissed.",
                        });
                        this._outputChannel.appendLine(`Orbit IPC v2: Rejected request ${requestId} (planner busy with ${this._activeClaimedId})`);
                    } catch { /* ignore */ }
                    continue;
                }

                // If already active with this form, do not claim again
                if (this._activeClaimedId) {
                    continue;
                }

                try {
                    // IPC v2: Atomic claim via rename
                    try {
                        await fs.promises.rename(requestPath, claimedPath);
                    } catch {
                        // Already claimed or cancelled
                        continue;
                    }

                    this._activeClaimedId = requestId;
                    this._lastAgentConnectionState = true;

                    const request = await readJsonSafe<AlignmentFormRequest>(claimedPath);
                    this._outputChannel.appendLine(
                        `Orbit IPC v2: Claimed request ${request.requestId} "${request.title}" (origin: ${request.origin || "antigravity"})`
                    );

                    // Check if cancelled before showing form
                    const cancelledPath = path.join(dirs.cancelled, file);
                    if (fs.existsSync(cancelledPath)) {
                        try { await fs.promises.unlink(claimedPath); } catch { /* ok */ }
                        try { await fs.promises.unlink(cancelledPath); } catch { /* ok */ }
                        this._activeClaimedId = null;
                        this._outputChannel.appendLine(`Orbit IPC v2: Request ${request.requestId} was cancelled.`);
                        continue;
                    }

                    // Write initial UI heartbeat
                    const initialTimeoutMs = this._formViewProvider.getInactivityTimeoutMs();
                    this._lastActivityWritten = Date.now();
                    await writeUiHeartbeat(root, {
                        requestId: request.requestId,
                        origin: request.origin || "antigravity",
                        claimedAt: this._lastActivityWritten,
                        lastUserActivityAt: this._lastActivityWritten,
                        inactivityTimeoutMs: initialTimeoutMs,
                    });

                    // Launch async form processing without blocking the scanner interval
                    void this._processActiveForm(request, claimedPath, file, dirs, root);

                    // Break loop after admitting one form; subsequent scans monitor this form and reject new requests
                    break;
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    this._outputChannel.appendLine(`Orbit IPC v2 Error claiming ${file}: ${message}`);

                    // Write failure marker for client
                    try {
                        const failedPath = path.join(dirs.failed, file);
                        await writeJsonAtomic(failedPath, { requestId, error: message });
                        if (fs.existsSync(claimedPath)) {
                            await fs.promises.unlink(claimedPath);
                        }
                    } catch { /* ignore */ }
                    this._activeClaimedId = null;
                }
            }
        } finally {
            this._isScanning = false;
        }
    }

    /**
     * Handles webview form display, completion, response writing, and cleanup asynchronously.
     * Keeps _activeClaimedId set until terminal response is written.
     */
    private async _processActiveForm(
        request: AlignmentFormRequest,
        claimedPath: string,
        file: string,
        dirs: ReturnType<typeof getIpcDirs>,
        root: string
    ): Promise<void> {
        try {
            // Show the form in the webview
            const result = await this._formViewProvider.showForm(request);

            // Write durable response file atomically
            const response: DurablePlannerResponse = {
                requestId: request.requestId,
                action: result.action,
                dismissed: result.dismissed,
                data: result.data,
                clarificationRequest: result.clarificationRequest,
                specificClarifications: result.specificClarifications,
                partialAnswers: result.partialAnswers,
                completedAt: Date.now(),
                origin: request.origin || "antigravity",
            };

            const responsePath = path.join(dirs.responses, file);
            await writeJsonAtomic(responsePath, response);

            // Clean up claimed marker and UI heartbeat
            try { await fs.promises.unlink(claimedPath); } catch { /* ok */ }
            try {
                const uiHeartbeatPath = getUiHeartbeatPath(root, request.requestId);
                if (fs.existsSync(uiHeartbeatPath)) {
                    await fs.promises.unlink(uiHeartbeatPath);
                }
            } catch { /* ok */ }

            this._outputChannel.appendLine(
                `Orbit IPC v2: Durable response delivered for ${request.requestId} (action: ${result.action})`
            );

            // If user submitted while disconnected, notify user in editor
            if (!this._lastAgentConnectionState && result.action !== "dismiss" && result.action !== "timeout") {
                vscode.window.showInformationMessage(
                    `Orbit Planner: Saved responses for "${request.title}". Resume your conversation to continue.`
                );
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this._outputChannel.appendLine(`Orbit IPC v2 Error processing form ${file}: ${message}`);

            try {
                const failedPath = path.join(dirs.failed, file);
                await writeJsonAtomic(failedPath, { requestId: request.requestId, error: message });
                if (fs.existsSync(claimedPath)) {
                    await fs.promises.unlink(claimedPath);
                }
            } catch { /* ignore */ }
        } finally {
            this._activeClaimedId = null;
        }
    }
}
