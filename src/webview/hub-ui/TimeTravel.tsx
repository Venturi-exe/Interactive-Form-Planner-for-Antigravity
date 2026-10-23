import React, { useState, useEffect, useRef } from 'react';
import { MergedTimelineEntry } from '../../types';

interface TimeTravelProps {
  timeline: MergedTimelineEntry[];
  activeStep: number;
  setActiveStep: (step: number) => void;
}

export const TimeTravel: React.FC<TimeTravelProps> = ({
  timeline,
  activeStep,
  setActiveStep,
}) => {
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActiveStep(parseInt(e.target.value, 10));
  };

  const activeEntry = timeline[activeStep];
  const formatDate = (ts: string) => {
    try {
      const date = new Date(ts);
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + 
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className="time-travel-scrubber-wrapper">
      <div className="slider-container">
        <input
          type="range"
          min="0"
          max={timeline.length - 1}
          value={activeStep}
          onChange={handleSliderChange}
          className="timeline-slider"
        />
        <div className="slider-ticks">
          {timeline.map((entry, idx) => {
            const percent = timeline.length > 1 ? (idx / (timeline.length - 1)) * 100 : 0;
            return (
              <div
                key={entry.taskId}
                className={`slider-tick ${idx <= activeStep ? 'active' : ''}`}
                style={{ left: `calc(${percent / 100} * (100% - 12px) + 6px)` }}
                title={entry.summary}
                onClick={() => {
                  setActiveStep(idx);
                }}
              />
            );
          })}
        </div>
      </div>

      {activeEntry && (
        <div className="active-step-meta">
          <div className="step-badge">
            Step {activeStep + 1} of {timeline.length}
          </div>
          <div className="step-details">
            <span className="step-summary" title={activeEntry.summary}>
              {activeEntry.summary}
            </span>
            <span className="step-timestamp">{formatDate(activeEntry.timestamp)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
