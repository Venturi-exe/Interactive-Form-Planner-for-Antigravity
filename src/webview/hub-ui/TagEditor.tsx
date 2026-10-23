import React, { useState } from 'react';
import { ImpactReport } from '../../types';

interface TagEditorProps {
  report: ImpactReport;
  tagRegistry: Record<string, { color: string; label: string }>;
  onClose: () => void;
  setReports: React.Dispatch<React.SetStateAction<ImpactReport[]>>;
  vscode: { postMessage: (msg: any) => void };
}

export const TagEditor: React.FC<TagEditorProps> = ({
  report,
  tagRegistry,
  onClose,
  setReports,
  vscode,
}) => {
  const [currentTags, setCurrentTags] = useState<string[]>(report.tags || []);
  const [customTagName, setCustomTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState('var(--tag-color-emerald, #10b981)');

  const colorPalette = [
    'var(--tag-color-emerald, #10b981)',
    'var(--tag-color-rose, #f43f5e)',
    'var(--tag-color-amber, #f59e0b)',
    'var(--tag-color-violet, #8b5cf6)',
    'var(--tag-color-sky, #0ea5e9)',
    'var(--tag-color-indigo, #6366f1)',
  ];

  // Presets available to click add directly
  const presetOptions = ['feat', 'fix', 'docs', 'refactor', 'perf', 'ui', 'core'];

  // Add tag helper
  const handleAddTag = (tagStr: string, colorOpt?: string) => {
    // Format tag string: convert to lowercase, replace spaces/specials with hyphens
    const formatted = tagStr
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');

    if (!formatted) return;

    if (currentTags.includes(formatted)) {
      return; // Already added
    }

    const nextTags = [...currentTags, formatted];
    setCurrentTags(nextTags);

    // If a custom color is specified, we register it
    const registryUpdate: Record<string, any> = {};
    if (colorOpt) {
      registryUpdate[formatted] = {
        color: colorOpt,
        label: tagStr.trim(),
      };
    }

    // Save changes
    saveTags(nextTags, registryUpdate);
    setCustomTagName('');
  };

  // Remove tag helper
  const handleRemoveTag = (tagToRemove: string) => {
    const nextTags = currentTags.filter((t) => t !== tagToRemove);
    setCurrentTags(nextTags);
    saveTags(nextTags, {});
  };

  // Save tags back to extension host
  const saveTags = (nextTags: string[], registryUpdate: Record<string, any>) => {
    // Update local react state for instant feedback
    setReports((prevReports) =>
      prevReports.map((r) =>
        r.filename === report.filename ? { ...r, tags: nextTags } : r
      )
    );

    // Send update request message
    vscode.postMessage({
      type: 'hub_update_tags',
      projectName: report.projectName || 'default',
      taskId: report.taskId,
      filename: report.filename,
      tags: nextTags,
      registryUpdate,
    });
  };

  return (
    <div className="tag-editor-overlay" onClick={onClose}>
      <div className="tag-editor-popover" onClick={(e) => e.stopPropagation()}>
        <div className="tag-editor-header">
          <h3>Manage Semantic Tags</h3>
          <button className="tag-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Current Active Tags */}
        <div className="tag-editor-section">
          <span className="section-label">Active tags on this report:</span>
          <div className="current-tags-list">
            {currentTags.map((tag) => {
              const reg = tagRegistry[tag] || { color: 'rgba(128, 128, 128, 0.2)', label: tag };
              return (
                <span
                  key={tag}
                  className="editor-tag-chip"
                  style={{ backgroundColor: reg.color }}
                >
                  {reg.label}
                  <button className="remove-tag-x" onClick={() => handleRemoveTag(tag)}>
                    &times;
                  </button>
                </span>
              );
            })}
            {currentTags.length === 0 && (
              <p className="no-tags-editor">No tags assigned. Add one below!</p>
            )}
          </div>
        </div>

        {/* Presets List */}
        <div className="tag-editor-section">
          <span className="section-label">Quick Add Presets:</span>
          <div className="tag-presets-list">
            {presetOptions.map((preset) => {
              const reg = tagRegistry[preset] || { color: 'rgba(128, 128, 128, 0.25)', label: preset };
              const isAdded = currentTags.includes(preset);
              return (
                <button
                  key={preset}
                  className={`tag-preset-btn ${isAdded ? 'disabled' : ''}`}
                  disabled={isAdded}
                  onClick={() => handleAddTag(preset, reg.color)}
                  style={{ borderLeft: `3px solid ${reg.color}` }}
                >
                  +{reg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Tag Input */}
        <div className="tag-editor-section">
          <span className="section-label">Create Custom Tag:</span>
          <div className="custom-tag-form">
            <input
              type="text"
              placeholder="Enter tag name (e.g. core-auth)"
              value={customTagName}
              onChange={(e) => setCustomTagName(e.target.value)}
              className="custom-tag-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTag(customTagName, selectedColor);
              }}
            />
            
            <div className="color-palette-picker">
              {colorPalette.map((color) => (
                <button
                  key={color}
                  className={`color-picker-dot ${selectedColor === color ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setSelectedColor(color)}
                />
              ))}
            </div>

            <button
              onClick={() => handleAddTag(customTagName, selectedColor)}
              className="btn-create-tag"
              disabled={!customTagName.trim()}
            >
              Create & Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
