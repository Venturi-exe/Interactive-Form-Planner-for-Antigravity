import React from "react";

export interface QuotaGaugeProps {
  label: string;
  remaining: number; // 0 to 100
  resetTime: string; // e.g. "Ready" or "2h 15m"
  style: "circular-segmented" | "circular-plain" | "horizontal-bar" | "vertical-bar" | "segmented-horizontal-bar" | "segmented-vertical-bar";
  burnRate?: number;
  themeColor?: string;
}

export const QuotaGauge: React.FC<QuotaGaugeProps> = ({
  label,
  remaining,
  resetTime,
  style = "circular-segmented",
  burnRate,
  themeColor,
}) => {
  // Format resetTime: if a pure number arrives, pass through as-is (Quota.tsx handles formatting)
  const formatResetTime = (time: string): string => {
    if (/^\d+$/.test(time.trim())) {
      const num = parseInt(time.trim(), 10);
      if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
      return `${num}`;
    }
    return time;
  };

  // Determine color based on threshold rules
  const getColor = (val: number) => {
    if (val <= 20) return "#FF5252"; // Red (Critical)
    if (val <= 40) return "#FFAB40"; // Yellow (Low warning)
    return "#69F0AE"; // Green (Healthy)
  };

  const statusColor = getColor(remaining);
  const brandColor = themeColor || "#00D2FF";

  // Helper to render radial segmented ticks for concentric rings
  const renderRadialSegments = (
    innerR: number,
    outerR: number,
    totalTicks: number,
    percentage: number,
    color: string,
    width: number,
    rx: number,
    isFullCircle: boolean = true
  ) => {
    const ticks = [];
    const centerX = 50;
    const centerY = 50;
    const height = outerR - innerR;

    for (let i = 0; i < totalTicks; i++) {
      // Offset by 90° so that with the SVG's CSS rotate(-90deg), index 0 appears at visual 12 o'clock
      const angle = 90 + (i / totalTicks) * 360;

      const tickPercentage = (i / totalTicks) * 100;
      // Active ticks fill clockwise from 12 o'clock visual
      const isActive = tickPercentage < percentage || (i === 0 && percentage > 0);
      const tickColor = isActive ? color : "rgba(255, 255, 255, 0.08)";

      ticks.push(
        <rect
          key={i}
          x={centerX - width / 2}
          y={centerY - outerR}
          width={width}
          height={height}
          rx={rx}
          ry={rx}
          fill={tickColor}
          transform={`rotate(${angle} ${centerX} ${centerY})`}
          style={{ transition: "fill 0.3s ease" }}
        />
      );
    }
    return ticks;
  };

  // Helper to render the symmetrical 5-capsule inner concentric ring facing upward with top gap centered at 12 o'clock
  const renderInnerSegmentedArc = (R: number, strokeW: number, color: string) => {
    // 5 segments x 64deg + 5 gaps x 8deg = 360deg.
    // One gap centered at SVG 0deg (visual 12 o'clock after CSS rotate(-90deg)).
    // Gap at SVG 0deg spans 356-4deg.
    const segments = [
      { start: 4,   end: 68  }, // Segment 1: past 12 o'clock gap, clockwise
      { start: 76,  end: 140 }, // Segment 2
      { start: 148, end: 212 }, // Segment 3
      { start: 220, end: 284 }, // Segment 4
      { start: 292, end: 356 }, // Segment 5: ends at 12 o'clock gap
    ];

    return segments.map((seg, idx) => {
      const startRad = (seg.start * Math.PI) / 180;
      const endRad = (seg.end * Math.PI) / 180;

      const x1 = 50 + R * Math.cos(startRad);
      const y1 = 50 + R * Math.sin(startRad);
      const x2 = 50 + R * Math.cos(endRad);
      const y2 = 50 + R * Math.sin(endRad);

      return (
        <path
          key={idx}
          d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          style={{ transition: "stroke 0.3s ease" }}
        />
      );
    });
  };

  switch (style) {
    case "circular-segmented": {
      return (
        <div className="quota-gauge-box circular-segmented" style={{
          borderColor: `${statusColor}44`,
          boxShadow: `0 0 12px ${statusColor}0D`,
          transition: "border-color 0.3s ease, box-shadow 0.3s ease",
        }}>
          <div className="gauge-visual">
            <svg 
              viewBox="0 0 100 100" 
              className="gauge-svg" 
              style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
            >
              {/* Dark groove behind outer radial ticks */}
              <circle cx="50" cy="50" r={43} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={11} />
              <circle cx="50" cy="50" r={43} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
              {/* Dark groove behind inner 5-segment arc */}
              <circle cx="50" cy="50" r={31.5} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={4} />

              {/* Outer brand-colored segmented ring showing remaining quota (starts at 12 o'clock and reduces clockwise) */}
              {renderRadialSegments(39, 47, 40, remaining, brandColor, 3.2, 0.6)}
              
              {/* Inner status-colored concentric ring (5 segments symmetrical arc, facing upward, gap centered at 12 o'clock) */}
              {renderInnerSegmentedArc(31.5, 2, statusColor)}
            </svg>
            <div className="gauge-center-content">
              <span className="gauge-percentage" style={{ color: brandColor, textShadow: `0 0 18px ${brandColor}88` }}>
                {remaining.toFixed(0)}%
              </span>
              <span className="gauge-reset-timer">{formatResetTime(resetTime)}</span>
            </div>
          </div>
          <div className="gauge-label-text">{label}</div>
          {burnRate !== undefined && (
            <div className="gauge-burn-rate">{burnRate.toFixed(1)} %/h</div>
          )}
        </div>
      );
    }

    case "circular-plain": {
      const outerRadius = 43;
      const innerRadius = 32;
      const outerCircumference = 2 * Math.PI * outerRadius;
      const innerCircumference = 2 * Math.PI * innerRadius;

      // Inner plain arc: 352deg arc from SVG 4deg to 356deg, 8deg gap centered at SVG 0deg (visual 12 o'clock)
      const startRad = (4 * Math.PI) / 180;
      const endRad = (356 * Math.PI) / 180;
      const x1 = 50 + innerRadius * Math.cos(startRad);
      const y1 = 50 + innerRadius * Math.sin(startRad);
      const x2 = 50 + innerRadius * Math.cos(endRad);
      const y2 = 50 + innerRadius * Math.sin(endRad);

      const innerArcLength = (352 / 360) * innerCircumference;
      const innerFillLength = (remaining / 100) * innerArcLength;

      return (
        <div className="quota-gauge-box circular-plain" style={{
          borderColor: `${statusColor}44`,
          boxShadow: `0 0 12px ${statusColor}0D`,
          transition: "border-color 0.3s ease, box-shadow 0.3s ease",
        }}>
          <div className="gauge-visual">
            <svg 
              viewBox="0 0 100 100" 
              className="gauge-svg"
              style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
            >
              {/* Dark groove behind outer ring */}
              <circle cx="50" cy="50" r={outerRadius} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={9} />
              {/* Outer Background Track */}
              <circle
                cx="50"
                cy="50"
                r={outerRadius}
                fill="none"
                stroke="rgba(255, 255, 255, 0.04)"
                strokeWidth="6"
              />
              {/* Outer Active progress (Brand Color) - Depletion starts at 12 o'clock and moves clockwise */}
              <circle
                cx="50"
                cy="50"
                r={outerRadius}
                fill="none"
                stroke={brandColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(remaining / 100) * outerCircumference} ${outerCircumference}`}
                strokeDashoffset={0}
                style={{
                  transition: "stroke-dasharray 0.5s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease",
                }}
              />
              {/* Dark groove behind inner arc */}
              <path
                d={`M ${x1} ${y1} A ${innerRadius} ${innerRadius} 0 1 1 ${x2} ${y2}`}
                fill="none"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth={6}
              />
              {/* Inner symmetrical status arc facing upward, gap centered at 12 o'clock */}
              <path
                d={`M ${x1} ${y1} A ${innerRadius} ${innerRadius} 0 1 1 ${x2} ${y2}`}
                fill="none"
                stroke={statusColor}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={`${innerFillLength} ${innerCircumference}`}
                strokeDashoffset={0}
                style={{
                  transition: "stroke-dasharray 0.5s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease",
                }}
              />
            </svg>
            <div className="gauge-center-content">
              <span className="gauge-percentage" style={{ color: brandColor, textShadow: `0 0 18px ${brandColor}88` }}>
                {remaining.toFixed(0)}%
              </span>
              <span className="gauge-reset-timer">{formatResetTime(resetTime)}</span>
            </div>
          </div>
          <div className="gauge-label-text">{label}</div>
          {burnRate !== undefined && (
            <div className="gauge-burn-rate">{burnRate.toFixed(1)} %/h</div>
          )}
        </div>
      );
    }

    case "horizontal-bar":
      return (
        <div
          className="quota-gauge-box horizontal-bar"
          style={{
            borderColor: `${statusColor}44`,
            boxShadow: `0 0 10px ${statusColor}0D`,
          }}
        >
          <div className="gauge-bar-header">
            <span
              className="gauge-label-text"
              title={label}
              style={{
                textAlign: "left",
                ...(label.length > 14 ? { whiteSpace: "normal", lineHeight: "1.2", fontSize: "13px" } : {}),
              }}
            >{label}</span>
            <span className="gauge-percentage-text" style={{ color: brandColor }}>
              {remaining.toFixed(0)}%
            </span>
          </div>
          <div className="progress-bar-container" style={{ background: "rgba(255, 255, 255, 0.04)", height: "10px" }}>
            <div
              className="progress-bar-fill"
              style={{
                width: `${remaining}%`,
                backgroundColor: brandColor,
                transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow: `0 0 8px ${brandColor}33`,
              }}
            />
          </div>
          <div className="gauge-reset-timer bar-reset">{formatResetTime(resetTime)}</div>
          {burnRate !== undefined && (
            <div className="gauge-burn-rate">{burnRate.toFixed(1)} %/h</div>
          )}
        </div>
      );

    case "vertical-bar":
      return (
        <div
          className="quota-gauge-box vertical-bar"
          style={{
            borderColor: `${statusColor}44`,
            boxShadow: `0 0 10px ${statusColor}0D`,
          }}
        >
          <div className="gauge-bar-wrapper">
            <div className="progress-bar-container vertical" style={{ background: "rgba(255, 255, 255, 0.04)", width: "22px" }}>
              <div
                className="progress-bar-fill vertical"
                style={{
                  height: `${remaining}%`,
                  minHeight: "3px",
                  backgroundColor: brandColor,
                  transition: "height 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: `0 0 8px ${brandColor}33`,
                }}
              />
            </div>
            <div className="gauge-center-content vertical">
              <span className="gauge-percentage" style={{ color: brandColor }}>
                {remaining.toFixed(0)}%
              </span>
              <span className="gauge-reset-timer">{formatResetTime(resetTime)}</span>
              {burnRate !== undefined && (
                <div className="gauge-burn-rate">{burnRate.toFixed(1)} %/h</div>
              )}
            </div>
          </div>
          <div className="gauge-label-text">{label}</div>
        </div>
      );

    case "segmented-horizontal-bar": {
      const totalBlocks = 12;
      const blocks = Array.from({ length: totalBlocks });
      return (
        <div
          className="quota-gauge-box segmented-horizontal"
          style={{
            borderColor: `${statusColor}44`,
            boxShadow: `0 0 10px ${statusColor}0D`,
          }}
        >
          <div className="gauge-bar-header">
            <span
              className="gauge-label-text"
              title={label}
              style={{
                textAlign: "left",
                ...(label.length > 14 ? { whiteSpace: "normal", lineHeight: "1.2", fontSize: "13px" } : {}),
              }}
            >{label}</span>
            <span className="gauge-percentage-text" style={{ color: brandColor }}>
              {remaining.toFixed(0)}%
            </span>
          </div>
          <div className="segmented-container horizontal" style={{
            background: "rgba(255, 255, 255, 0.03)",
            height: "14px",
            border: "1px solid rgba(0,0,0,0.4)",
            borderRadius: "6px",
            overflow: "hidden",
          }}>
            {blocks.map((_, i) => {
              const active = remaining >= ((i + 1) / totalBlocks) * 100;
              return (
                <div
                  key={i}
                  className="segmented-block"
                  style={{
                    backgroundColor: active ? brandColor : "transparent",
                    borderRight: i < totalBlocks - 1 ? "2px solid rgba(10, 10, 10, 1.0)" : "none",
                    boxShadow: active ? `0 0 4px ${brandColor}22` : "none",
                  }}
                />
              );
            })}
          </div>
          <div className="gauge-reset-timer bar-reset">{formatResetTime(resetTime)}</div>
          {burnRate !== undefined && (
            <div className="gauge-burn-rate">{burnRate.toFixed(1)} %/h</div>
          )}
        </div>
      );
    }

    case "segmented-vertical-bar": {
      const totalBlocks = 10;
      const blocks = Array.from({ length: totalBlocks });
      return (
        <div
          className="quota-gauge-box segmented-vertical"
          style={{
            borderColor: `${statusColor}44`,
            boxShadow: `0 0 10px ${statusColor}0D`,
          }}
        >
          <div className="gauge-bar-wrapper">
            <div className="segmented-container vertical" style={{
              background: "rgba(255, 255, 255, 0.03)",
              width: "22px",
              border: "1px solid rgba(0,0,0,0.4)",
              borderRadius: "6px",
              overflow: "hidden",
            }}>
              {blocks.map((_, i) => {
                const blockPercentage = ((totalBlocks - i) / totalBlocks) * 100;
                const active = remaining >= blockPercentage;
                return (
                  <div
                    key={i}
                    className="segmented-block vertical"
                    style={{
                      backgroundColor: active ? brandColor : "transparent",
                      borderBottom: i < totalBlocks - 1 ? "2px solid rgba(10, 10, 10, 1.0)" : "none",
                      boxShadow: active ? `0 0 4px ${brandColor}22` : "none",
                    }}
                  />
                );
              })}
            </div>
            <div className="gauge-center-content vertical">
              <span className="gauge-percentage" style={{ color: brandColor }}>
                {remaining.toFixed(0)}%
              </span>
              <span className="gauge-reset-timer">{formatResetTime(resetTime)}</span>
              {burnRate !== undefined && (
                <div className="gauge-burn-rate">{burnRate.toFixed(1)} %/h</div>
              )}
            </div>
          </div>
          <div className="gauge-label-text">{label}</div>
        </div>
      );
    }

    default:
      return null;
  }
};
