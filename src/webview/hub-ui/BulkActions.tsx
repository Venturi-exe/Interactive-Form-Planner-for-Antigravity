import React, { useMemo, useState } from 'react';
import { ImpactReport } from '../../types';

interface BulkActionsProps {
  selectedIds: Set<string>;
  reports: ImpactReport[];
  onClear: () => void;
  vscode: { postMessage: (msg: any) => void };
}

export const BulkActions: React.FC<BulkActionsProps> = ({
  selectedIds,
  reports,
  onClear,
  vscode,
}) => {
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);

  const selectedReports = useMemo(() => {
    return reports.filter((r) => r.filename && selectedIds.has(r.filename));
  }, [reports, selectedIds]);

  // Determine if all selected reports are in the same project
  const { sameProject, projectName } = useMemo(() => {
    if (selectedReports.length === 0) return { sameProject: false, projectName: null };
    const pName = selectedReports[0].projectName || 'default';
    const allSame = selectedReports.every((r) => (r.projectName || 'default') === pName);
    return { sameProject: allSame, projectName: pName };
  }, [selectedReports]);

  // Unique project list in workspace
  const projectList = useMemo(() => {
    const list = new Set<string>();
    reports.forEach((r) => list.add(r.projectName || 'default'));
    return Array.from(list).filter((p) => p !== projectName);
  }, [reports, projectName]);

  // Bulk Delete
  const handleBulkDelete = () => {
    // Collect report JSON filenames
    const filenames = selectedReports.map((r) => r.filename);
    vscode.postMessage({
      type: 'hub_delete_reports',
      projectName: projectName || 'default',
      filenames,
    });
    onClear();
  };

  // Bulk Merge
  const handleBulkMerge = () => {
    if (!sameProject || selectedReports.length < 2) return;
    const taskIds = selectedReports.map((r) => r.taskId);
    vscode.postMessage({
      type: 'hub_merge_selected_reports',
      projectName: projectName || 'default',
      taskIds,
    });
    onClear();
  };

  // Bulk Move
  const handleBulkMove = (targetProj: string) => {
    const reportsToMove = selectedReports.map((r) => ({
      filename: r.filename,
      sourceProject: r.projectName || 'default',
    }));
    vscode.postMessage({
      type: 'hub_move_reports',
      targetProject: targetProj,
      reports: reportsToMove,
    });
    setShowMoveDropdown(false);
    onClear();
  };

  return (
    <div className="bulk-actions-floating-bar animate-slide-up">
      <div className="bulk-selected-summary">
        <span className="selected-count-lbl">{selectedIds.size} selected</span>
      </div>

      <div className="bulk-actions-buttons">
        {/* Bulk Merge */}
        <button
          className="btn-bulk-action btn-bulk-merge"
          onClick={handleBulkMerge}
          disabled={!sameProject || selectedIds.size < 2}
          title={
            !sameProject
              ? 'Merge requires reports to be in the same project'
              : selectedIds.size < 2
              ? 'Select at least 2 reports to merge'
              : 'Merge selected reports into a single consolidated timeline'
          }
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M6 9v6M21 15v-3a4 4 0 00-4-4H9" />
          </svg>
          Merge
        </button>

        {/* Bulk Move */}
        <div className="bulk-dropdown-anchor">
          <button
            className="btn-bulk-action btn-bulk-move"
            onClick={() => setShowMoveDropdown(!showMoveDropdown)}
            disabled={projectList.length === 0}
            title="Move reports to another project branch"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Move to...
          </button>
          
          {showMoveDropdown && (
            <div className="bulk-move-dropdown-menu">
              {projectList.map((proj) => (
                <button
                  key={proj}
                  onClick={() => handleBulkMove(proj)}
                  className="dropdown-item-btn"
                >
                  {proj === 'default' ? 'Default Project' : proj.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bulk Delete */}
        <button
          className="btn-bulk-action btn-bulk-delete"
          onClick={handleBulkDelete}
          title="Delete selected reports permanently"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Delete
        </button>

        <span className="bulk-actions-separator">|</span>

        <button className="btn-bulk-clear" onClick={onClear}>
          Cancel
        </button>
      </div>
    </div>
  );
};
export default BulkActions;
