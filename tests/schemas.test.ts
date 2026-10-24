import { describe, it, expect } from "vitest";
import {
    ImpactReportSchema,
    PlannerRequestSchema,
    PlannerResponseSchema,
    FormWebviewMessageSchema,
    HubWebviewMessageSchema,
} from "../src/core/schemas.js";

describe("schemas validation", () => {
    it("ImpactReportSchema validates valid report", () => {
        const validReport = {
            taskId: "task-123",
            sessionId: "session-456",
            summary: "Fixed path containment bug",
            timestamp: new Date().toISOString(),
            changes: [
                {
                    filePath: "src/core/paths.ts",
                    changeType: "edited" as const,
                    description: "Added resolveInside check",
                },
            ],
            planningContext: {
                notes: "Walkthrough notes here",
                roadmap: ["Step 1", "Step 2"],
            },
        };

        const parsed = ImpactReportSchema.parse(validReport);
        expect(parsed.taskId).toBe("task-123");
        expect(parsed.changes.length).toBe(1);
        expect(parsed.changes[0].changeType).toBe("edited");
        expect(parsed.isMerged).toBe(false);
    });

    it("ImpactReportSchema rejects invalid changeType", () => {
        const invalidReport = {
            taskId: "task-123",
            summary: "Invalid test",
            timestamp: new Date().toISOString(),
            changes: [
                {
                    filePath: "src/file.ts",
                    changeType: "hacked",
                },
            ],
        };

        expect(() => ImpactReportSchema.parse(invalidReport)).toThrow();
    });

    it("PlannerRequestSchema validates valid form request", () => {
        const validRequest = {
            requestId: "req-1",
            title: "Select framework",
            description: "Choose web framework",
            fields: [
                {
                    id: "framework",
                    label: "Framework",
                    type: "single-choice" as const,
                    options: ["React", "Vue", "Svelte"],
                    required: true,
                },
            ],
        };

        const parsed = PlannerRequestSchema.parse(validRequest);
        expect(parsed.requestId).toBe("req-1");
        expect(parsed.fields[0].type).toBe("single-choice");
    });

    it("PlannerResponseSchema validates valid response", () => {
        const validResponse = {
            requestId: "req-1",
            action: "submit" as const,
            data: { framework: "React" },
        };

        const parsed = PlannerResponseSchema.parse(validResponse);
        expect(parsed.action).toBe("submit");
        expect(parsed.data.framework).toBe("React");
    });

    it("FormWebviewMessageSchema validates valid messages and rejects invalid ones", () => {
        const validMsg = { type: "form_submitted", action: "submit", data: { answer: "yes" } };
        const parsed = FormWebviewMessageSchema.parse(validMsg);
        expect(parsed.type).toBe("form_submitted");

        const invalidMsg = { type: "unknown_webview_event" };
        expect(() => FormWebviewMessageSchema.parse(invalidMsg)).toThrow();
    });

    it("HubWebviewMessageSchema validates valid messages and rejects invalid ones", () => {
        const validMsg = {
            type: "hub_delete_reports",
            projectName: "orbit",
            filenames: ["rep_001.json"],
        };
        const parsed = HubWebviewMessageSchema.parse(validMsg);
        expect(parsed.type).toBe("hub_delete_reports");

        const invalidMsg = { type: "hub_delete_reports", projectName: 123 };
        expect(() => HubWebviewMessageSchema.parse(invalidMsg)).toThrow();
    });
});
