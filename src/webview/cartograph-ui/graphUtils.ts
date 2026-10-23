/**
 * Shared graph construction and layout utilities for Cartograph.
 */
import { Node, Edge, MarkerType } from '@xyflow/react';
import dagre from 'dagre';
import { CustomNodeData } from './CustomNode';
import { ImpactReport, MergedTimelineEntry, ImpactChange as ReportChange } from '../../types';

export { ReportChange, MergedTimelineEntry, ImpactReport };

export const getCompoundElements = (
  report: ImpactReport,
  collapsedDirs: Set<string>
) => {
  const nodes: Node<CustomNodeData>[] = [];
  const edges: Edge[] = [];
  const createdDirs = new Set<string>();

  const isDescendantOfCollapsed = (pathStr: string) => {
    for (const collapsed of collapsedDirs) {
      if (pathStr === collapsed || pathStr.startsWith(collapsed + '/')) {
        return collapsed;
      }
    }
    return null;
  };

  const ensureDirectory = (dirPath: string) => {
    if (!dirPath || dirPath === "." || dirPath === "/") return;
    const normalized = dirPath.replace(/\\/g, '/');
    const parts = normalized.split('/');

    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      const dirId = `dir:${currentPath}`;

      const collapsedParent = isDescendantOfCollapsed(parentPath);
      if (collapsedParent) continue;

      if (!createdDirs.has(dirId)) {
        createdDirs.add(dirId);

        nodes.push({
          id: dirId,
          type: 'custom',
          data: {
            type: 'directory',
            label: parts[i],
            filePath: currentPath,
            isCollapsed: collapsedDirs.has(currentPath),
          },
          position: { x: 0, y: 0 },
        });

        if (parentPath) {
          edges.push({
            id: `edge:dir:${parentPath}->${currentPath}`,
            source: `dir:${parentPath}`,
            target: dirId,
            style: { stroke: 'rgba(128, 128, 128, 0.4)', strokeDasharray: '4,4' },
          });
        }
      }
    }
  };

  const isMerged = report.isMerged && report.timeline && report.timeline.length > 0;

  if (isMerged) {
    report.timeline!.forEach((entry, idx) => {
      nodes.push({
        id: `task-node-${entry.taskId}`,
        type: 'custom',
        data: {
          type: 'task',
          label: entry.summary,
          subtitle: `Task: ${entry.taskId.substring(0, 8)}`,
          planningContext: entry.planningContext,
          projectName: report.projectName,
          isMerged: true,
          timelineIndex: `${idx + 1}/${report.timeline!.length}`,
          timeline: report.timeline,
        },
        position: { x: 0, y: 0 },
      });

      if (idx > 0) {
        const prevEntry = report.timeline![idx - 1];
        let label = "next";
        try {
          const prevTime = new Date(prevEntry.timestamp).getTime();
          const currTime = new Date(entry.timestamp).getTime();
          const diffMin = Math.round((currTime - prevTime) / 60000);
          if (diffMin < 60) {
            label = `+${diffMin}m`;
          } else {
            const diffHours = Math.round(diffMin / 60);
            label = `+${diffHours}h`;
          }
        } catch {}

        edges.push({
          id: `edge:temporal:${prevEntry.taskId}->${entry.taskId}`,
          source: `task-node-${prevEntry.taskId}`,
          target: `task-node-${entry.taskId}`,
          label,
          style: { stroke: 'rgba(128, 128, 128, 0.6)', strokeDasharray: '5,5', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(128, 128, 128, 0.6)' },
        });
      }
    });
  } else {
    nodes.push({
      id: 'task-node',
      type: 'custom',
      data: {
        type: 'task',
        label: report.summary,
        subtitle: `Task: ${report.taskId.substring(0, 8)}`,
        planningContext: report.planningContext,
        projectName: report.projectName,
      },
      position: { x: 0, y: 0 },
    });
  }

  report.changes.forEach((change, index) => {
    const normalizedPath = change.filePath.replace(/\\/g, '/');
    const lastSlash = normalizedPath.lastIndexOf('/');
    const dirPath = lastSlash !== -1 ? normalizedPath.substring(0, lastSlash) : "";
    const fileName = lastSlash !== -1 ? normalizedPath.substring(lastSlash + 1) : normalizedPath;

    if (dirPath) {
      ensureDirectory(dirPath);
    }

    const fileId = `file:${change.filePath}`;
    const collapsedParent = isDescendantOfCollapsed(dirPath);

    let sourceNodeId = 'task-node';
    if (isMerged) {
      const normChangePath = change.filePath.replace(/\\/g, '/').toLowerCase();
      const entry = report.timeline!.find(t => 
        t.changes.some(c => c.filePath.replace(/\\/g, '/').toLowerCase() === normChangePath)
      );
      if (entry) {
        sourceNodeId = `task-node-${entry.taskId}`;
      } else {
        sourceNodeId = `task-node-${report.timeline![report.timeline!.length - 1].taskId}`;
      }
    }

    if (collapsedParent) {
      const dirId = `dir:${collapsedParent}`;
      const specificEdgeId = isMerged ? `edge:${sourceNodeId}->collapsed:${collapsedParent}` : `edge:task->collapsed:${collapsedParent}`;
      if (!edges.some(e => e.id === specificEdgeId)) {
        edges.push({
          id: specificEdgeId,
          source: sourceNodeId,
          target: dirId,
          style: { stroke: 'var(--vscode-button-background)', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--vscode-button-background)' },
        });
      }
    } else {
      nodes.push({
        id: fileId,
        type: 'custom',
        data: {
          type: 'file',
          label: fileName,
          changeType: change.changeType,
          filePath: change.filePath,
          promptExcerpt: change.promptExcerpt,
          alignmentToolOutput: change.alignmentToolOutput,
          description: change.description,
          projectName: report.projectName,
        },
        position: { x: 0, y: 0 },
      });

      edges.push({
        id: `edge:task->file:${index}`,
        source: sourceNodeId,
        target: fileId,
        style: { stroke: 'var(--vscode-button-background)', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--vscode-button-background)' },
      });

      if (dirPath) {
        edges.push({
          id: `edge:dir:${dirPath}->file:${change.filePath}`,
          source: `dir:${dirPath}`,
          target: fileId,
          style: { stroke: 'rgba(128, 128, 128, 0.4)', strokeDasharray: '4,4' },
        });
      }
    }
  });

  return { nodes, edges };
};

