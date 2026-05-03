// @ts-nocheck
/* Antigravity Alignment - Webview Script */
/* Renders alignment forms, handles submit and dismiss. */

(function () {
    const vscode = acquireVsCodeApi();

    const emptyState = document.getElementById("empty-state");
    const formContent = document.getElementById("form-content");

    let currentRequestId = null;

    window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "render_form") {
            currentRequestId = message.requestId;
            renderForm(message);
        }
    });

    /**
     * Renders a form from the provided schema.
     */
    function renderForm(schema) {
        emptyState.style.display = "none";
        formContent.style.display = "block";
        formContent.innerHTML = "";

        // Header
        const header = document.createElement("div");
        header.className = "form-header";
        header.innerHTML =
            '<div class="form-title">' + escapeHtml(schema.title) + "</div>" +
            (schema.description
                ? '<div class="form-description">' + escapeHtml(schema.description) + "</div>"
                : "");
        formContent.appendChild(header);

        // Form element
        const form = document.createElement("form");
        form.id = "alignment-form";
        form.addEventListener("submit", handleSubmit);

        // Render fields
        for (const field of schema.fields) {
            form.appendChild(createField(field));
        }

        // Actions: Submit + Dismiss
        const actions = document.createElement("div");
        actions.className = "form-actions";

        const submitBtn = document.createElement("button");
        submitBtn.type = "submit";
        submitBtn.className = "submit-btn";
        submitBtn.textContent = "Submit";
        actions.appendChild(submitBtn);

        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "dismiss-btn";
        dismissBtn.textContent = "Skip \u2014 proceed with what you already have";
        dismissBtn.addEventListener("click", handleDismiss);
        actions.appendChild(dismissBtn);

        form.appendChild(actions);
        formContent.appendChild(form);

        // Focus first input
        const firstInput = form.querySelector("input, textarea, select");
        if (firstInput) firstInput.focus();
    }

    /**
     * Creates a single form field.
     */
    function createField(field) {
        const container = document.createElement("div");
        container.className = "form-field";
        container.dataset.fieldId = field.id;

        // Label
        const label = document.createElement("label");
        label.setAttribute("for", "field-" + field.id);
        label.innerHTML = escapeHtml(field.label);
        if (field.required) {
            label.innerHTML += '<span class="required-marker">*</span>';
        }
        container.appendChild(label);

        switch (field.type) {
            case "single-choice":
                container.appendChild(createRadioGroup(field));
                break;
            case "multi-choice":
                container.appendChild(createCheckboxGroup(field));
                break;
            case "free-text":
                container.appendChild(createTextInput(field));
                break;
        }

        // Validation error
        const errorEl = document.createElement("div");
        errorEl.className = "field-error";
        errorEl.id = "error-" + field.id;
        container.appendChild(errorEl);

        return container;
    }

    /**
     * Radio group for single-choice. Auto-appends "Other - describe below".
     */
    function createRadioGroup(field) {
        const wrapper = document.createElement("div");

        const group = document.createElement("div");
        group.className = "radio-group";

        const allOptions = (field.options || []).concat(["Other \u2014 describe below"]);

        for (const option of allOptions) {
            const item = document.createElement("label");
            item.className = "radio-item";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = field.id;
            radio.value = option;
            if (field.required) radio.required = true;

            const span = document.createElement("span");
            span.textContent = option;

            item.appendChild(radio);
            item.appendChild(span);
            group.appendChild(item);
        }

        wrapper.appendChild(group);

        // "Other" text input, hidden by default
        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "other-input";
        otherInput.name = field.id + "_other";
        otherInput.placeholder = "Describe your preference";
        otherInput.style.display = "none";
        wrapper.appendChild(otherInput);

        // Toggle "Other" input visibility
        group.addEventListener("change", (e) => {
            const selected = e.target;
            if (selected && selected.value === "Other \u2014 describe below") {
                otherInput.style.display = "block";
                otherInput.focus();
            } else {
                otherInput.style.display = "none";
                otherInput.value = "";
            }
        });

        return wrapper;
    }

    /**
     * Checkbox group for multi-choice. Auto-appends "Other - describe below".
     */
    function createCheckboxGroup(field) {
        const wrapper = document.createElement("div");

        const group = document.createElement("div");
        group.className = "checkbox-group";

        const allOptions = (field.options || []).concat(["Other \u2014 describe below"]);

        for (const option of allOptions) {
            const item = document.createElement("label");
            item.className = "checkbox-item";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = field.id;
            checkbox.value = option;

            const span = document.createElement("span");
            span.textContent = option;

            item.appendChild(checkbox);
            item.appendChild(span);
            group.appendChild(item);
        }

        wrapper.appendChild(group);

        // "Other" text input
        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "other-input";
        otherInput.name = field.id + "_other";
        otherInput.placeholder = "Describe your preference";
        otherInput.style.display = "none";
        wrapper.appendChild(otherInput);

        // Toggle "Other" input visibility
        group.addEventListener("change", () => {
            const otherCheckbox = group.querySelector(
                'input[value="Other \u2014 describe below"]'
            );
            if (otherCheckbox && otherCheckbox.checked) {
                otherInput.style.display = "block";
                otherInput.focus();
            } else {
                otherInput.style.display = "none";
                otherInput.value = "";
            }
        });

        return wrapper;
    }

    /**
     * Text input for free-text fields.
     */
    function createTextInput(field) {
        const isLong = field.placeholder && field.placeholder.length > 40;

        if (isLong) {
            const textarea = document.createElement("textarea");
            textarea.id = "field-" + field.id;
            textarea.name = field.id;
            textarea.placeholder = field.placeholder || "";
            textarea.rows = 3;
            if (field.required) textarea.required = true;
            return textarea;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.id = "field-" + field.id;
        input.name = field.id;
        input.placeholder = field.placeholder || "";
        if (field.required) input.required = true;
        return input;
    }

    /**
     * Handles form submission.
     */
    function handleSubmit(event) {
        event.preventDefault();
        const form = event.target;
        const formData = {};
        let hasErrors = false;

        // Clear errors
        document.querySelectorAll(".field-error").forEach((el) => {
            el.classList.remove("visible");
            el.textContent = "";
        });

        const fields = form.querySelectorAll("[name]");
        const processedNames = new Set();

        for (const input of fields) {
            const name = input.name;

            // Skip "other" companion fields (handled with their parent)
            if (name.endsWith("_other")) continue;

            if (processedNames.has(name) && input.type !== "checkbox" && input.type !== "radio") {
                continue;
            }

            if (input.type === "checkbox") {
                if (!processedNames.has(name)) {
                    processedNames.add(name);
                    const checked = form.querySelectorAll('input[name="' + name + '"]:checked');
                    const values = Array.from(checked).map((cb) => cb.value);

                    // If "Other" is selected, replace it with the text input value
                    const otherIdx = values.indexOf("Other \u2014 describe below");
                    if (otherIdx !== -1) {
                        const otherText = form.querySelector('input[name="' + name + '_other"]');
                        if (otherText && otherText.value.trim()) {
                            values[otherIdx] = otherText.value.trim();
                        } else {
                            values.splice(otherIdx, 1);
                        }
                    }
                    formData[name] = values;
                }
            } else if (input.type === "radio") {
                if (!processedNames.has(name)) {
                    processedNames.add(name);
                    const checked = form.querySelector('input[name="' + name + '"]:checked');
                    let value = checked ? checked.value : "";

                    // If "Other" is selected, use the text input value
                    if (value === "Other \u2014 describe below") {
                        const otherText = form.querySelector('input[name="' + name + '_other"]');
                        value = otherText && otherText.value.trim() ? otherText.value.trim() : "";
                    }

                    formData[name] = value;

                    if (input.required && !value) {
                        showFieldError(name, "Please select an option");
                        hasErrors = true;
                    }
                }
            } else {
                processedNames.add(name);
                formData[name] = input.value;

                if (input.required && !input.value.trim()) {
                    showFieldError(name, "This field is required");
                    hasErrors = true;
                }
            }
        }

        if (hasErrors) return;

        // Disable buttons
        const submitBtn = form.querySelector(".submit-btn");
        const dismissBtn = form.querySelector(".dismiss-btn");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Submitting...";
        }
        if (dismissBtn) dismissBtn.disabled = true;

        vscode.postMessage({
            type: "form_submitted",
            requestId: currentRequestId,
            data: formData,
        });

        // Return to empty state
        setTimeout(() => {
            formContent.style.display = "none";
            emptyState.style.display = "flex";
        }, 300);
    }

    /**
     * Handles dismiss button click.
     */
    function handleDismiss() {
        vscode.postMessage({
            type: "form_dismissed",
            requestId: currentRequestId,
        });

        // Return to empty state
        formContent.style.display = "none";
        emptyState.style.display = "flex";
    }

    function showFieldError(fieldId, message) {
        const errorEl = document.getElementById("error-" + fieldId);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add("visible");
        }
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }
})();
