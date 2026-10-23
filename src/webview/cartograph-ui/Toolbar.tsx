import React from 'react';

interface ToolbarProps {
  onLayout: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onLayout,
  onFitView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  return (
    <div className="floating-toolbar">
      {/* Auto-Layout Action */}
      <button 
        className="toolbar-btn" 
        onClick={onLayout} 
        title="Auto-Arrange Layout (Dagre Directed Flow)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 8.5v3h6v-3H5zm7-2H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1zM2 1h12v4H2V1z"/>
        </svg>
      </button>

      {/* Reset Viewport Action */}
      <button 
        className="toolbar-btn" 
        onClick={onFitView} 
        title="Fit Diagram to Canvas Viewport"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 1h3V0h-4v4h1V1.5zm13-1h-3v1h3v2.5h1v-4zM1 11.5h-1v4h4v-1h-3zm14 3h-3v1h4v-4h-1zM8 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>
        </svg>
      </button>

      <div className="toolbar-separator" />

      {/* Undo History Action */}
      <button 
        className="toolbar-btn" 
        onClick={onUndo} 
        disabled={!canUndo}
        title="Undo Changes"
        style={{ opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12 8A4 4 0 0 0 8 4h-2.17l1.73-1.73L6.85 1.55 3.7 4.7l3.15 3.15.71-.71L5.83 5.4H8a2.6 2.6 0 1 1 0 5.2H4.5v1.4H8a4 4 0 0 0 4-4z"/>
        </svg>
      </button>

      {/* Redo History Action */}
      <button 
        className="toolbar-btn" 
        onClick={onRedo} 
        disabled={!canRedo}
        title="Redo Changes"
        style={{ opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 8a4 4 0 0 0 4 4h2.17l-1.73 1.73.71.71L12.3 11.3 9.15 8.15l-.71.71 1.73 1.74H8a2.6 2.6 0 1 1 0-5.2h3.5V4H8a4 4 0 0 0-4 4z"/>
        </svg>
      </button>

    </div>
  );
};