export const getMergedElements = (
  reports: ImpactReport[],
  collapsedDirs: Set<string>
) => {
  const nodes: Node<CustomNodeData>[] = [];
  const edges: Edge[] = [];
  const createdDirs = new Set<string>();
  const createdFiles = new Map<string, Node<CustomNodeData>>();

  const isDescendantOfCollapsed = (pathStr: string) => {
    for (const collapsed of collapsedDirs) {
      if (pathStr === collapsed || pathStr.startsWith(collapsed + '/')) {
        return collapsed;
      }
    }
    return null;
  };

  const ensureDirectory = (dirPath: string) => {
    if (!dirPath || dirPath === "." || dirPath === "/") return;
    const normalized = dirPath.replace(/\\/g, '/');
    const parts = normalized.split('/');

    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      const dirId = `dir:${currentPath}`;

      const collapsedParent = isDescendantOfCollapsed(parentPath);
      if (collapsedParent) continue;

      if (!createdDirs.has(dirId)) {
        createdDirs.add(dirId);

        nodes.push({
          id: dirId,
          type: 'custom',
          data: {
            type: 'directory',
            label: parts[i],
            filePath: currentPath,
            isCollapsed: collapsedDirs.has(currentPath),
          },
          position: { x: 0, y: 0 },
        });

        if (parentPath) {
          edges.push({
            id: `edge:dir:${parentPath}->${currentPath}`,
            source: `dir:${parentPath}`,
            target: dirId,
            style: { stroke: 'rgba(128, 128, 128, 0.4)', strokeDasharray: '4,4' },
          });
        }
      }
    }
  };

  reports.forEach((report) => {
    const taskId = report.taskId;

    nodes.push({
      id: `task:${taskId}`,
      type: 'custom',
      data: {
        type: 'task',
        label: report.summary,
        subtitle: `Task: ${taskId.substring(0, 8)}`,
        planningContext: report.planningContext,
        projectName: report.projectName,
      },
      position: { x: 0, y: 0 },
    });

    report.changes.forEach((change) => {
      const fileId = `file:${change.filePath}`;
      const normalizedPath = change.filePath.replace(/\\/g, '/');
      const lastSlash = normalizedPath.lastIndexOf('/');
      const dirPath = lastSlash !== -1 ? normalizedPath.substring(0, lastSlash) : "";
      const fileName = lastSlash !== -1 ? normalizedPath.substring(lastSlash + 1) : normalizedPath;

      if (dirPath) {
        ensureDirectory(dirPath);
      }

      const collapsedParent = isDescendantOfCollapsed(dirPath);

      if (collapsedParent) {
        const dirId = `dir:${collapsedParent}`;
        const edgeId = `edge:task:${taskId}->collapsed:${collapsedParent}`;
        if (!edges.some(e => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: `task:${taskId}`,
            target: dirId,
            style: { stroke: 'var(--vscode-button-background)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--vscode-button-background)' },
          });
        }
      } else {
        let fileNode = createdFiles.get(fileId);
        if (!fileNode) {
          fileNode = {
            id: fileId,
            type: 'custom',
            data: {
              type: 'file',
              label: fileName,
              filePath: change.filePath,
              changeType: change.changeType,
              history: [],
              projectName: report.projectName,
            },
            position: { x: 0, y: 0 },
          };
          createdFiles.set(fileId, fileNode);
        }

        fileNode.data.history.push({
          taskSummary: report.summary,
          changeType: change.changeType,
          promptExcerpt: change.promptExcerpt,
          alignmentToolOutput: change.alignmentToolOutput,
          timestamp: report.timestamp,
          description: change.description,
        });

        edges.push({
          id: `edge:task:${taskId}->file:${change.filePath}`,
          source: `task:${taskId}`,
          target: fileId,
          style: { stroke: 'var(--vscode-button-background)', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--vscode-button-background)' },
        });

        if (dirPath) {
          const dirEdgeId = `edge:dir:${dirPath}->file:${change.filePath}`;
          if (!edges.some(e => e.id === dirEdgeId)) {
            edges.push({
              id: dirEdgeId,
              source: `dir:${dirPath}`,
              target: fileId,
              style: { stroke: 'rgba(128, 128, 128, 0.4)', strokeDasharray: '4,4' },
            });
          }
        }
      }
    });
  });

  createdFiles.forEach((node) => {
    node.data.history.sort(
      (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    if (node.data.history.length > 0) {
      node.data.changeType = node.data.history[0].changeType;
    }
    nodes.push(node);
  });

  return { nodes, edges };
};

export const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction = 'TB'
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    let width = 250;
    let height = 105;
    if (node.data?.type === 'task') {
      height = 80;
    } else if (node.data?.type === 'directory') {
      height = 85;
    }
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const positionedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    let width = 250;
    let height = 105;
    if (node.data?.type === 'task') {
      height = 80;
    } else if (node.data?.type === 'directory') {
      height = 85;
    }
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return positionedNodes;
};
