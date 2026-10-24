import React from 'react';
import { ReportRow } from './ReportRow';
import { ImpactReport } from '../../types';

interface ProjectCardProps {
  project: {
    projectName: string;
    reports: ImpactReport[];
    filteredReports: ImpactReport[];
    lastActivity: string;
  };
  isExpanded: boolean;
  onToggle: () => void;
  selectedReportId: string | null;
  onSelectReport: (reportId: string, projectName: string) => void;
  bulkSelectedIds: Set<string>;
  onToggleBulkSelect: (reportId: string) => void;
  tagRegistry: Record<string, { color: string; label: string }>;
  compareMode: boolean;
  compareReportIds: string[];
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isExpanded,
  onToggle,
  selectedReportId,
  onSelectReport,
  bulkSelectedIds,
  onToggleBulkSelect,
  tagRegistry,
  compareMode,
  compareReportIds,
}) => {
  const { projectName, reports, filteredReports, lastActivity } = project;

  // Format the last activity timestamp dynamically
  const formatLastActivity = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.round(diffMs / 60000);
      const diffHours = Math.round(diffMin / 60);

      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;

      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return timestamp;
    }
  };

  // Find unique file paths changed in this project
  const projectFiles = React.useMemo(() => {
    const files = new Set<string>();
    reports.forEach((r) => r.changes.forEach((c) => files.add(c.filePath)));
    return Array.from(files);
  }, [reports]);

  // Most recent report among the filtered ones
  const latestReport = React.useMemo(() => {
    if (filteredReports.length === 0) return null;
    return [...filteredReports].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
  }, [filteredReports]);

  const cardLabel = projectName === 'default' ? 'Default Project' : 
    projectName.split('/').map(part => part.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' > ');

  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 50;

  React.useEffect(() => {
    setPage(1);
  }, [filteredReports.length]);

  const paginatedReports = React.useMemo(() => {
    return filteredReports.slice(0, page * PAGE_SIZE);
  }, [filteredReports, page]);

  return (
    <div className={`bento-card ${isExpanded ? 'expanded' : ''} ${compareMode ? 'compare-active' : ''}`}>
      <div className="bento-card-header" onClick={onToggle}>
        <div className="project-title-area">
          <div className="folder-icon-wrapper">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="project-info">
            <h3 className="project-name-title">{cardLabel}</h3>
            <span className="project-last-activity">{formatLastActivity(lastActivity)}</span>
          </div>
        </div>

        <div className="project-badges-area">
          <span className="badge-report-count">
            {filteredReports.length} / {reports.length} Reports
          </span>
          <div className="expand-indicator">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow-svg">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </div>

      {/* Bento Card Body Content Preview (Visible when collapsed) */}
      {!isExpanded && latestReport && (
        <div className="bento-card-body-preview" onClick={onToggle}>
          <div className="recent-report-preview">
            <span className="recent-label">LATEST IMPACT</span>
            <p className="recent-summary">{latestReport.summary}</p>
            <div className="recent-files-chips">
              {latestReport.changes.slice(0, 3).map((change, idx) => {
                const parts = change.filePath.split(/[/\\]/);
                const fileBasename = parts[parts.length - 1];
                return (
                  <span key={idx} className={`file-chip-preview change-${change.changeType}`}>
                    {fileBasename}
                  </span>
                );
              })}
              {latestReport.changes.length > 3 && (
                <span className="file-chip-preview more-badge">
                  +{latestReport.changes.length - 3} more
                </span>
              )}
            </div>
          </div>
          <div className="card-stats-quick">
            <span>Files tracked: {projectFiles.length}</span>
          </div>
        </div>
      )}

      {/* Expanded Report List Row Renders */}
      {isExpanded && (
        <div className="bento-card-expanded-list">
          {filteredReports.length === 0 ? (
            <div className="no-reports-matching">
              <p>No reports match your filters.</p>
            </div>
          ) : (
            <div className="reports-table">
              {paginatedReports.map((report) => {
                const repKey = report.filename || report.taskId;
                return (
                  <ReportRow
                    key={repKey}
                    report={report}
                    isSelected={
                      compareMode 
                        ? compareReportIds.includes(repKey)
                        : selectedReportId === repKey
                    }
                    onSelect={() => onSelectReport(repKey, projectName)}
                    isBulkSelected={bulkSelectedIds.has(repKey)}
                    onToggleBulkSelect={() => onToggleBulkSelect(repKey)}
                    tagRegistry={tagRegistry}
                    compareMode={compareMode}
                  />
                );
              })}
              {filteredReports.length > paginatedReports.length && (
                <div className="pagination-bar" style={{ padding: "8px 12px", textAlign: "center" }}>
                  <button
                    className="btn-show-more"
                    style={{
                      background: "var(--vscode-button-secondaryBackground, #3a3d41)",
                      color: "var(--vscode-button-secondaryForeground, #ffffff)",
                      border: "none",
                      borderRadius: "4px",
                      padding: "6px 14px",
                      cursor: "pointer",
                      fontSize: "12px",
                    }}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Show More ({filteredReports.length - paginatedReports.length} remaining)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
