import React, { useState } from 'react';
import { CustomNodeData } from './CustomNode';

const vscode = (window as any).vscode || {
  postMessage: (msg: any) => console.log('VSCode PostMessage:', msg),
};

interface InspectorProps {
  selectedNode: {
    id: string;
    data: CustomNodeData;
  } | null;
  onClose: () => void;
  height?: number;
}

export const Inspector: React.FC<InspectorProps> = ({ selectedNode, onClose, height }) => {
  const panelHeight = height || (window as any).orbitConfig?.detailPanelHeight || 160;
  const [activeTab, setActiveTab] = useState<'info' | 'decisions' | 'roadmap' | 'timeline'>('info');

  if (!selectedNode) {
    return (
      <div className="detail-panel" style={{ height: 'auto' }}>
        <div className="detail-placeholder">Select a node in the graph to view file change parameters</div>
      </div>
    );
  }

  const { data } = selectedNode;
  const { type, label, subtitle, changeType, filePath, promptExcerpt, alignmentToolOutput, planningContext, description } = data;

  // Synthesize group description for directory type
  let directorySummary = '';
  if (type === 'directory') {
    if (label.includes('webview') || label.includes('cartograph-ui')) {
      directorySummary = 'UI & Presentation Layer: This directory holds the front-end React Flow components, forms, and custom stylesheet resources responsible for rendering pre-execution alignment forms and post-execution impact maps.';
    } else if (label.includes('mcp') || label.includes('server')) {
      directorySummary = 'Protocol & Communication Bridge: Contains the MCP server implementation coordinating tool call schemas, registry bindings, and standard input/output messaging pipes.';
    } else if (label.includes('src')) {
      directorySummary = 'Core Extension Module: Houses the main orchestration logical components, including state coordinators, watchers, and workspace syncing controllers.';
    } else {
      directorySummary = 'Workspace Component: Groups related resource files and helper classes developed during the active session to resolve targeted tasks.';
    }
  }

  return (
    <div className="detail-panel" style={{ height: `${panelHeight}px` }}>
      <div className="detail-content">
        <div className="detail-header">
          <span className="detail-title" title={label}>{label}</span>
          <button className="inspector-close-btn" onClick={onClose} style={{ marginLeft: 'auto' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
        </div>

        <div className="inspector-scroll-area" style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
          {type === 'task' && (
            <>
              <div className="inspector-tabs" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2))', marginBottom: '10px', paddingBottom: '4px' }}>
                <button 
                  className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
                  onClick={() => setActiveTab('info')}
                  style={{ flex: 'none', border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: activeTab === 'info' ? 600 : 400, borderBottom: activeTab === 'info' ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent', color: activeTab === 'info' ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
                >
                  OVERVIEW
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'decisions' ? 'active' : ''}`}
                  onClick={() => setActiveTab('decisions')}
                  style={{ flex: 'none', border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: activeTab === 'decisions' ? 600 : 400, borderBottom: activeTab === 'decisions' ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent', color: activeTab === 'decisions' ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
                >
                  DECISIONS & NOTES
                </button>
                <button 
                  className={`tab-btn ${activeTab === 'roadmap' ? 'active' : ''}`}
                  onClick={() => setActiveTab('roadmap')}
                  style={{ flex: 'none', border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: activeTab === 'roadmap' ? 600 : 400, borderBottom: activeTab === 'roadmap' ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent', color: activeTab === 'roadmap' ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
                >
                  ROADMAP & ASSUMPTIONS
                </button>
                {data.isMerged && (
                  <button 
                    className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                    onClick={() => setActiveTab('timeline')}
                    style={{ flex: 'none', border: 'none', background: 'transparent', padding: '4px 8px', cursor: 'pointer', fontSize: '11px', fontWeight: activeTab === 'timeline' ? 600 : 400, borderBottom: activeTab === 'timeline' ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent', color: activeTab === 'timeline' ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)' }}
                  >
                    TIMELINE
                  </button>
                )}
              </div>

              {activeTab === 'info' && (
                <>
                  <div className="detail-row">
                    <span className="detail-label">Type</span>
                    <div className="detail-value" style={{ fontWeight: 600, color: 'var(--vscode-focusBorder)' }}>ALIGNMENT TASK</div>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Summary / Narrative</span>
                    <div className="detail-block" style={{ fontWeight: 500, lineHeight: '1.4' }}>
                      {label}
                    </div>
                  </div>
                  {subtitle && (
                    <div className="detail-row">
                      <span className="detail-label">Task ID</span>
                      <div className="detail-value" style={{ fontFamily: 'monospace', fontSize: '11px' }}>{subtitle}</div>
                    </div>
                  )}
                  
                  <button 
                    className="secondary-btn" 
                    style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', width: 'fit-content' }}
                    onClick={() => vscode.postMessage({ 
                      type: 'open_receipt', 
                      projectName: data.projectName || 'orbit', 
                      taskId: selectedNode.id.replace('task:', '').replace('task-node', '') 
                    })}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    Open Planning Receipt in Brain
                  </button>

                  <button 
                    className="secondary-btn" 
                    style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', width: 'fit-content' }}
                    onClick={() => vscode.postMessage({ 
                      type: 'open_walkthrough', 
                      projectName: data.projectName || 'orbit', 
                      taskId: selectedNode.id.replace('task:', '').replace('task-node', '') 
                    })}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <circle cx="9" cy="11" r="1"/>
                      <circle cx="9" cy="15" r="1"/>
                      <line x1="12" y1="11" x2="16" y2="11"/>
                      <line x1="12" y1="15" x2="16" y2="15"/>
                    </svg>
                    Open Task Walkthrough in Brain
                  </button>
                </>
              )}

              {activeTab === 'decisions' && (
                <>
                  {planningContext?.userDecisions && planningContext.userDecisions.length > 0 ? (
                    <div className="detail-row">
                      <span className="detail-label">User Decisions</span>
                      <div className="detail-block">
                        {planningContext.userDecisions.map((d: { question: string; answer: string }, i: number) => (
                          <div key={i} style={{ marginBottom: '8px', borderLeft: '2px solid var(--vscode-button-background)', paddingLeft: '8px' }}>
                            <div style={{ fontWeight: 600, fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>Q: {d.question}</div>
                            <div style={{ marginTop: '2px', fontSize: '12px' }}>A: {d.answer}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="detail-row">
                      <span className="detail-label">User Decisions</span>
                      <div className="detail-block" style={{ fontStyle: 'italic', color: 'var(--vscode-disabledForeground)' }}>
                        No structured questions answered in the Planner.
                      </div>
                    </div>
                  )}

                  {planningContext?.notes && (
                    <div className="detail-row">
                      <span className="detail-label">Planner Notes</span>
                      <div className="detail-block" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{planningContext.notes}</div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'roadmap' && (
                <>
                  {planningContext?.roadmap && planningContext.roadmap.length > 0 ? (
                    <div className="detail-row">
                      <span className="detail-label">Execution Roadmap</span>
                      <div className="detail-block">
                        <ol style={{ margin: '4px 0 0 16px', padding: 0 }}>
                          {planningContext.roadmap.map((r: string, i: number) => (
                            <li key={i} style={{ marginBottom: '4px', lineHeight: '1.4' }}>{r}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  ) : (
                    <div className="detail-row">
                      <span className="detail-label">Execution Roadmap</span>
                      <div className="detail-block" style={{ fontStyle: 'italic', color: 'var(--vscode-disabledForeground)' }}>
                        No step-by-step roadmap submitted.
                      </div>
                    </div>
                  )}

                  {planningContext?.assumptions && planningContext.assumptions.length > 0 && (
                    <div className="detail-row">
                      <span className="detail-label">Assumptions Made</span>
                      <div className="detail-block">
                        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                          {planningContext.assumptions.map((a: string, i: number) => (
                            <li key={i} style={{ marginBottom: '4px', lineHeight: '1.4' }}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {planningContext?.outOfScope && planningContext.outOfScope.length > 0 && (
                    <div className="detail-row">
                      <span className="detail-label">Out Of Scope</span>
                      <div className="detail-block">
                        <ul style={{ margin: '4px 0 0 16px', padding: 0, color: 'var(--vscode-errorForeground)' }}>
                          {planningContext.outOfScope.map((o: string, i: number) => (
                            <li key={i} style={{ marginBottom: '4px' }}>{o}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'timeline' && (
                <>
                  {data.timeline && data.timeline.length > 0 ? (
                    <div className="detail-row">
                      <span className="detail-label">Chronological Merge Timeline</span>
                      <div className="detail-block" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {data.timeline.map((entry: any, i: number) => {
                          let dateStr = entry.timestamp;
                          try {
                            const date = new Date(entry.timestamp);
                            dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
                              " " + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                          } catch {
                            /* ignore date parse error */
                          }

                          return (
                            <div key={i} style={{ borderLeft: '3px solid var(--vscode-focusBorder)', paddingLeft: '8px', marginBottom: '8px' }}>
                              <div style={{ fontWeight: 600, fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                                <span>{entry.summary}</span>
                                <span style={{ opacity: 0.6, fontSize: '10px', whiteSpace: 'nowrap' }}>{dateStr}</span>
                              </div>
                              <div style={{ fontSize: '10px', fontFamily: 'monospace', opacity: 0.6, marginTop: '2px' }}>
                                Task: {entry.taskId.substring(0, 8)}
                              </div>
                              
                              {/* Changed files */}
                              {entry.changes && entry.changes.length > 0 && (
                                <div style={{ marginTop: '6px' }}>
                                  <div style={{ fontSize: '10px', fontWeight: 600, opacity: 0.8 }}>Files Changed:</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                                    {entry.changes.map((c: any, cIdx: number) => (
                                      <div key={cIdx} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span className={`badge badge-${c.changeType}`} style={{ fontSize: '9px', padding: '1px 3px' }}>
                                          {c.changeType.toUpperCase()}
                                        </span>
                                        <span style={{ fontFamily: 'monospace', opacity: 0.9 }}>{c.filePath}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {/* Planning Notes */}
                              {entry.planningContext?.notes && (
                                <div style={{ fontSize: '11px', marginTop: '6px', fontStyle: 'italic', opacity: 0.8, background: 'rgba(128,128,128,0.1)', padding: '4px', borderRadius: '3px' }}>
                                  {entry.planningContext.notes}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="detail-row">
                      <span className="detail-label">Chronological Merge Timeline</span>
                      <div className="detail-block" style={{ fontStyle: 'italic', color: 'var(--vscode-disabledForeground)' }}>
                        No timeline history associated with this report.
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {type === 'directory' && (
            <>
              <div className="detail-row">
                <span className="detail-label">Type</span>
                <div className="detail-value" style={{ fontWeight: 600 }}>DIRECTORY CONTAINER</div>
              </div>
              <div className="detail-row">
                <span className="detail-label">Path</span>
                <div className="detail-value" style={{ fontFamily: 'monospace' }}>{filePath || label}</div>
              </div>
              <div className="detail-row">
                <span className="detail-label">Agent-Synthesized Overview</span>
                <div className="detail-block" style={{ fontStyle: 'italic', borderLeft: '3px solid var(--vscode-focusBorder)', lineHeight: '1.4' }}>
                  {directorySummary}
                </div>
              </div>
            </>
          )}

          {type === 'file' && (
            <>
              <div className="detail-row">
                <span className="detail-label">Type</span>
                <div className="detail-value" style={{ fontWeight: 600 }}>FILE WORKSPACE MODIFICATION</div>
              </div>
              {changeType && (
                <div className="detail-row">
                  <span className="detail-label">Status</span>
                  <div>
                    <span className={`badge badge-${changeType}`}>{changeType.toUpperCase()}</span>
                  </div>
                </div>
              )}
              {filePath && (
                <div className="detail-row">
                  <span className="detail-label">Workspace Path</span>
                  <div className="detail-value" style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>{filePath}</div>
                </div>
              )}

              {filePath && (
                <button 
                  className="secondary-btn" 
                  style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px', width: 'fit-content' }}
                  onClick={() => vscode.postMessage({ type: 'open_file', filePath, projectName: data.projectName })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
                  </svg>
                  Open File in Workspace
                </button>
              )}

              {description && (
                <div className="detail-row">
                  <span className="detail-label">Change Description & Reasoning</span>
                  <div className="detail-block" style={{ lineHeight: '1.4' }}>
                    {description}
                  </div>
                </div>
              )}
              {promptExcerpt && (
                <div className="detail-row">
                  <span className="detail-label">Authorizing Prompt Excerpt</span>
                  <div className="detail-block" style={{ fontStyle: 'italic', borderLeft: '2px solid var(--vscode-focusBorder)', paddingLeft: '6px', lineHeight: '1.4' }}>
                    "{promptExcerpt}"
                  </div>
                </div>
              )}
              {alignmentToolOutput && (
                <div className="detail-row">
                  <span className="detail-label">Associated Planner Decision</span>
                  <div className="detail-block">
                    {(() => {
                      try {
                        const parsed = typeof alignmentToolOutput === 'string'
                          ? JSON.parse(alignmentToolOutput)
                          : alignmentToolOutput;
                        
                        if (parsed && parsed.action && parsed.data) {
                          return (
                            <div style={{ fontSize: '11px' }}>
                              <div style={{ marginBottom: '4px' }}>
                                <span style={{ fontWeight: 600 }}>Action: </span>
                                <span className={`badge badge-${parsed.action}`} style={{ fontSize: '10px' }}>{parsed.action.toUpperCase()}</span>
                              </div>
                              {Object.entries(parsed.data).map(([key, val]: [string, any], idx) => (
                                <div key={idx} style={{ marginTop: '4px' }}>
                                  <div style={{ fontWeight: 600, color: 'var(--vscode-descriptionForeground)' }}>{key}:</div>
                                  <div style={{ paddingLeft: '8px', fontSize: '12px' }}>
                                    {Array.isArray(val) ? val.join(', ') : String(val)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        }
                      } catch {
                        /* ignore json parse error */
                      }

                      return (
                        <pre className="code-block" style={{ margin: 0, padding: '6px', fontSize: '11px' }}>
                          {typeof alignmentToolOutput === 'string'
                            ? alignmentToolOutput
                            : JSON.stringify(alignmentToolOutput, null, 2)}
                        </pre>
                      );
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
