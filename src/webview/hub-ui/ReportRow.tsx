import React from 'react';
import { ImpactReport } from '../../types';

interface ReportRowProps {
  report: ImpactReport;
  isSelected: boolean;
  onSelect: () => void;
  isBulkSelected: boolean;
  onToggleBulkSelect: () => void;
  tagRegistry: Record<string, { color: string; label: string }>;
  compareMode: boolean;
}

export const ReportRow: React.FC<ReportRowProps> = ({
  report,
  isSelected,
  onSelect,
  isBulkSelected,
  onToggleBulkSelect,
  tagRegistry,
  compareMode,
}) => {
  const { summary, timestamp, changes, isMerged, tags } = report;

  // Format short timestamp (e.g. "10:15 AM" or "May 24")
  const formatTime = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  };

  const formatDate = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return ts;
    }
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Avoid double triggering if clicking input checkbox itself
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.closest('.checkbox-container')) {
      return;
    }
    onSelect();
  };

  return (
    <div
      className={`report-row ${isSelected ? 'selected' : ''} ${isBulkSelected ? 'bulk-selected' : ''} ${compareMode ? 'compare-selection' : ''}`}
      onClick={handleRowClick}
    >
      {/* Checkbox Column (Bulk Actions or Comparison Selection) */}
      <div className="checkbox-container">
        <input
          type="checkbox"
          checked={isBulkSelected}
          onChange={onToggleBulkSelect}
          className="row-checkbox"
          id={`checkbox-${report.taskId}`}
        />
        <label htmlFor={`checkbox-${report.taskId}`} className="checkbox-custom" onClick={(e) => e.stopPropagation()} />
      </div>

      {/* Timestamp Column */}
      <div className="report-time-cell" title={formatDate(timestamp)}>
        <span className="time-lbl">{formatTime(timestamp)}</span>
        <span className="date-lbl">{formatDate(timestamp)}</span>
      </div>

      {/* Summary Content Column */}
      <div className="report-summary-cell">
        <div className="summary-title-wrapper">
          <span className="report-summary-text" title={summary}>
            {summary}
          </span>
          <div className="summary-badges">
            {isMerged && (
              <span className="badge badge-merged" style={{ fontSize: '9px', background: 'var(--vscode-focusBorder)', color: '#fff' }}>
                MERGED
              </span>
            )}
            
            {/* Display semantic tags */}
            {tags && tags.slice(0, 2).map((tag) => {
              const reg = tagRegistry[tag] || { color: 'rgba(128, 128, 128, 0.2)', label: tag };
              return (
                <span
                  key={tag}
                  className="badge badge-tag"
                  style={{
                    backgroundColor: reg.color,
                    color: '#fff',
                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
                    fontSize: '9px',
                  }}
                >
                  {reg.label}
                </span>
              );
            })}
            
            {tags && tags.length > 2 && (
              <span className="badge badge-more-tags">
                +{tags.length - 2}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* File Count Column */}
      <div className="report-files-cell">
        <span className="file-count-badge" title={`${changes.length} files changed`}>
          {changes.length} {changes.length === 1 ? 'file' : 'files'}
        </span>
      </div>
    </div>
  );
};
