import React from 'react';

interface SearchBarProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  activeChangeTypes: string[];
  setActiveChangeTypes: React.Dispatch<React.SetStateAction<string[]>>;
  activeTags: string[];
  setActiveTags: React.Dispatch<React.SetStateAction<string[]>>;
  mergedFilter: 'all' | 'merged' | 'single';
  setMergedFilter: (filter: 'all' | 'merged' | 'single') => void;
  tagRegistry: Record<string, { color: string; label: string }>;
  compareMode: boolean;
  onToggleCompareMode: () => void;
  onExportAll: () => void;
  activeTab: 'preview' | 'stats';
  setActiveTab: (tab: 'preview' | 'stats') => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchTerm,
  setSearchTerm,
  activeChangeTypes,
  setActiveChangeTypes,
  activeTags,
  setActiveTags,
  mergedFilter,
  setMergedFilter,
  tagRegistry,
  compareMode,
  onToggleCompareMode,
  onExportAll,
  activeTab,
  setActiveTab,
}) => {
  const changeTypeOptions = ['created', 'edited', 'moved', 'deleted'];

  const toggleChangeType = (type: string) => {
    setActiveChangeTypes((prev) => {
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  };

  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      }
      return [...prev, tag];
    });
  };

  return (
    <div className="search-bar-sticky-header">
      <div className="search-top-line">
        <div className="hub-brand-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '8px' }}>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <h1>Orbit Hub</h1>
        </div>

        {/* Global actions */}
        <div className="hub-global-actions">
          <button
            className={`btn-hub-global-action btn-stats-toggle ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab(activeTab === 'stats' ? 'preview' : 'stats')}
            title="Toggle Statistics Dashboard"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            {activeTab === 'stats' ? 'Viewing Stats...' : 'View Project Statistics'}
          </button>

          <button
            className={`btn-hub-global-action btn-compare-toggle ${compareMode ? 'active' : ''}`}
            onClick={onToggleCompareMode}
            title="Toggle Compare Mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            {compareMode ? 'Comparing...' : 'Compare Reports'}
          </button>

          <button
            className="btn-hub-global-action btn-export-all"
            onClick={onExportAll}
            title="Export all project data"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export Backup
          </button>
        </div>
      </div>

      {/* Main Search Input */}
      <div className="search-input-wrapper">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="search-icon-svg">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Filter by summary text, task ID, file paths, or project name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="main-search-input"
        />
        {searchTerm && (
          <button className="clear-search-btn" onClick={() => setSearchTerm('')}>
            &times;
          </button>
        )}
      </div>

      {/* Filter Chips */}
      <div className="filter-chips-row">
        {/* Merged Filter dropdown */}
        <div className="filter-group">
          <span className="filter-lbl">Timeline:</span>
          <div className="segmented-control">
            <button
              className={`segment-btn ${mergedFilter === 'all' ? 'active' : ''}`}
              onClick={() => setMergedFilter('all')}
            >
              All
            </button>
            <button
              className={`segment-btn ${mergedFilter === 'merged' ? 'active' : ''}`}
              onClick={() => setMergedFilter('merged')}
            >
              Merged
            </button>
            <button
              className={`segment-btn ${mergedFilter === 'single' ? 'active' : ''}`}
              onClick={() => setMergedFilter('single')}
            >
              Single
            </button>
          </div>
        </div>

        {/* Change Type Chips */}
        <div className="filter-group">
          <span className="filter-lbl">Changes:</span>
          <div className="filter-chips">
            {changeTypeOptions.map((type) => {
              const isSelected = activeChangeTypes.includes(type);
              return (
                <button
                  key={type}
                  className={`chip-filter-btn change-chip-${type} ${isSelected ? 'active' : ''}`}
                  onClick={() => toggleChangeType(type)}
                >
                  {type.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tag Chips & Dropdown Selector */}
        {Object.keys(tagRegistry).length > 0 && (() => {
          const presets = ['feat', 'fix', 'docs', 'refactor'];
          const presetTags = Object.entries(tagRegistry).filter(([key]) => presets.includes(key));
          const otherTags = Object.entries(tagRegistry).filter(([key]) => !presets.includes(key));
          
          return (
            <div className="filter-group">
              <span className="filter-lbl">Semantic Tags:</span>
              <div className="filter-chips" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* 1. Presets */}
                {presetTags.map(([tagKey, reg]) => {
                  const isSelected = activeTags.includes(tagKey);
                  return (
                    <button
                      key={tagKey}
                      className={`chip-filter-btn tag-chip-btn ${isSelected ? 'active' : ''}`}
                      onClick={() => toggleTag(tagKey)}
                      style={{
                        borderLeft: `3px solid ${reg.color}`,
                        backgroundColor: isSelected ? 'var(--vscode-focusBorder)' : 'rgba(128, 128, 128, 0.12)',
                      }}
                    >
                      {reg.label}
                    </button>
                  );
                })}

                {/* 2. Other Active Tags (rendered as active chips) */}
                {otherTags.filter(([key]) => activeTags.includes(key)).map(([tagKey, reg]) => (
                  <button
                    key={tagKey}
                    className="chip-filter-btn tag-chip-btn active"
                    onClick={() => toggleTag(tagKey)}
                    style={{
                      borderLeft: `3px solid ${reg.color}`,
                      backgroundColor: 'var(--vscode-focusBorder)',
                      color: '#ffffff',
                    }}
                  >
                    {reg.label} &times;
                  </button>
                ))}

                {/* 3. Dropdown for inactive other tags */}
                {otherTags.filter(([key]) => !activeTags.includes(key)).length > 0 && (
                  <select
                    className="more-tags-select"
                    onChange={(e) => {
                      if (e.target.value) {
                        toggleTag(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>More...</option>
                    {otherTags.filter(([key]) => !activeTags.includes(key)).map(([tagKey, reg]) => (
                      <option key={tagKey} value={tagKey}>
                        {reg.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
