import { z } from "zod";

// File change types supported in Impact Reports
export const FileChangeTypeSchema = z.enum(["created", "edited", "deleted", "moved"]);
export type FileChangeType = z.infer<typeof FileChangeTypeSchema>;

// Individual file change inside an Impact Report
export const FileChangeSchema = z.object({
    filePath: z.string().min(1),
    changeType: FileChangeTypeSchema,
    promptExcerpt: z.string().optional().default(""),
    description: z.string().optional().default(""),
    alignmentToolOutput: z.record(z.any()).nullable().optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

// User decision in alignment
export const UserDecisionSchema = z.object({
    question: z.string(),
    answer: z.string(),
});
export type UserDecision = z.infer<typeof UserDecisionSchema>;

// Structured planning context captured during alignment and execution
export const PlanningContextSchema = z.object({
    notes: z.string().optional().default(""),
    roadmap: z.array(z.string()).optional().default([]),
    assumptions: z.array(z.string()).optional().default([]),
    userDecisions: z.array(UserDecisionSchema).optional().default([]),
    questionsAsked: z.array(z.string()).optional().default([]),
    outOfScope: z.array(z.string()).optional().default([]),
});
export type PlanningContext = z.infer<typeof PlanningContextSchema>;

// Merged timeline entry
export const TimelineEntrySchema = z.object({
    taskId: z.string(),
    timestamp: z.string(),
    summary: z.string(),
    changes: z.array(FileChangeSchema).optional().default([]),
    planningContext: PlanningContextSchema.optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

// Complete Impact Report schema
export const ImpactReportSchema = z.object({
    taskId: z.string().min(1),
    sessionId: z.string().optional().default(""),
    projectName: z.string().optional(),
    summary: z.string().min(1),
    timestamp: z.string().min(1),
    filename: z.string().optional(),
    isMerged: z.boolean().optional().default(false),
    mergedFrom: z.array(z.string()).optional(),
    timeline: z.array(TimelineEntrySchema).optional(),
    changes: z.array(FileChangeSchema).default([]),
    planningContext: PlanningContextSchema.optional().default({}),
});
export type ImpactReport = z.infer<typeof ImpactReportSchema>;

// Planner Form Field
export const PlannerFieldTypeSchema = z.enum(["single-choice", "multi-choice", "free-text"]);
export type PlannerFieldType = z.infer<typeof PlannerFieldTypeSchema>;

export const PlannerFieldSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: PlannerFieldTypeSchema,
    required: z.boolean().optional().default(false),
    options: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
});
export type PlannerField = z.infer<typeof PlannerFieldSchema>;

// Planner Request from Agent
export const PlannerRequestSchema = z.object({
    requestId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().default(""),
    showExecuteButton: z.boolean().optional().default(false),
    fields: z.array(PlannerFieldSchema).min(1),
});
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;

// Planner Response back to Agent
export const PlannerResponseActionSchema = z.enum(["submit", "execute", "skip", "timeout", "clarification"]);
export type PlannerResponseAction = z.infer<typeof PlannerResponseActionSchema>;

export const PlannerResponseSchema = z.object({
    requestId: z.string().min(1),
    action: PlannerResponseActionSchema.default("submit"),
    data: z.record(z.any()).optional().default({}),
    dismissed: z.boolean().optional().default(false),
    clarificationRequest: z.string().optional(),
});
export type PlannerResponse = z.infer<typeof PlannerResponseSchema>;

// Form Webview Incoming Message Schema
export const FormWebviewMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("webview_ready") }),
    z.object({ type: z.literal("restore_sidebar") }),
    z.object({ type: z.literal("open_hub") }),
    z.object({ type: z.literal("tab_changed"), tab: z.string().optional() }),
    z.object({ type: z.literal("close_report"), taskId: z.string() }),
    z.object({
        type: z.literal("delete_report"),
        taskId: z.string(),
        sessionId: z.string().optional(),
        projectName: z.string().optional(),
    }),
    z.object({ type: z.literal("interaction_reset") }),
    z.object({ type: z.literal("open_file"), filePath: z.string(), projectName: z.string().optional() }),
    z.object({ type: z.literal("open_receipt"), projectName: z.string().optional(), taskId: z.string() }),
    z.object({ type: z.literal("open_walkthrough"), projectName: z.string().optional(), taskId: z.string() }),
    z.object({ type: z.literal("form_timeout") }),
    z.object({ type: z.literal("form_clarification"), question: z.string().optional() }),
    z.object({
        type: z.literal("form_submitted"),
        action: z.enum(["submit", "execute", "clarification", "timeout", "dismiss"]).optional(),
        data: z.record(z.any()).optional().default({}),
        clarificationRequest: z.string().optional(),
    }),
    z.object({
        type: z.literal("form_executed"),
        data: z.record(z.any()).optional().default({}),
    }),
    z.object({ type: z.literal("form_dismissed") }),
]);
export type FormWebviewMessage = z.infer<typeof FormWebviewMessageSchema>;

// Hub Webview Incoming Message Schema
export const HubWebviewMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("hub_ready") }),
    z.object({
        type: z.literal("hub_delete_reports"),
        projectName: z.string(),
        filenames: z.array(z.string()),
    }),
    z.object({
        type: z.literal("hub_move_reports"),
        targetProject: z.string(),
        reports: z.array(z.object({ filename: z.string(), sourceProject: z.string() })).optional(),
        sourceProject: z.string().optional(),
        filenames: z.array(z.string()).optional(),
    }),
    z.object({
        type: z.literal("hub_merge_selected_reports"),
        projectName: z.string(),
        taskIds: z.array(z.string()),
    }),
    z.object({
        type: z.literal("hub_update_tags"),
        projectName: z.string(),
        taskId: z.string().optional(),
        filename: z.string().optional(),
        tags: z.array(z.string()),
        registryUpdate: z.record(z.any()),
    }),
    z.object({
        type: z.literal("hub_export_all_projects"),
    }),
    z.object({
        type: z.literal("hub_export_project"),
        projectName: z.string(),
        format: z.string().optional(),
    }),
    z.object({
        type: z.literal("hub_open_in_cartograph"),
        taskId: z.string(),
        projectName: z.string(),
    }),
]);
export type HubWebviewMessage = z.infer<typeof HubWebviewMessageSchema>;
