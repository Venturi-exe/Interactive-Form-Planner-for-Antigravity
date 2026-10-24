import React, { memo } from 'react';
import { Handle, Position, NodeProps, Node } from '@xyflow/react';

export interface CustomNodeData {
  type: 'task' | 'file' | 'directory';
  label: string;
  subtitle?: string;
  changeType?: 'created' | 'edited' | 'moved' | 'deleted';
  filePath?: string;
  promptExcerpt?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  [key: string]: any;
}

export type CustomNodeType = Node<CustomNodeData>;

const CustomNode = ({ data, selected }: NodeProps<CustomNodeType>) => {
  const { type, label, subtitle, changeType, filePath, isCollapsed } = data;

  // Semantic rendering based on node types
  if (type === 'task') {
    const isMerged = data.isMerged;
    const timelineIndex = data.timelineIndex;

    return (
      <div className={`custom-card-node node-task ${isMerged ? 'is-merged' : ''} ${selected ? 'selected' : ''}`}>
        <Handle type="source" position={Position.Bottom} id="source" />
        <div className="node-header">
          <div className="node-title-container">
            <span className="node-title">{label}</span>
          </div>
          {isMerged && (
            <span className="badge badge-merged" style={{ fontSize: '9px', background: 'var(--vscode-focusBorder)', color: '#fff', marginLeft: '6px', flexShrink: 0 }}>
              MERGED
            </span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
          {subtitle && <div className="node-subtitle" style={{ margin: 0 }}>{subtitle}</div>}
          {timelineIndex && (
            <div style={{ fontSize: '10px', opacity: 0.8, fontFamily: 'monospace' }}>
              Seq: {timelineIndex}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === 'directory') {
    return (
      <div className={`custom-card-node node-directory ${isCollapsed ? 'collapsed' : ''} ${selected ? 'selected' : ''}`}>
        <Handle type="target" position={Position.Top} id="target" />
        <Handle type="source" position={Position.Bottom} id="source" />
        <div className="node-header">
          <div className="node-title-container">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M14.5 3H7.71l-1.85-2.22A1 1 0 0 0 5.1 0H1.5A1.5 1.5 0 0 0 0 1.5v13A1.5 1.5 0 0 0 1.5 16h13a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 14.5 3zM1.5 1h3.6a.5.5 0 0 1 .37.16L7.33 3H1.5a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm13.5 13.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V4h14v10.5z" />
            </svg>
            <span className="node-title">{label}</span>
          </div>
        </div>
        {subtitle && <div className="node-subtitle">{subtitle}</div>}
        <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '6px' }}>
          Double-click to expand directory
        </div>
      </div>
    );
  }

  // Default / File Node rendering
  const badgeClass = changeType ? `badge-${changeType}` : '';
  const statusLabel = changeType ? changeType.toUpperCase() : '';

  return (
    <div className={`custom-card-node node-file file-${changeType} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="target" />
      <Handle type="source" position={Position.Bottom} id="source" />
      
      <div className="node-header">
        <div className="node-title-container">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9 1H2v14h12V6H9V1zm1 1.41L12.59 5H10V2.41zM1.5 0h8.5l5 5v10.5a1.5 1.5 0 0 1-1.5 1.5H1.5A1.5 1.5 0 0 1 0 15.5v-14A1.5 1.5 0 0 1 1.5 0z" />
          </svg>
          <span className="node-title">{label}</span>
        </div>
        {statusLabel && <span className={`badge ${badgeClass}`}>{statusLabel}</span>}
      </div>

      {subtitle && <div className="node-subtitle">{subtitle}</div>}
      
      {filePath && (
        <div className="node-meta" title={filePath}>
          {filePath}
        </div>
      )}
    </div>
  );
};

export default memo(CustomNode);
