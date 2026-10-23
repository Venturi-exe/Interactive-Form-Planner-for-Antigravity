import React, { useState } from "react";

interface UserInfoProps {
  name?: string;
  email?: string;
  tier?: string;
}

export const UserInfoCard: React.FC<UserInfoProps> = ({ name, email, tier }) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="user-info-card">
      <div className="user-profile-header" onClick={() => setShowDetails(!showDetails)}>
        <div className="avatar-container">
          <svg className="avatar-svg" viewBox="0 0 24 24" width="32" height="32">
            <circle cx="12" cy="12" r="10" fill="var(--vscode-button-background)" />
            <path
              d="M12 14c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
              fill="var(--vscode-button-foreground)"
            />
            <circle cx="12" cy="8" r="4" fill="var(--vscode-button-foreground)" />
          </svg>
        </div>
        <div className="user-header-text">
          <div className="user-plan-tier">{tier || "Pro Plan"}</div>
          <div className="user-click-tip">Click avatar for profile</div>
        </div>
        <div className={`arrow-indicator ${showDetails ? "open" : ""}`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M7 10l5 5 5-5H7z" />
          </svg>
        </div>
      </div>

      {showDetails && (
        <div className="user-details-collapsible">
          {name && (
            <div className="detail-row">
              <span className="detail-label">Name:</span>
              <span className="detail-value">{name}</span>
            </div>
          )}
          {email && (
            <div className="detail-row">
              <span className="detail-label">Email:</span>
              <span className="detail-value">{email}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
