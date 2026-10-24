import React, { useMemo } from 'react';
import { ImpactReport } from '../../types';

interface StatsPanelProps {
  reports: ImpactReport[];
}

export const StatsPanel: React.FC<StatsPanelProps> = ({ reports }) => {
  // Aggregate Project Metrics
  const projectMetrics = useMemo(() => {
    const map = new Map<string, { reportCount: number; fileCount: number; mergedCount: number }>();
    reports.forEach((r) => {
      const pName = r.projectName || 'default';
      if (!map.has(pName)) {
        map.set(pName, { reportCount: 0, fileCount: 0, mergedCount: 0 });
      }
      const data = map.get(pName)!;
      data.reportCount += 1;
      data.fileCount += r.changes.length;
      if (r.isMerged) data.mergedCount += 1;
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [reports]);

  // Aggregate Agent Alignment Insights Metrics (Questions vs Decisions Approved)
  const alignmentMetrics = useMemo(() => {
    let totalQuestions = 0;
    let totalDecisions = 0;
    let totalAssumptions = 0;
    let totalRoadmaps = 0;
    let reportsWithContext = 0;

    reports.forEach((r) => {
      if (r.planningContext) {
        reportsWithContext += 1;
        totalQuestions += r.planningContext.questionsAsked?.length || 0;
        totalDecisions += r.planningContext.userDecisions?.length || 0;
        totalAssumptions += r.planningContext.assumptions?.length || 0;
        totalRoadmaps += r.planningContext.roadmap?.length || 0;
      }
    });

    return {
      totalQuestions,
      totalDecisions,
      totalAssumptions,
      totalRoadmaps,
      reportsWithContext,
      reportsWithoutContext: reports.length - reportsWithContext,
    };
  }, [reports]);

  // Build Project Bar Chart SVG points
  const barChartSvg = useMemo(() => {
    if (projectMetrics.length === 0) return null;
    const maxVal = Math.max(...projectMetrics.map((m) => m.fileCount), 1);
    const chartHeight = Math.max(120, projectMetrics.length * 35);

    return (
      <svg width="100%" height={chartHeight} viewBox={`0 0 400 ${chartHeight}`} className="svg-stats-chart">
        {projectMetrics.map((proj, idx) => {
          const barWidth = (proj.fileCount / maxVal) * 220;
          const y = idx * 35 + 20;
          const projLabel = proj.name === 'default' ? 'Default' : proj.name.substring(0, 10);
          return (
            <g key={proj.name}>
              <text x="10" y={y + 12} fill="var(--vscode-foreground)" fontSize="10" fontWeight="600">
                {projLabel}
              </text>
              <rect x="90" y={y} width="230" height="18" rx="3" fill="var(--vscode-sideBar-background)" opacity="0.4" />
              <rect x="90" y={y} width={barWidth} height="18" rx="3" fill="var(--vscode-focusBorder, #007acc)" />
              <text x={95 + barWidth} y={y + 12} fill="var(--vscode-foreground)" fontSize="10">
                {proj.fileCount} files
              </text>
            </g>
          );
        })}
      </svg>
    );
  }, [projectMetrics]);

  // Build Chronological Timeline Sparkline SVG points
  const timelineSparklineSvg = useMemo(() => {
    if (reports.length === 0) return null;

    // Group reports by day
    const dayMap = new Map<string, number>();
    const sorted = [...reports].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    sorted.forEach((r) => {
      try {
        const dateStr = new Date(r.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
        dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + 1);
      } catch {
        /* ignore invalid date string */
      }
    });

    const dayData = Array.from(dayMap.entries());
    if (dayData.length === 0) return null;

    const maxReports = Math.max(...dayData.map((d) => d[1]), 1);
    const width = 380;
    const height = 80;
    const padding = 20;

    const points = dayData.map((d, idx) => {
      const x = padding + (idx / Math.max(1, dayData.length - 1)) * (width - padding * 2);
      const y = height - padding - (d[1] / maxReports) * (height - padding * 2);
      return { x, y, label: d[0], count: d[1] };
    });

    const pathD = points.reduce((path, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${path} L ${p.x} ${p.y}`;
    }, '');

    return (
      <svg width="100%" height="120" viewBox="0 0 400 120" className="svg-stats-chart">
        {points.length > 1 && (
          <path d={pathD} fill="none" stroke="var(--vscode-focusBorder)" strokeWidth="2.5" strokeLinecap="round" />
        )}
        
        {points.map((p, idx) => (
          <g key={idx}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="var(--vscode-focusBorder)" strokeWidth="1.5" />
            <text x={p.x} y={110} fill="var(--vscode-foreground)" fontSize="8" textAnchor="middle" opacity="0.7">
              {p.label}
            </text>
            <text x={p.x} y={p.y - 8} fill="var(--vscode-foreground)" fontSize="8" textAnchor="middle" fontWeight="bold">
              {p.count}
            </text>
          </g>
        ))}
      </svg>
    );
  }, [reports]);

  // Aggregate global counts
  const totalFilesCount = useMemo(() => {
    let count = 0;
    reports.forEach((r) => (count += r.changes.length));
    return count;
  }, [reports]);

  return (
    <div className="stats-panel-container">
      <div className="stats-header">
        <h2>Cartograph Analytics & Insights Dashboard</h2>
        <p className="stats-description">Real-time statistics aggregating all tasks, impact footprints, and agent-user interactions across active projects.</p>
      </div>

      {/* Bento Stats Summary Cards */}
      <div className="stats-summary-grid">
        <div className="stats-summary-card">
          <span className="summary-lbl">TOTAL Snapshots</span>
          <div className="summary-val">{reports.length}</div>
          <span className="summary-sub">Impact reports recorded</span>
        </div>

        <div className="stats-summary-card">
          <span className="summary-lbl">FILES TRACKED</span>
          <div className="summary-val">{totalFilesCount}</div>
          <span className="summary-sub">Cumulative modifications</span>
        </div>

        <div className="stats-summary-card">
          <span className="summary-lbl">PROJECT GROUPS</span>
          <div className="summary-val">{projectMetrics.length}</div>
          <span className="summary-sub">Distinct active branches</span>
        </div>

        <div className="stats-summary-card">
          <span className="summary-lbl">CONSOLIDATIONS</span>
          <div className="summary-val">
            {reports.filter((r) => r.isMerged).length}
          </div>
          <span className="summary-sub">Merged chronicled timelines</span>
        </div>
      </div>

      {/* SVG Charts Row */}
      <div className="stats-charts-row">
        <div className="stats-chart-card">
          <h4 className="chart-card-title">Impact Footprint per Project (Changed Files)</h4>
          {barChartSvg ? barChartSvg : <p className="no-data-lbl">No project metrics to plot</p>}
        </div>

        <div className="stats-chart-card">
          <h4 className="chart-card-title">Task Snapshots Frequency Timeline</h4>
          {timelineSparklineSvg ? timelineSparklineSvg : <p className="no-data-lbl">No activity history to plot</p>}
        </div>
      </div>

      {/* Agent Alignment Insights (Parsed from planningContext) */}
      <div className="stats-alignment-section">
        <h4 className="alignment-section-title">Agent Alignment Insights</h4>
        <p className="alignment-description">Parses planning metadata collected during turn execution to measure agent prompt precision and decisions alignment ratios.</p>

        {alignmentMetrics.reportsWithContext > 0 ? (
          <div className="alignment-insights-card">
            <div className="insights-metrics-grid">
              <div className="insight-metric">
                <span className="metric-title">Questions Asked</span>
                <div className="metric-val">{alignmentMetrics.totalQuestions}</div>
                <span className="metric-sub">Alignment cycles triggered</span>
              </div>

              <div className="insight-metric">
                <span className="metric-title">Decisions Approved</span>
                <div className="metric-val">{alignmentMetrics.totalDecisions}</div>
                <span className="metric-sub">Plan structures locked by user</span>
              </div>

              <div className="insight-metric">
                <span className="metric-title">Assumptions Logged</span>
                <div className="metric-val">{alignmentMetrics.totalAssumptions}</div>
                <span className="metric-sub">Technical parameters identified</span>
              </div>

              <div className="insight-metric">
                <span className="metric-title">Roadmap Tasks</span>
                <div className="metric-val">{alignmentMetrics.totalRoadmaps}</div>
                <span className="metric-sub">Completed workflow checklist items</span>
              </div>
            </div>

            {/* Quality index summary */}
            <div className="insights-analysis-box">
              <div className="insights-indicator-bar">
                <div className="ratio-bar-label">
                  <span>Context coverage: {alignmentMetrics.reportsWithContext} of {reports.length} reports ({Math.round((alignmentMetrics.reportsWithContext / reports.length) * 100)}%)</span>
                </div>
                <div className="ratio-bar-track">
                  <div 
                    className="ratio-bar-fill" 
                    style={{ width: `${(alignmentMetrics.reportsWithContext / reports.length) * 100}%` }}
                  />
                </div>
              </div>
              <p className="insights-notes-text">
                <strong>Analysis:</strong> The agent has operated with an alignment factor of {(alignmentMetrics.totalQuestions / Math.max(1, alignmentMetrics.totalDecisions)).toFixed(1)} questions asked per decision. High ratio indicates high collaborative alignment. Low ratio indicates self-contained execute sprints.
              </p>
            </div>
          </div>
        ) : (
          <div className="alignment-fallback-state">
            <div className="fallback-tag-badge">No Planning Metadata</div>
            <p>No reports contain planning context metadata (questions, decisions, assumptions). Agent Alignment metrics will display here automatically once reports are written with full `planningContext` objects.</p>
          </div>
        )}
      </div>
    </div>
  );
};
export default StatsPanel;
