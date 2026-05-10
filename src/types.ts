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
}

/**
 * The action the user took on the form.
 */
export type FormAction = "submit" | "execute" | "dismiss";

/**
 * The result returned by the FormViewProvider after user interaction.
 */
export interface FormResult {
    action: FormAction;
    dismissed: boolean;
    data: Record<string, unknown>;
}

/**
 * A form response written to disk for the MCP server to read.
 */
export interface AlignmentFormResponse {
    requestId: string;
    action: FormAction;
    dismissed: boolean;
    data: Record<string, unknown>;
}
