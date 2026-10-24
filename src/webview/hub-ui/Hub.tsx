import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './hub.css';

import { SearchBar } from './SearchBar';
import { ProjectCard } from './ProjectCard';
import { DetailPane } from './DetailPane';
import { CompareView } from './CompareView';
import { StatsPanel } from './StatsPanel';
import { BulkActions } from './BulkActions';

import { ImpactReport, MergedTimelineEntry, ImpactChange } from '../../types';

// Safe VS Code API Hook
declare var acquireVsCodeApi: any;
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : {
  postMessage: (msg: any) => console.log('VSCode PostMessage:', msg),
};

export const HubApp = () => {
  const [reports, setReports] = useState<ImpactReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'stats'>('preview');

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [activeChangeTypes, setActiveChangeTypes] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [mergedFilter, setMergedFilter] = useState<'all' | 'merged' | 'single'>('all');

  // Bulk actions state
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareReportIds, setCompareReportIds] = useState<string[]>([]);

  // Project Tag registry (loaded from extension dynamically or computed from reports)
  const [tagRegistry, setTagRegistry] = useState<Record<string, { color: string; label: string }>>({
    feat: { color: 'var(--tag-color-emerald, #10b981)', label: 'Feature' },
    fix: { color: 'var(--tag-color-rose, #f43f5e)', label: 'Bug Fix' },
    docs: { color: 'var(--tag-color-amber, #f59e0b)', label: 'Documentation' },
    refactor: { color: 'var(--tag-color-violet, #8b5cf6)', label: 'Refactoring' },
  });

  // Load all reports from extension host
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'hub_load_all') {
        const loadedReports = message.reports || [];
        setReports(loadedReports);
        
        // Auto-select first report if none selected
        if (loadedReports.length > 0) {
          setSelectedReportId((prev) => {
            if (!prev) {
              setExpandedProject(loadedReports[0].projectName || 'default');
              return loadedReports[0].filename;
            }
            return prev;
          });
        }
      } else if (message.type === 'hub_load_tags') {
        if (message.tagRegistry) {
          setTagRegistry(message.tagRegistry);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'hub_ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Compute computed lists
  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      // 1. Text Search matching title/summary, project name, task ID, or file paths
      const matchesText =
        report.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (report.projectName || 'default').toLowerCase().includes(searchTerm.toLowerCase()) ||
        report.taskId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        report.changes.some((c) => c.filePath.toLowerCase().includes(searchTerm.toLowerCase()));

      if (!matchesText) return false;

      // 2. Change Type Filter
      if (activeChangeTypes.length > 0) {
        const hasChangeType = report.changes.some((c) => activeChangeTypes.includes(c.changeType));
        if (!hasChangeType) return false;
      }

      // 3. Tag Filter
      if (activeTags.length > 0) {
        const reportTags = report.tags || [];
        const hasMatchingTag = activeTags.some((tag) => reportTags.includes(tag));
        if (!hasMatchingTag) return false;
      }

      // 4. Merged Filter
      if (mergedFilter === 'merged' && !report.isMerged) return false;
      if (mergedFilter === 'single' && report.isMerged) return false;

      return true;
    });
  }, [reports, searchTerm, activeChangeTypes, activeTags, mergedFilter]);

  // Group filtered reports by project name
  const projectsData = useMemo(() => {
    const map = new Map<string, { projectName: string; reports: ImpactReport[]; lastActivity: string }>();
    
    // Process all reports to build clean project cards
    reports.forEach((r) => {
      const pName = r.projectName || 'default';
      if (!map.has(pName)) {
        map.set(pName, { projectName: pName, reports: [], lastActivity: r.timestamp });
      }
      const data = map.get(pName)!;
      data.reports.push(r);
      // Keep track of newest timestamp
      if (new Date(r.timestamp).getTime() > new Date(data.lastActivity).getTime()) {
        data.lastActivity = r.timestamp;
      }
    });

    return Array.from(map.values()).map((p) => {
      // Filter reports inside expanded view according to query
      const filteredProjReports = filteredReports.filter((r) => (r.projectName || 'default') === p.projectName);
      return {
        ...p,
        filteredReports: filteredProjReports,
      };
    }).filter((p) => {
      const hasActiveFilter = searchTerm || activeChangeTypes.length > 0 || activeTags.length > 0 || mergedFilter !== 'all';
      return !hasActiveFilter || p.filteredReports.length > 0;
    });
  }, [reports, filteredReports, searchTerm, activeChangeTypes, activeTags, mergedFilter]);

  // Find active report metadata
  const selectedReport = useMemo(() => {
    return reports.find((r) => r.filename === selectedReportId) || null;
  }, [reports, selectedReportId]);

  // Handle report selection
  const handleSelectReport = (reportId: string, projectName: string) => {
    if (compareMode) {
      setCompareReportIds((prev) => {
        if (prev.includes(reportId)) {
          return prev.filter((id) => id !== reportId);
        }
        if (prev.length >= 2) {
          return [prev[1], reportId]; // Keep max 2
        }
        return [...prev, reportId];
      });
    } else {
      setSelectedReportId(reportId);
      setExpandedProject(projectName);
      setActiveTab('preview');
    }
  };

  // Toggle Project Expand
  const handleToggleProject = (projectName: string) => {
    setExpandedProject((prev) => (prev === projectName ? null : projectName));
  };

  // Checkbox select for bulk actions
  const handleToggleBulkSelect = (reportId: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) {
        next.delete(reportId);
      } else {
        next.add(reportId);
      }
      return next;
    });
  };

  // Clear all bulk selections
  const handleClearBulkSelection = () => {
    setBulkSelectedIds(new Set());
  };

  // Switch to comparison view when clicking compare mode
  const handleToggleCompareMode = () => {
    const nextMode = !compareMode;
    setCompareMode(nextMode);
    setCompareReportIds([]);
    if (!nextMode && reports.length > 0 && !selectedReportId) {
      setSelectedReportId(reports[0].filename || reports[0].taskId || null);
    }
  };

  const selectedReportsForCompare = useMemo(() => {
    return reports.filter((r) => Boolean(r.filename && compareReportIds.includes(r.filename)));
  }, [reports, compareReportIds]);

  return (
    <div className="hub-app-container">
      {/* Search Header */}
      <SearchBar
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        activeChangeTypes={activeChangeTypes}
        setActiveChangeTypes={setActiveChangeTypes}
        activeTags={activeTags}
        setActiveTags={setActiveTags}
        mergedFilter={mergedFilter}
        setMergedFilter={setMergedFilter}
        tagRegistry={tagRegistry}
        compareMode={compareMode}
        onToggleCompareMode={handleToggleCompareMode}
        onExportAll={() => vscode.postMessage({ type: 'hub_export_all_projects' })}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Split Panel Layout */}
      <div className="hub-body-split">
        {/* Left Side: Bento Cards */}
        <div className="hub-left-panel">
          <div className="bento-grid">
            {projectsData.length === 0 ? (
              <div className="empty-projects-state">
                <p>No active Cartograph projects found.</p>
              </div>
            ) : (
              projectsData.map((project) => (
                <ProjectCard
                  key={project.projectName}
                  project={project}
                  isExpanded={expandedProject === project.projectName}
                  onToggle={() => handleToggleProject(project.projectName)}
                  selectedReportId={selectedReportId}
                  onSelectReport={handleSelectReport}
                  bulkSelectedIds={bulkSelectedIds}
                  onToggleBulkSelect={handleToggleBulkSelect}
                  tagRegistry={tagRegistry}
                  compareMode={compareMode}
                  compareReportIds={compareReportIds}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Side: Detail / Compare / Stats Panel */}
        <div className="hub-right-panel">
          {compareMode ? (
            <CompareView
              selectedReports={selectedReportsForCompare}
              onClearCompare={() => setCompareReportIds([])}
            />
          ) : activeTab === 'stats' ? (
            <StatsPanel reports={reports} />
          ) : selectedReport ? (
            <DetailPane
              report={selectedReport}
              tagRegistry={tagRegistry}
              setReports={setReports}
              vscode={vscode}
              onOpenStats={() => setActiveTab('stats')}
            />
          ) : (
            <div className="empty-detail-state">
              <p>Select a report to preview its impact canvas and details.</p>
              <button className="stats-tab-btn" onClick={() => setActiveTab('stats')}>
                View Statistics Dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bulk Actions Bar */}
      {bulkSelectedIds.size > 0 && (
        <BulkActions
          selectedIds={bulkSelectedIds}
          reports={reports}
          onClear={handleClearBulkSelection}
          vscode={vscode}
        />
      )}
    </div>
  );
};

// Mount Hub
const mountElement = document.getElementById('hub-root');
if (mountElement) {
  const root = createRoot(mountElement);
  root.render(
    <ReactFlowProvider>
      <HubApp />
    </ReactFlowProvider>
  );
}
