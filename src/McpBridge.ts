import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FormViewProvider } from "./FormViewProvider.js";
import type { AlignmentFormRequest, AlignmentFormResponse } from "./types.js";

const IPC_DIR = path.join(os.homedir(), ".antigravity-forms");
const REQUESTS_DIR = path.join(IPC_DIR, "requests");
const RESPONSES_DIR = path.join(IPC_DIR, "responses");

/**
 * Watches the IPC requests directory for alignment form requests from the MCP server.
 * When a request file appears, renders the form via FormViewProvider and writes
 * the response back to the responses directory for the MCP server to pick up.
 */
export class McpBridge {
    private _pollInterval: ReturnType<typeof setInterval> | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _processing = new Set<string>();

    constructor(private readonly _formViewProvider: FormViewProvider) {
        this._outputChannel = vscode.window.createOutputChannel("Alignment");
    }

    /**
     * Starts watching for alignment request files.
     */
    public start(): void {
        fs.mkdirSync(REQUESTS_DIR, { recursive: true });
        fs.mkdirSync(RESPONSES_DIR, { recursive: true });

        this._outputChannel.appendLine("Watching for alignment requests...");
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
     * Scans the requests directory for new form request files.
     */
    private async _checkForRequests(): Promise<void> {
        let files: string[];
        try {
            files = fs.readdirSync(REQUESTS_DIR).filter((f) => f.endsWith(".json"));
        } catch {
            return;
        }

        for (const file of files) {
            const requestId = file.replace(".json", "");

            // Skip if already being processed
            if (this._processing.has(requestId)) continue;
            this._processing.add(requestId);

            const filePath = path.join(REQUESTS_DIR, file);

            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const request: AlignmentFormRequest = JSON.parse(content);

                this._outputChannel.appendLine(
                    `Alignment request: ${request.requestId} "${request.title}"`
                );

                // Delete the request file now that we have it in memory
                try {
                    fs.unlinkSync(filePath);
                } catch {
                    /* ok */
                }

                // Show the form and wait for user interaction
                const result = await this._formViewProvider.showForm(request);

                // Write response file for the MCP server
                const response: AlignmentFormResponse = {
                    requestId: request.requestId,
                    action: result.action,
                    dismissed: result.dismissed,
                    data: result.data,
                };

                const responsePath = path.join(RESPONSES_DIR, `${request.requestId}.json`);
                fs.writeFileSync(responsePath, JSON.stringify(response, null, 2));

                this._outputChannel.appendLine(
                    `Response written: ${request.requestId} (dismissed: ${result.dismissed})`
                );
            } catch (err) {
                this._outputChannel.appendLine(`Error processing ${file}: ${err}`);
            } finally {
                this._processing.delete(requestId);
            }
        }
    }
}
