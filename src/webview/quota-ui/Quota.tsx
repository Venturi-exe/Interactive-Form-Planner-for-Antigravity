import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QuotaGauge } from "./QuotaGauge";

// Expose vscode API safely
const vscode = (window as any).acquireVsCodeApi
  ? (window as any).acquireVsCodeApi()
  : {
      postMessage: (msg: any) => console.log("VSCode PostMessage:", msg),
      getState: () => ({}),
      setState: (state: any) => {},
    };

interface QuotaGroupState {
  id: string;
  label: string;
  remaining: number;
  resetTime: string;
  themeColor: string;
  hasData: boolean;
  burnRate?: number;
}

interface UserCredit {
  creditType: string;
  creditAmount: string;
}

interface PromptCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}

interface FlowCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}

interface TokenUsageInfo {
  promptCredits?: PromptCreditsInfo;
  flowCredits?: FlowCreditsInfo;
  totalAvailable: number;
  totalMonthly: number;
  overallRemainingPercentage: number;
  userCredits?: UserCredit[];
}

interface UserInfo {
  name?: string;
  email?: string;
  tier?: string;
}

interface QuotaViewState {
  groups: QuotaGroupState[];
  burnRate: string;
  userInfo?: UserInfo;
  tokenUsage?: TokenUsageInfo;
  gaugeStyle: "circular-segmented" | "circular-plain" | "horizontal-bar" | "vertical-bar" | "segmented-horizontal-bar" | "segmented-vertical-bar";
}

export const QuotaPanel: React.FC = () => {
  const [state, setState] = useState<QuotaViewState>({
    groups: [
      { id: "gemini-flash", label: "Gemini Flash", remaining: 100, resetTime: "Ready", themeColor: "#40C4FF", hasData: false },
      { id: "gemini-pro", label: "Gemini Pro", remaining: 100, resetTime: "Ready", themeColor: "#69F0AE", hasData: false },
      { id: "claude", label: "Claude", remaining: 100, resetTime: "Ready", themeColor: "#FFAB40", hasData: false },
      { id: "gpt", label: "GPT", remaining: 100, resetTime: "Ready", themeColor: "#FF5252", hasData: false },
    ],
    burnRate: "Burn Rate: 0.0 %/h",
    gaugeStyle: "circular-segmented",
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore cached state on mount
    const cached = vscode.getState();
    if (cached && (cached as any).groups) {
      setState(cached as QuotaViewState);
      setLoading(false);
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "quotaUpdate" && message.payload) {
        const newState = message.payload as QuotaViewState;
        setState(newState);
        vscode.setState(newState);
        setLoading(false);
      }
    };

    window.addEventListener("message", handleMessage);

    // Notify extension host that webview is ready
    vscode.postMessage({ type: "webviewReady" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    vscode.postMessage({ type: "refreshQuota" });
  };

  const handleOpenSettings = () => {
    vscode.postMessage({ type: "openSettings" });
  };

  const formatLargeNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return num.toString();
  };

  return (
    <div className="quota-panel-container">
      {/* Top compact Header */}
      <div className="sidebar-header">
        <button onClick={handleOpenSettings} title="Open Orbit Settings" className="icon-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <div className="header-spacer"></div>
        <button onClick={handleRefresh} disabled={loading} title="Refresh" className={`icon-btn ${loading ? "spinning" : ""}`}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="sidebar-scroll">
        <div className="meter-stack">
          {/* Model Quota Cards */}
          {state.groups.map((group) => (
            <QuotaGauge
              key={group.id}
              label={group.label}
              remaining={group.remaining}
              resetTime={group.resetTime}
              style={state.gaugeStyle}
              burnRate={group.burnRate}
              themeColor={group.themeColor}
            />
          ))}

          {/* Available AI Credits Gauge Card */}
          {state.tokenUsage && state.tokenUsage.totalMonthly > 0 && (
            <QuotaGauge
              label="Available AI Credits"
              remaining={state.tokenUsage.overallRemainingPercentage}
              resetTime={`${formatLargeNumber(state.tokenUsage.totalAvailable)} / ${formatLargeNumber(state.tokenUsage.totalMonthly)}`}
              style={state.gaugeStyle}
              themeColor="#FFFFFF"
            />
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="bottom-utility-row">
        <a href="https://github.com/Venturi-exe/Interactive-Form-Planner-for-Antigravity/issues" target="_blank" rel="noopener noreferrer" className="bottom-utility-btn">
          Feedback
        </a>
        <a href="mailto:vntrcorp@gmail.com" className="bottom-utility-btn">
          Contact
        </a>
      </div>
    </div>
  );
};

const container = document.getElementById("quota-root");
if (container) {
  const root = createRoot(container);
  root.render(<QuotaPanel />);
}
