// @ts-nocheck
/**
 * Orbit : Ultimate planning tool for antigravity.
 *
 * Copyright (c) 2026 César Vissouze (Venturi-exe / VNTR.CORP)
 * Licensed under the Orbit Personal Use License.
 * See LICENSE.txt in the project root for license information.
 */

(function () {
    const vscode = acquireVsCodeApi();
    window.vscode = vscode;

    const emptyState = document.getElementById("empty-state");
    const formContent = document.getElementById("form-content");

    let currentRequestId = null;
    let inactivityTimeoutMin = 5;
    let countdownWarningThresholdSec = 60;
    let warningTimer = null;
    let timeRemainingSec = 0;

    if (window.orbitConfig) {
        if (window.orbitConfig.inactivityTimeout) {
            inactivityTimeoutMin = window.orbitConfig.inactivityTimeout;
        }
        if (window.orbitConfig.countdownWarningThreshold) {
            countdownWarningThresholdSec = window.orbitConfig.countdownWarningThreshold;
        }
    }

    // Set up tab-switching logic
    const tabBtnPlanner = document.getElementById("tab-btn-planner");
    const tabBtnCartograph = document.getElementById("tab-btn-cartograph");
    const tabPlanner = document.getElementById("tab-planner");
    const tabCartograph = document.getElementById("tab-cartograph");

    function switchTab(tabId) {
        if (window.orbitConfig && window.orbitConfig.viewMode && window.orbitConfig.viewMode !== "combined") {
            return;
        }
        if (tabId === "cartograph") {
            if (tabBtnCartograph && tabBtnPlanner && tabCartograph && tabPlanner) {
                tabBtnCartograph.classList.add("active");
                tabBtnPlanner.classList.remove("active");
                tabCartograph.classList.add("active");
                tabPlanner.classList.remove("active");
            }
        } else if (tabId === "planner") {
            if (tabBtnCartograph && tabBtnPlanner && tabCartograph && tabPlanner) {
                tabBtnPlanner.classList.add("active");
                tabBtnCartograph.classList.remove("active");
                tabPlanner.classList.add("active");
                tabCartograph.classList.remove("active");
            }
        }
        vscode.postMessage({ type: "tab_changed", tab: tabId });
    }

    if (tabBtnPlanner && tabBtnCartograph && tabPlanner && tabCartograph) {
        tabBtnPlanner.addEventListener("click", () => {
            switchTab("planner");
        });

        tabBtnCartograph.addEventListener("click", () => {
            switchTab("cartograph");
        });
    }

    // Restore to sidebar button click
    const btnRestoreSidebar = document.getElementById("btn-restore-sidebar");
    if (btnRestoreSidebar) {
        btnRestoreSidebar.addEventListener("click", () => {
            vscode.postMessage({
                type: "restore_sidebar",
                viewMode: (window.orbitConfig && window.orbitConfig.viewMode) ? window.orbitConfig.viewMode : "combined"
            });
        });
    }

    window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "render_form") {
            currentRequestId = message.requestId;
            renderForm(message);
        } else if (message.type === "config_updated") {
            if (message.config) {
                if (message.config.inactivityTimeout) {
                    inactivityTimeoutMin = message.config.inactivityTimeout;
                }
                if (message.config.countdownWarningThreshold) {
                    countdownWarningThresholdSec = message.config.countdownWarningThreshold;
                }
                if (message.config.zoomSensitivity != null && window.OrbitCartograph) {
                    window.OrbitCartograph.setZoomSensitivity(message.config.zoomSensitivity);
                }
                if (message.config.detailPanelHeight != null && window.OrbitCartograph) {
                    window.OrbitCartograph.setDetailPanelHeight(message.config.detailPanelHeight);
                }
                resetInactivityTimer();
            }
        } else if (message.type === "load_history") {
            if (window.OrbitCartograph) {
                window.OrbitCartograph.loadHistory(message.reports);
            }
        } else if (message.type === "new_report") {
            if (window.OrbitCartograph) {
                window.OrbitCartograph.addNewReport(message.report);
            }
        } else if (message.type === "switch_tab") {
            switchTab(message.tab);
        } else if (message.type === "reset_form") {
            stopInactivityTimer();
            currentRequestId = null;
            formContent.style.display = "none";
            emptyState.style.display = "flex";
        } else if (message.type === "reset_timer") {
            if (currentRequestId) {
                startInactivityTimer();
            }
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
        form.id = "planner-form";
        form.addEventListener("submit", handleSubmit);

        // Render fields
        for (const field of schema.fields) {
            form.appendChild(createField(field));
        }

        // Actions: Submit + optional Execute + Dismiss
        const actions = document.createElement("div");
        actions.className = "form-actions";

        const submitBtn = document.createElement("button");
        submitBtn.type = "submit";
        submitBtn.className = "submit-btn";
        submitBtn.textContent = "Submit";
        actions.appendChild(submitBtn);

        // Execute Plan button (only in deep prompt refining mode)
        if (schema.showExecuteButton) {
            const executeBtn = document.createElement("button");
            executeBtn.type = "button";
            executeBtn.className = "execute-btn";
            executeBtn.textContent = "Execute Plan";
            executeBtn.addEventListener("click", handleExecute);
            actions.appendChild(executeBtn);
        }

        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "dismiss-btn";
        dismissBtn.textContent = "Skip - proceed with what you already have";
        dismissBtn.addEventListener("click", handleDismiss);
        actions.appendChild(dismissBtn);

        // Clarification Section
        const clarificationSec = document.createElement("div");
        clarificationSec.className = "clarification-section";

        const clarifTitle = document.createElement("div");
        clarifTitle.className = "clarification-title";
        clarifTitle.textContent = "Need clarification on these questions? Ask the agent:";
        clarificationSec.appendChild(clarifTitle);

        const clarifRow = document.createElement("div");
        clarifRow.className = "clarification-row";

        const clarifInput = document.createElement("textarea");
        clarifInput.id = "clarification-input";
        clarifInput.placeholder = "Ask what saying yes implies, clarify options, etc.";
        clarifRow.appendChild(clarifInput);

        const clarifBtn = document.createElement("button");
        clarifBtn.type = "button";
        clarifBtn.id = "clarification-btn";
        clarifBtn.className = "secondary-btn";
        clarifBtn.textContent = "Ask Clarification";
        clarifBtn.addEventListener("click", handleClarificationSubmit);
        clarifRow.appendChild(clarifBtn);

        clarificationSec.appendChild(clarifRow);
        form.appendChild(clarificationSec);

        form.appendChild(actions);
        formContent.appendChild(form);

        // Focus first input
        const firstInput = form.querySelector("input, textarea, select");
        if (firstInput) firstInput.focus();

        // Start inactivity timeout
        startInactivityTimer();
    }

    function createField(field) {
        const container = document.createElement("div");
        container.className = "form-field";
        container.dataset.fieldId = field.id;

        // Flex header row
        const headerRow = document.createElement("div");
        headerRow.className = "field-header-row";

        // Label
        const label = document.createElement("label");
        label.setAttribute("for", "field-" + field.id);
        label.innerHTML = escapeHtml(field.label);
        if (field.required) {
            label.innerHTML += '<span class="required-marker">*</span>';
        }
        headerRow.appendChild(label);

        // Ask Clarification Toggle
        const clarifToggleLabel = document.createElement("label");
        clarifToggleLabel.className = "clarification-toggle-label";
        clarifToggleLabel.title = "Ask specific clarification on this question";

        const clarifCheckbox = document.createElement("input");
        clarifCheckbox.type = "checkbox";
        clarifCheckbox.className = "field-clarification-checkbox";
        clarifCheckbox.dataset.fieldId = field.id;
        
        const clarifToggleSpan = document.createElement("span");
        clarifToggleSpan.textContent = "Clarify";

        clarifToggleLabel.appendChild(clarifCheckbox);
        clarifToggleLabel.appendChild(clarifToggleSpan);
        headerRow.appendChild(clarifToggleLabel);

        container.appendChild(headerRow);

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

        // Clarification Sub-textarea (hidden by default)
        const clarifTextArea = document.createElement("textarea");
        clarifTextArea.className = "field-clarification-textarea";
        clarifTextArea.placeholder = 'What specifically is unclear about this question?';
        clarifTextArea.style.display = "none";
        clarifTextArea.style.marginTop = "6px";
        clarifTextArea.rows = 2;
        container.appendChild(clarifTextArea);

        // Bind toggle event
        clarifCheckbox.addEventListener("change", (e) => {
            if (e.target.checked) {
                clarifTextArea.style.display = "block";
                clarifTextArea.focus();
                toggleFieldInputs(container, true);
            } else {
                clarifTextArea.style.display = "none";
                clarifTextArea.value = "";
                toggleFieldInputs(container, false);
            }
        });

        // Validation error
        const errorEl = document.createElement("div");
        errorEl.className = "field-error";
        errorEl.id = "error-" + field.id;
        container.appendChild(errorEl);

        return container;
    }

    /**
     * Toggles the disabled state and required attributes of a field's main inputs.
     */
    function toggleFieldInputs(fieldContainer, disabled) {
        const inputs = fieldContainer.querySelectorAll("input:not(.field-clarification-checkbox), textarea:not(.field-clarification-textarea), select");
        inputs.forEach((input) => {
            input.disabled = disabled;
            if (disabled) {
                input.required = false; // Bypass HTML5 validation!
                input.style.opacity = "0.5";
            } else {
                if (input.dataset.wasRequired === "true") {
                    input.required = true;
                }
                input.style.opacity = "1";
            }
        });
    }

    /**
     * Radio group for single-choice. Auto-appends "Other - describe below".
     */
    function createRadioGroup(field) {
        const wrapper = document.createElement("div");

        const group = document.createElement("div");
        group.className = "radio-group";

        const allOptions = (field.options || []).concat(["Other - describe below"]);

        for (const option of allOptions) {
            const item = document.createElement("label");
            item.className = "radio-item";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = field.id;
            radio.value = option;
            if (field.required) {
                radio.required = true;
                radio.dataset.wasRequired = "true";
            }

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
            if (selected && selected.value === "Other - describe below") {
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

        const allOptions = (field.options || []).concat(["Other - describe below"]);

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
                'input[value="Other - describe below"]'
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
            if (field.required) {
                textarea.required = true;
                textarea.dataset.wasRequired = "true";
            }
            return textarea;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.id = "field-" + field.id;
        input.name = field.id;
        input.placeholder = field.placeholder || "";
        if (field.required) {
            input.required = true;
            input.dataset.wasRequired = "true";
        }
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
                    const otherIdx = values.indexOf("Other - describe below");
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
                    if (value === "Other - describe below") {
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

        stopInactivityTimer();
        currentRequestId = null;

        // Return to empty state
        setTimeout(() => {
            formContent.style.display = "none";
            emptyState.style.display = "flex";
        }, 300);
    }

    /**
     * Handles "Execute Plan" button click.
     * Collects any filled form data and signals the agent to stop planning.
     */
    function handleExecute() {
        const form = document.getElementById("planner-form");
        const formData = {};

        if (form) {
            const fields = form.querySelectorAll("[name]");
            const processedNames = new Set();

            for (const input of fields) {
                const name = input.name;
                if (name.endsWith("_other")) continue;
                if (processedNames.has(name)) continue;
                processedNames.add(name);

                if (input.type === "radio") {
                    const checked = form.querySelector('input[name="' + name + '"]:checked');
                    formData[name] = checked ? checked.value : "";
                } else if (input.type === "checkbox") {
                    const checked = form.querySelectorAll('input[name="' + name + '"]:checked');
                    formData[name] = Array.from(checked).map((cb) => cb.value);
                } else {
                    formData[name] = input.value;
                }
            }

            // Disable all buttons
            const buttons = form.querySelectorAll("button");
            buttons.forEach((btn) => { btn.disabled = true; });
        }

        vscode.postMessage({
            type: "form_executed",
            requestId: currentRequestId,
            data: formData,
        });

        stopInactivityTimer();
        currentRequestId = null;

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

        stopInactivityTimer();
        currentRequestId = null;

        // Return to empty state
        formContent.style.display = "none";
        emptyState.style.display = "flex";
    }

    function handleClarificationSubmit() {
        const input = document.getElementById("clarification-input");
        const query = input ? input.value.trim() : "";

        // Collect specific clarifications
        const specificClarifications = [];
        const checkboxes = document.querySelectorAll(".field-clarification-checkbox:checked");
        
        checkboxes.forEach((cb) => {
            const fid = cb.dataset.fieldId;
            const formField = cb.closest(".form-field");
            const textArea = formField.querySelector(".field-clarification-textarea");
            const labelEl = formField.querySelector("label");
            // Remove the 'Clarify' label text if present to get clean question label
            const questionLabel = labelEl ? labelEl.textContent.replace("Clarify", "").trim() : fid;
            
            specificClarifications.push({
                fieldId: fid,
                question: questionLabel,
                clarificationQuery: textArea ? textArea.value.trim() : ""
            });
        });

        // Collect partial answers for the fields that were NOT checked for clarification
        const partialAnswers = {};
        const allFields = document.querySelectorAll(".form-field");
        
        allFields.forEach((fieldEl) => {
            const fid = fieldEl.dataset.fieldId;
            const cb = fieldEl.querySelector(".field-clarification-checkbox");
            if (cb && cb.checked) {
                // Ticked for clarification, skip answering
                return;
            }

            // Otherwise, collect value
            const radioGroup = fieldEl.querySelector(".radio-group");
            const checkboxGroup = fieldEl.querySelector(".checkbox-group");
            const textInput = fieldEl.querySelector("input[type='text'], textarea:not(.field-clarification-textarea)");

            if (radioGroup) {
                const checked = radioGroup.querySelector("input:checked");
                let val = checked ? checked.value : "";
                if (val === "Other - describe below") {
                    const otherText = fieldEl.querySelector(".other-input");
                    val = otherText && otherText.value.trim() ? otherText.value.trim() : "";
                }
                partialAnswers[fid] = val;
            } else if (checkboxGroup) {
                const checked = checkboxGroup.querySelectorAll("input:checked");
                const values = Array.from(checked).map((c) => c.value);
                const otherIdx = values.indexOf("Other - describe below");
                if (otherIdx !== -1) {
                    const otherText = fieldEl.querySelector(".other-input");
                    if (otherText && otherText.value.trim()) {
                        values[otherIdx] = otherText.value.trim();
                    } else {
                        values.splice(otherIdx, 1);
                    }
                }
                partialAnswers[fid] = values;
            } else if (textInput) {
                partialAnswers[fid] = textInput.value.trim();
            }
        });

        // Ensure we have at least a general query or one specific clarification
        if (!query && specificClarifications.length === 0) {
            alert("Please type a clarification question or tick a field above to ask for clarification.");
            return;
        }

        // Disable all buttons in the form to prevent double-submit
        const buttons = document.querySelectorAll("button");
        buttons.forEach((btn) => { btn.disabled = true; });
        if (input) input.disabled = true;

        // Set submitting loading text on the clarification button
        const clarifBtn = document.getElementById("clarification-btn");
        if (clarifBtn) {
            clarifBtn.innerHTML = '<span class="spinner"></span> Asking Agent...';
        }

        vscode.postMessage({
            type: "form_clarification",
            requestId: currentRequestId,
            question: query,
            specificClarifications: specificClarifications,
            partialAnswers: partialAnswers
        });

        stopInactivityTimer();
        currentRequestId = null;

        // Return to empty state
        setTimeout(() => {
            const formContent = document.getElementById("form-content");
            const emptyState = document.getElementById("empty-state");
            if (formContent) formContent.style.display = "none";
            if (emptyState) emptyState.style.display = "flex";
            if (clarifBtn) {
                clarifBtn.textContent = "Ask Clarification";
            }
        }, 800);
    }

    function startInactivityTimer() {
        stopInactivityTimer();
        
        timeRemainingSec = inactivityTimeoutMin * 60;
        
        warningTimer = setInterval(() => {
            timeRemainingSec--;
            
            const warningEl = document.getElementById("timeout-warning");
            
            if (timeRemainingSec <= countdownWarningThresholdSec && timeRemainingSec > 0) {
                if (warningEl) {
                    warningEl.textContent = "Warning: Session will time out due to inactivity in " + timeRemainingSec + " seconds...";
                    warningEl.classList.add("visible");
                }
            } else if (timeRemainingSec <= 0) {
                handleTimeout();
            } else {
                if (warningEl) {
                    warningEl.classList.remove("visible");
                    warningEl.textContent = "";
                }
            }
        }, 1000);
    }

    function stopInactivityTimer() {
        if (warningTimer) {
            clearInterval(warningTimer);
            warningTimer = null;
        }
        const warningEl = document.getElementById("timeout-warning");
        if (warningEl) {
            warningEl.classList.remove("visible");
            warningEl.textContent = "";
        }
    }

    function resetInactivityTimer() {
        if (currentRequestId) {
            startInactivityTimer();
            vscode.postMessage({ type: "interaction_reset" });
        }
    }

    function handleTimeout() {
        stopInactivityTimer();
        
        const buttons = document.querySelectorAll("button");
        buttons.forEach((btn) => { btn.disabled = true; });
        
        vscode.postMessage({
            type: "form_timeout",
            requestId: currentRequestId
        });
        
        currentRequestId = null;
        
        formContent.style.display = "none";
        emptyState.style.display = "flex";
    }

    // Bind interaction events to reset timer
    const interactionEvents = ["click", "keydown", "input", "change", "scroll"];
    interactionEvents.forEach((event) => {
        document.addEventListener(event, resetInactivityTimer, { passive: true });
    });

    // Reload button in empty state
    const btnEmptyStateReload = document.getElementById("btn-empty-state-reload");
    if (btnEmptyStateReload) {
        btnEmptyStateReload.addEventListener("click", () => {
            const svg = btnEmptyStateReload.querySelector("svg");
            if (svg) {
                svg.style.transition = "transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)";
                svg.style.transform = "rotate(360deg)";
                setTimeout(() => {
                    svg.style.transition = "none";
                    svg.style.transform = "none";
                }, 600);
            }
            vscode.postMessage({ type: "webview_ready" });
        });
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

    // Notify provider that the webview is ready to receive data
    vscode.postMessage({ type: "webview_ready" });
})();
