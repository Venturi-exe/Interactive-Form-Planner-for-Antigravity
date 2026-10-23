import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  Node,
  Edge,
} from '@xyflow/react';

import CustomNode, { CustomNodeData } from '../cartograph-ui/CustomNode';
import { getCompoundElements, getLayoutedElements } from '../cartograph-ui/graphUtils';
import { TimeTravel } from './TimeTravel';
import { TagEditor } from './TagEditor';
import { ImpactReport, MergedTimelineEntry, ImpactChange } from '../../types';

interface DetailPaneProps {
  report: ImpactReport;
  tagRegistry: Record<string, { color: string; label: string }>;
  setReports: React.Dispatch<React.SetStateAction<ImpactReport[]>>;
  vscode: { postMessage: (msg: any) => void };
  onOpenStats: () => void;
}

const DynamicBackground = () => {
  const zoom = useStore((state) => state.transform[2]);

  const dynamicGap = Math.max(30, Math.min(240, 60 / zoom));
  const dynamicSize = Math.max(1, Math.min(12, 4 / zoom));

  return <Background gap={dynamicGap} size={dynamicSize} color="rgba(128, 128, 128, 0.3)" />;
};

const nodeTypes = {
  custom: CustomNode,
};

export const DetailPane: React.FC<DetailPaneProps> = ({
  report,
  tagRegistry,
  setReports,
  vscode,
  onOpenStats,
}) => {
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const { fitView } = useReactFlow();

  // Reset active time-travel step when report changes
  useEffect(() => {
    if (report.isMerged && report.timeline && report.timeline.length > 0) {
      setActiveStep(report.timeline.length - 1);
    } else {
      setActiveStep(null);
    }
    setCollapsedDirs(new Set());
  }, [report]);

  // Handle open in main sidebar
  const handleOpenInSidebar = () => {
    vscode.postMessage({
      type: 'hub_open_in_cartograph',
      taskId: report.taskId,
      projectName: report.projectName || 'default',
    });
  };

  // Handle report deletion
  const handleDelete = () => {
    vscode.postMessage({
      type: 'hub_delete_reports',
      projectName: report.projectName || 'default',
      filenames: [report.filename],
    });
  };

  // Compile ReactFlow graph elements
  const graphElements = useMemo(() => {
    // 1. Generate full layouted elements for the report
    const { nodes: rawNodes, edges: rawEdges } = getCompoundElements(report, collapsedDirs);
    
    // Determine active index dynamically to handle initial null state or report transitions gracefully
    let stepIdx = activeStep !== null ? activeStep : (report.isMerged && report.timeline ? report.timeline.length - 1 : null);
    if (stepIdx !== null && report.timeline && (stepIdx < 0 || stepIdx >= report.timeline.length)) {
      stepIdx = report.timeline.length - 1;
    }

    // If not merged or no time-travel step is active, return full elements
    if (!report.isMerged || !report.timeline || report.timeline.length === 0 || stepIdx === null) {
      const layoutedNodes = getLayoutedElements(rawNodes, rawEdges);
      return { nodes: layoutedNodes, edges: rawEdges };
    }

    // 2. Filter elements based on time-travel activeStep
    const activeTimeline = report.timeline.slice(0, stepIdx + 1);
    const activeTaskIds = new Set(activeTimeline.map((t) => t.taskId));
    const currentActiveTaskId = report.timeline[stepIdx].taskId;

    // Filter nodes
    const filteredNodes = rawNodes.filter((node) => {
      if (node.data.type === 'task') {
        const idParts = node.id.split('-');
        const taskId = idParts[idParts.length - 1]; // extracts entry.taskId
        return activeTaskIds.has(taskId);
      }
      if (node.data.type === 'file') {
        const normPath = node.data.filePath ? node.data.filePath.replace(/\\/g, '/').toLowerCase() : '';
        // Find which task node this file represents
        const fileChange = report.changes.find((c) => c.filePath.replace(/\\/g, '/').toLowerCase() === normPath);
        if (fileChange) {
          const entry = report.timeline!.find((t) => 
            t.changes.some((c) => c.filePath.replace(/\\/g, '/').toLowerCase() === normPath)
          );
          if (entry) {
            return activeTaskIds.has(entry.taskId);
          }
        }
      }
      return true; // Keep directories
    });

    // Helper helper
    function changeFilePath(path: string) {
      return path;
    }

    // Highlight the active step node
    const highlightedNodes = filteredNodes.map((node) => {
      if (node.id === `task-node-${currentActiveTaskId}`) {
        return {
          ...node,
          style: {
            ...node.style,
            boxShadow: '0 0 15px var(--vscode-focusBorder)',
            border: '2px solid var(--vscode-focusBorder)',
          },
        };
      }
      // Highlight files belonging to this active step
      if (node.data.type === 'file') {
        const isCurrentStepFile = report.timeline?.[stepIdx]?.changes?.some(
          (c) => c.filePath === node.data.filePath
        ) || false;
        if (isCurrentStepFile) {
          return {
            ...node,
            style: {
              ...node.style,
              boxShadow: '0 0 10px rgba(16, 185, 129, 0.4)',
              border: '1.5px solid #10b981',
            },
          };
        }
      }
      return node;
    });

    // Filter edges
    const activeNodeIds = new Set(highlightedNodes.map((n) => n.id));
    const filteredEdges = rawEdges.filter(
      (edge) => activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target)
    );

    const layoutedNodes = getLayoutedElements(highlightedNodes, filteredEdges);
    return { nodes: layoutedNodes, edges: filteredEdges };
  }, [report, activeStep, collapsedDirs]);

  // Programmatically fit view whenever graph nodes or edges change
  useEffect(() => {
    if (graphElements.nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 400 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [graphElements.nodes, graphElements.edges, fitView]);

  const activeTaskSummary = useMemo(() => {
    let stepIdx = activeStep !== null ? activeStep : (report.isMerged && report.timeline ? report.timeline.length - 1 : null);
    if (stepIdx !== null && report.timeline && (stepIdx < 0 || stepIdx >= report.timeline.length)) {
      stepIdx = report.timeline.length - 1;
    }
    if (!report.isMerged || !report.timeline || stepIdx === null) return report.summary;
    return report.timeline[stepIdx].summary;
  }, [report, activeStep]);

  return (
    <div className="detail-pane-container">
      {/* Header Info Area */}
      <div className="detail-header">
        <div className="detail-meta-row">
          <span className="detail-project-lbl">
            PROJECT: {report.projectName === 'default' ? 'DEFAULT' : report.projectName?.toUpperCase()}
          </span>
          <span className="detail-timestamp-lbl">
            {new Date(report.timestamp).toLocaleString()}
          </span>
        </div>
        <h2 className="detail-summary-title">{report.summary}</h2>

        {/* Tags Row */}
        <div className="detail-tags-row">
          <div className="tags-chips-list">
            {report.tags && report.tags.map((tag) => {
              const reg = tagRegistry[tag] || { color: 'rgba(128, 128, 128, 0.2)', label: tag };
              return (
                <span
                  key={tag}
                  className="detail-tag-chip"
                  style={{ backgroundColor: reg.color }}
                >
                  {reg.label}
                </span>
              );
            })}
            
            {(!report.tags || report.tags.length === 0) && (
              <span className="no-tags-lbl">No semantic tags assigned</span>
            )}
          </div>

          <button className="btn-edit-tags" onClick={() => setShowTagEditor(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Edit Tags
          </button>
        </div>
      </div>

      {/* ReactFlow Graph Canvas */}
      <div className="detail-graph-preview-container">
        <div className="graph-canvas-frame">
          <ReactFlow
            nodes={graphElements.nodes}
            edges={graphElements.edges}
            nodeTypes={nodeTypes}
            className="dark"
            fitView
            nodesConnectable={false}
            nodesDraggable={true}
            zoomOnScroll={true}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <DynamicBackground />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Time-Travel playback controller (Renders below canvas) */}
        {report.isMerged && report.timeline && report.timeline.length > 0 && (
          <TimeTravel
            timeline={report.timeline}
            activeStep={
              activeStep !== null && activeStep < report.timeline.length
                ? activeStep
                : report.timeline.length - 1
            }
            setActiveStep={setActiveStep}
          />
        )}
      </div>

      {/* File Changes Table */}
      <div className="detail-section">
        <h4 className="detail-section-title">FILE CHANGES ({report.changes.length})</h4>
        <div className="files-table-wrapper">
          <table className="files-change-table">
            <thead>
              <tr>
                <th>Change Type</th>
                <th>File Path</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {report.changes.map((change, idx) => (
                <tr key={idx} className={`change-row change-${change.changeType}`}>
                  <td className="cell-change-type">
                    <span className={`badge badge-cell badge-${change.changeType}`}>
                      {change.changeType.toUpperCase()}
                    </span>
                  </td>
                  <td className="cell-file-path" title={change.filePath}>
                    {change.filePath}
                  </td>
                  <td className="cell-description">
                    {change.description || change.promptExcerpt || 'No description provided'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Planning Context */}
      {report.planningContext && (
        <div className="detail-section">
          <h4 className="detail-section-title">PLANNING CONTEXT & ALIGNMENT METRICS</h4>
          <div className="planning-context-grid">
            <div className="context-card">
              <span className="card-label">Roadmap Items</span>
              {report.planningContext.roadmap && report.planningContext.roadmap.length > 0 ? (
                <ul className="context-list">
                  {report.planningContext.roadmap.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="no-context-txt">No roadmap items recorded</p>
              )}
            </div>

            <div className="context-card">
              <span className="card-label">Assumptions</span>
              {report.planningContext.assumptions && report.planningContext.assumptions.length > 0 ? (
                <ul className="context-list">
                  {report.planningContext.assumptions.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="no-context-txt">No assumptions recorded</p>
              )}
            </div>

            <div className="context-card">
              <span className="card-label">Questions & Decisions</span>
              <div className="alignment-ratio">
                <span className="ratio-lbl">Questions Asked:</span>
                <span className="ratio-val">{report.planningContext.questionsAsked?.length || 0}</span>
              </div>
              <div className="alignment-ratio">
                <span className="ratio-lbl">User Decisions:</span>
                <span className="ratio-val">{report.planningContext.userDecisions?.length || 0}</span>
              </div>
              {report.planningContext.userDecisions && report.planningContext.userDecisions.length > 0 && (
                <div className="decision-ticks" style={{ marginTop: '8px' }}>
                  {report.planningContext.userDecisions.slice(0, 2).map((d, i) => (
                    <div key={i} className="decision-tick" style={{ fontSize: '10px', opacity: 0.8, borderLeft: '2px solid var(--vscode-focusBorder)', paddingLeft: '4px', marginBottom: '4px' }}>
                      <strong>Q:</strong> {d.question.substring(0, 30)}... <br />
                      <strong>A:</strong> {d.answer}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pane Actions Bar */}
      <div className="detail-actions-bar">
        <button className="btn-detail-act btn-primary" onClick={handleOpenInSidebar}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
          </svg>
          Open in Cartograph
        </button>

        <button className="btn-detail-act btn-danger" onClick={handleDelete}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Delete Report
        </button>
      </div>

      {/* Semantic Tag Editor popover */}
      {showTagEditor && (
        <TagEditor
          report={report}
          tagRegistry={tagRegistry}
          onClose={() => setShowTagEditor(false)}
          setReports={setReports}
          vscode={vscode}
        />
      )}
    </div>
  );
};
export default (props: DetailPaneProps) => (
  <ReactFlowProvider>
    <DetailPane {...props} />
  </ReactFlowProvider>
);
