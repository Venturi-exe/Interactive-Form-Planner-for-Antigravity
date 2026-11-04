/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 Venturi-exe / VNTRCORP
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

/**
 * Producer origin indicating which client generated the request.
 */
export type PlannerProducerOrigin = "antigravity" | "france_student" | "unknown";

/**
 * Field types supported by the alignment form.
 */
export type AlignmentFieldType = "single-choice" | "multi-choice" | "free-text";

/**
 * A single field in an alignment form.
 * Choice fields auto-append "Other - describe below" in the webview.
 */
export interface AlignmentField {
    id: string;
    label: string;
    type: AlignmentFieldType;
    options?: string[];
    required?: boolean;
    placeholder?: string;
}

/**
 * A form request from the MCP server to the extension.
 */
export interface AlignmentFormRequest {
    requestId: string;
    title: string;
    description?: string;
    fields: AlignmentField[];
    showExecuteButton?: boolean;
    origin?: PlannerProducerOrigin;
}

/**
 * The action the user took on the form.
 */
export type FormAction = "submit" | "execute" | "dismiss" | "clarification" | "timeout";

/**
 * MCP tool action union (including non-terminal "pending" slice continuation).
 */
export type PlannerToolAction = FormAction | "pending";

/**
 * The result returned by the FormViewProvider after user interaction.
 */
export interface FormResult {
    action: FormAction;
    dismissed: boolean;
    data: Record<string, unknown>;
    clarificationRequest?: string;
    specificClarifications?: Array<{ fieldId: string; question: string; clarificationQuery: string }>;
    partialAnswers?: Record<string, unknown>;
}

/**
 * A form response written to disk for the MCP server to read.
 */
export interface AlignmentFormResponse {
    requestId: string;
    action: FormAction;
    dismissed: boolean;
    data: Record<string, unknown>;
    clarificationRequest?: string;
    specificClarifications?: Array<{ fieldId: string; question: string; clarificationQuery: string }>;
    partialAnswers?: Record<string, unknown>;
    message?: string;
    completedAt?: number;
    origin?: PlannerProducerOrigin;
}

/**
 * Durable response retained immutably in responses/{requestId}.json for idempotent recovery.
 */
export interface DurablePlannerResponse extends AlignmentFormResponse {
    completedAt: number;
    origin: PlannerProducerOrigin;
}

/**
 * UI interaction heartbeat written to events/{requestId}.ui.json.
 */
export interface PlannerUiHeartbeat {
    requestId: string;
    origin: PlannerProducerOrigin;
    claimedAt: number;
    lastUserActivityAt: number;
    inactivityTimeoutMs: number;
}

/**
 * Agent polling heartbeat written to events/{requestId}.agent.json.
 */
export interface PlannerAgentHeartbeat {
    requestId: string;
    origin: PlannerProducerOrigin;
    lastPollAt: number;
    state: "polling" | "between_slices" | "aborted";
}

/**
 * Structured planning context gathered from the agent's work.
 */
export interface PlanningContext {
    questionsAsked?: string[];
    userDecisions?: Array<{ question: string; answer: string }>;
    assumptions?: string[];
    roadmap?: string[];
    outOfScope?: string[];
    notes?: string;
}

/**
 * Describes a single file change inside an impact report.
 */
export interface ImpactChange {
    filePath: string;
    changeType: "edited" | "moved" | "deleted" | "created";
    promptExcerpt: string;
    alignmentToolOutput: Record<string, unknown> | null;
    description?: string; // what the agent actually changed and why
}

/**
 * A single entry in a merged report's chronological timeline.
 * Each entry represents one original report that was merged.
 */
export interface MergedTimelineEntry {
    taskId: string;
    timestamp: string;
    summary: string;
    changes: ImpactChange[];
    planningContext?: PlanningContext;
    tags?: string[];
}

/**
 * A complete impact report for a completed task.
 */
export interface ImpactReport {
    taskId: string;
    timestamp: string;
    summary: string;
    changes: ImpactChange[];
    sessionId?: string;
    projectName?: string;
    planningContext?: PlanningContext;
    /** True if this report was created by merging multiple reports. */
    isMerged?: boolean;
    /** Task IDs of the original reports that were merged into this one. */
    mergedFrom?: string[];
    /** Chronological timeline of original tasks, oldest first. */
    timeline?: MergedTimelineEntry[];
    tags?: string[];
    filename?: string;
}
