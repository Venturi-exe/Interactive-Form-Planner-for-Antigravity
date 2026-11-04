import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  Node,
  Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import CustomNode, { CustomNodeData } from './CustomNode';
import { Inspector } from './Inspector';
import { Toolbar } from './Toolbar';
import { DEFAULT_PROJECT_KEY, normalizeProjectKey } from '../../core/projectKey';
import {
  getCompoundElements,
  getMergedElements,
  getLayoutedElements,
  type ReportChange,
  type MergedTimelineEntry,
  type ImpactReport,
} from './graphUtils';

// Expose vscode API safely
const vscode = (window as any).vscode || {
  postMessage: (msg: any) => console.log('VSCode PostMessage:', msg),
};

const nodeTypes = {
  custom: CustomNode as any,
};



const DynamicBackground = () => {
  const zoom = useStore((state) => state.transform[2]);

  const dynamicGap = Math.max(30, Math.min(240, 60 / zoom));
  const dynamicSize = Math.max(1, Math.min(12, 4 / zoom));

  return <Background gap={dynamicGap} size={dynamicSize} color="rgba(128, 128, 128, 0.3)" />;
};

export const CartographApp = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<{ id: string; data: CustomNodeData } | null>(null);

  const [reportsHistory, setReportsHistory] = useState<ImpactReport[]>([]);
  const [activeReportId, setActiveReportId] = useState<string>('');
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const reportsHistoryRef = React.useRef(reportsHistory);
  const activeReportIdRef = React.useRef(activeReportId);
  const collapsedDirsRef = React.useRef(collapsedDirs);

  useEffect(() => {
    reportsHistoryRef.current = reportsHistory;
    activeReportIdRef.current = activeReportId;
    collapsedDirsRef.current = collapsedDirs;
  });

  const projectGroups = React.useMemo(() => {
    const groups = new Map<string, { label: string; reports: ImpactReport[] }>();
    for (const r of reportsHistory) {
      const key = normalizeProjectKey(r.projectName);
      if (!groups.has(key)) {
        const label = key === DEFAULT_PROJECT_KEY ? 'Default'
          : key.split('/').map(part => part.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' > ');
        groups.set(key, { label, reports: [] });
      }
      groups.get(key)!.reports.push(r);
    }
    return groups;
  }, [reportsHistory]);

  const activeReport = React.useMemo(() => {
    if (!activeReportId) return reportsHistory[0];
    if (activeReportId.startsWith('merge:')) {
      const projKey = activeReportId.split(':')[1];
      return reportsHistory.find(r => (normalizeProjectKey(r.projectName)) === projKey) || reportsHistory[0];
    }
    return reportsHistory.find(r => r.taskId === activeReportId) || reportsHistory[0];
  }, [reportsHistory, activeReportId]);

  const activeProjectId = normalizeProjectKey(activeReport?.projectName);
  const activeProjectLabel = React.useMemo(() => {
    const key = activeProjectId;
    return key === DEFAULT_PROJECT_KEY ? 'Default'
      : key.split('/').map(part => part.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' > ');
  }, [activeProjectId]);

  const projectReports = React.useMemo(() => {
    return reportsHistory.filter(r => (normalizeProjectKey(r.projectName)) === activeProjectId);
  }, [reportsHistory, activeProjectId]);

  const [undoStack, setUndoStack] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [detailPanelHeight, setDetailPanelHeight] = useState<number>((window as any).orbitConfig?.detailPanelHeight || 160);

  const { fitView } = useReactFlow();

  const pushToUndo = useCallback((currentNodes: Node[], currentEdges: Edge[]) => {
    setUndoStack((prev) => [...prev.slice(-49), { nodes: currentNodes, edges: currentEdges }]);
    setRedoStack([]);
  }, []);

  const handleLayout = useCallback(() => {
    if (nodes.length === 0) return;
    pushToUndo(nodes, edges);
    const layouted = getLayoutedElements(nodes, edges);
    setNodes(layouted);
    setTimeout(() => fitView({ duration: 400 }), 50);
  }, [nodes, edges, fitView, pushToUndo]);

  const handleReset = useCallback(() => {
    fitView({ duration: 400 });
  }, [fitView]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-49), { nodes, edges }]);
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [undoStack, nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-49), { nodes, edges }]);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [redoStack, nodes, edges, setNodes, setEdges]);



  const buildDiagram = useCallback((reportId: string, history: ImpactReport[], collapsed: Set<string>) => {
    if (history.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    let rawNodes: Node[] = [];
    let rawEdges: Edge[] = [];

    if (reportId.startsWith('merge:')) {
      const projectName = reportId.split(':')[1];
      const projectReports = history.filter(r => (normalizeProjectKey(r.projectName)) === projectName);
      const elements = getMergedElements(projectReports, collapsed);
      rawNodes = elements.nodes;
      rawEdges = elements.edges;
    } else {
      const report = history.find(r => r.taskId === reportId);
      if (report) {
        const elements = getCompoundElements(report, collapsed);
        rawNodes = elements.nodes;
        rawEdges = elements.edges;
      }
    }

    if (rawNodes.length > 0) {
      const layouted = getLayoutedElements(rawNodes, rawEdges);
      setNodes(layouted);
      setEdges(rawEdges);
      setTimeout(() => fitView({ duration: 400 }), 80);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [setNodes, setEdges, fitView]);

  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.data?.type === 'directory') {
      event.stopPropagation();
      const dirPath = (node.data as any)?.filePath;
      if (!dirPath || typeof dirPath !== 'string') return;

      pushToUndo(nodes, edges);

      const nextCollapsed = new Set(collapsedDirs);
      if (nextCollapsed.has(dirPath)) {
        nextCollapsed.delete(dirPath);
      } else {
        nextCollapsed.add(dirPath);
      }

      setCollapsedDirs(nextCollapsed);
      buildDiagram(activeReportId, reportsHistory, nextCollapsed);
      setSelectedNode(null);
    }
  }, [nodes, edges, collapsedDirs, activeReportId, reportsHistory, buildDiagram, pushToUndo]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode({ id: node.id, data: node.data as CustomNodeData });
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onReportSelectorChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    setActiveReportId(val);
    setSelectedNode(null);
  }, []);

  const handleMergeReports = useCallback(() => {
    if (activeProjectId) {
      const mergedId = `merge:${activeProjectId}`;
      setActiveReportId(mergedId);
      setSelectedNode(null);
    }
  }, [activeProjectId]);

  const handleDeleteReport = useCallback(() => {
    if (!activeReportId) return;
    if (activeReportId.startsWith('merge:')) {
      const projectName = activeReportId.split(':')[1];
      vscode.postMessage({ type: 'delete_report', projectName });
    } else {
      vscode.postMessage({ type: 'delete_report', taskId: activeReportId });
    }
  }, [activeReportId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'load_history') {
        const history: ImpactReport[] = message.reports || [];
        setReportsHistory(history);
        const isValid = history.some((r: ImpactReport) => r.taskId === activeReportIdRef.current);
        const active = isValid ? activeReportIdRef.current : (history.length > 0 ? history[0].taskId : '');
        setActiveReportId(active);
      } else if (message.type === 'new_report') {
        const report = message.report;
        if (report) {
          setReportsHistory((prev) => {
            const filtered = prev.filter((r) => r.taskId !== report.taskId);
            const next = [report, ...filtered].slice(0, 10);
            setActiveReportId(report.taskId);
            return next;
          });
        }
      } else if (message.type === 'select_report') {
        const taskId = message.taskId;
        setActiveReportId(taskId);
      } else if (message.type === 'load_layout_state_success') {
        try {
          const parsed = JSON.parse(message.layoutState);
          if (parsed.nodes && parsed.edges) {
            setNodes(parsed.nodes);
            setEdges(parsed.edges);
            if (parsed.activeReportId) setActiveReportId(parsed.activeReportId);
            if (parsed.collapsedDirs) setCollapsedDirs(new Set(parsed.collapsedDirs));
          }
        } catch (err) {
          console.error('Failed to parse loaded layout state:', err);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    (window as any).OrbitCartograph = {
      loadHistory: (reports: ImpactReport[]) => {
        setReportsHistory(reports);
        const active = reports.length > 0 ? reports[0].taskId : '';
        setActiveReportId(active);
      },
      addNewReport: (report: ImpactReport) => {
        setReportsHistory((prev) => {
          const filtered = prev.filter((r) => r.taskId !== report.taskId);
          const next = [report, ...filtered].slice(0, 10);
          setActiveReportId(report.taskId);
          return next;
        });
      },
      setZoomSensitivity: (value: number) => {
        console.log('Sensitivity changed:', value);
      },
      setDetailPanelHeight: (height: number) => {
        setDetailPanelHeight(height);
      },
      initialize: () => {
        console.log('React Flow Cartograph Canvas Initialized!');
      },
    };

    vscode.postMessage({ type: 'webview_ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [setNodes, setEdges]);

  // Reactive diagram builder to avoid state race conditions and sync selection cleanly
  useEffect(() => {
    buildDiagram(activeReportId, reportsHistory, collapsedDirs);
  }, [activeReportId, reportsHistory, collapsedDirs, buildDiagram]);

  return (
    <div className="cartograph-dashboard-wrapper">
      <div className="cartograph-header">
        <div className="selector-container">
          <label htmlFor="report-selector" style={{ display: 'flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-focusBorder)" strokeWidth="2.5" style={{ marginRight: '6px', verticalAlign: '-2px' }}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="project-badge">{activeProjectLabel}</span>
          </label>
          <select id="report-selector" value={activeReportId} onChange={onReportSelectorChange}>
            {reportsHistory.length === 0 ? (
              <option value="">No impact reports stored</option>
            ) : (
              Array.from(projectGroups.entries()).map(([projKey, group]) => (
                <optgroup key={projKey} label={group.label}>
                  {group.reports.map((report) => {
                    let dateStr = report.timestamp;
                    try {
                      const date = new Date(report.timestamp);
                      dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                        " " + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                    } catch {
                      /* ignore date parse error */
                    }

                    const optionLabel = report.isMerged
                      ? `${dateStr}: [Merged] ${report.summary}`
                      : `${dateStr}: ${report.summary}`;

                    return (
                      <option key={report.taskId} value={report.taskId}>
                        {optionLabel}
                      </option>
                    );
                  })}
                </optgroup>
              ))
            )}
          </select>
        </div>

        <div className="toolbar-actions">
          {projectReports.length > 1 && (
            <button
              id="btn-merge-reports"
              className="toolbar-btn"
              onClick={handleMergeReports}
              title="Consolidate Project Maps"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M6 9v6M21 15v-3a4 4 0 00-4-4H9" />
              </svg>
            </button>
          )}

          {reportsHistory.length > 0 && !activeReportId.startsWith('merge:') && (
            <button
              id="btn-close-report"
              className="toolbar-btn"
              onClick={() => vscode.postMessage({ type: 'close_report', taskId: activeReportId })}
              title="Close Active Report"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}

          {reportsHistory.length > 0 && (
            <button
              id="btn-delete-report"
              className="toolbar-btn danger-hover"
              onClick={handleDeleteReport}
              title="Delete Active Report"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          )}

          <button
            id="btn-open-hub"
            className="toolbar-btn"
            onClick={() => vscode.postMessage({ type: 'open_hub' })}
            title="Open Cartograph Hub"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <div className="empty-state-cartograph" style={{ display: 'flex', flex: 1 }}>
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2l6 3 6-3v10.5M9 2v18M15 5v5" />
                <circle cx="18" cy="18" r="3" />
                <path d="M20 20l2 2" />
              </svg>
            </div>
            <p className="empty-title">No Map Generated</p>
            <p className="empty-description">Visual representation of file impact changes will appear here after execution.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative', width: '100%', minHeight: 0 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onPaneClick={onPaneClick}
              fitView
              minZoom={0.2}
              maxZoom={2.5}
            >
              <DynamicBackground />
              <Controls showInteractive={false} />
            </ReactFlow>

            <Toolbar
              onLayout={handleLayout}
              onFitView={handleReset}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
            />
          </div>

          <Inspector
            selectedNode={selectedNode}
            onClose={() => setSelectedNode(null)}
            height={detailPanelHeight}
          />
        </div>
      )}
    </div>
  );
};

export default () => (
  <ReactFlowProvider>
    <CartographApp />
  </ReactFlowProvider>
);

const mountElement = document.getElementById('tab-cartograph');
if (mountElement) {
  const root = createRoot(mountElement);
  root.render(
    <ReactFlowProvider>
      <CartographApp />
    </ReactFlowProvider>
  );
}
