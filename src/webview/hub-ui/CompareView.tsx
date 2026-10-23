import React from 'react';
import { ImpactReport, ImpactChange } from '../../types';

interface CompareViewProps {
  selectedReports: ImpactReport[];
  onClearCompare: () => void;
}

export const CompareView: React.FC<CompareViewProps> = ({
  selectedReports,
  onClearCompare,
}) => {
  const [reportA, reportB] = selectedReports;

  // Compute file set details
  const diffDetails = React.useMemo(() => {
    if (!reportA || !reportB) return null;

    const fileMapA = new Map<string, ImpactChange>();
    reportA.changes.forEach((c) => fileMapA.set(c.filePath, c));

    const fileMapB = new Map<string, ImpactChange>();
    reportB.changes.forEach((c) => fileMapB.set(c.filePath, c));

    const allPaths = Array.from(new Set([...fileMapA.keys(), ...fileMapB.keys()]));

    const uniqueToA: { path: string; change: ImpactChange }[] = [];
    const uniqueToB: { path: string; change: ImpactChange }[] = [];
    const shared: { path: string; changeA: ImpactChange; changeB: ImpactChange; isDifferent: boolean }[] = [];

    allPaths.forEach((path) => {
      const changeA = fileMapA.get(path);
      const changeB = fileMapB.get(path);

      if (changeA && !changeB) {
        uniqueToA.push({ path, change: changeA });
      } else if (!changeA && changeB) {
        uniqueToB.push({ path, change: changeB });
      } else if (changeA && changeB) {
        const isDifferent =
          changeA.changeType !== changeB.changeType ||
          changeA.description !== changeB.description;
        shared.push({ path, changeA, changeB, isDifferent });
      }
    });

    return { uniqueToA, uniqueToB, shared };
  }, [reportA, reportB]);

  if (selectedReports.length < 2) {
    return (
      <div className="compare-empty-state">
        <div className="compare-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="9" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <h3>Select Two Reports to Compare</h3>
        <p>Toggle Compare mode on and select checkboxes beside any two reports on the left panel to trigger side-by-side analysis.</p>
      </div>
    );
  }

  const dateStrA = new Date(reportA.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    new Date(reportA.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const dateStrB = new Date(reportB.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    new Date(reportB.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="compare-view-container">
      <div className="compare-header">
        <div className="compare-meta-header">
          <h2>Report Comparison Panel</h2>
          <button className="btn-clear-compare" onClick={onClearCompare}>
            Exit Compare Mode
          </button>
        </div>
        <p className="compare-description">Analyzing file changes between the following two timeline snapshots:</p>

        {/* Side-by-side summaries */}
        <div className="compare-snapshots-summary-row">
          <div className="snapshot-summary-box box-a">
            <span className="snapshot-lbl">SNAPSHOT A (Left)</span>
            <h4>{reportA.summary}</h4>
            <span className="snapshot-ts">{dateStrA}</span>
          </div>
          <div className="compare-vs-badge">VS</div>
          <div className="snapshot-summary-box box-b">
            <span className="snapshot-lbl">SNAPSHOT B (Right)</span>
            <h4>{reportB.summary}</h4>
            <span className="snapshot-ts">{dateStrB}</span>
          </div>
        </div>
      </div>

      <div className="compare-body">
        {/* Unique files in A */}
        {diffDetails && diffDetails.uniqueToA.length > 0 && (
          <div className="compare-diff-section border-a">
            <h4 className="compare-section-title">Unique to Snapshot A ({diffDetails.uniqueToA.length})</h4>
            <div className="compare-diff-grid">
              {diffDetails.uniqueToA.map((item) => (
                <div key={item.path} className="compare-diff-card file-unique-a">
                  <div className="diff-card-header">
                    <span className="diff-file-name">{item.path.split(/[/\\]/).pop()}</span>
                    <span className={`badge badge-cell badge-${item.change.changeType}`}>
                      {item.change.changeType.toUpperCase()}
                    </span>
                  </div>
                  <span className="diff-file-path">{item.path}</span>
                  <p className="diff-file-desc">{item.change.description || item.change.promptExcerpt}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unique files in B */}
        {diffDetails && diffDetails.uniqueToB.length > 0 && (
          <div className="compare-diff-section border-b">
            <h4 className="compare-section-title">Unique to Snapshot B ({diffDetails.uniqueToB.length})</h4>
            <div className="compare-diff-grid">
              {diffDetails.uniqueToB.map((item) => (
                <div key={item.path} className="compare-diff-card file-unique-b">
                  <div className="diff-card-header">
                    <span className="diff-file-name">{item.path.split(/[/\\]/).pop()}</span>
                    <span className={`badge badge-cell badge-${item.change.changeType}`}>
                      {item.change.changeType.toUpperCase()}
                    </span>
                  </div>
                  <span className="diff-file-path">{item.path}</span>
                  <p className="diff-file-desc">{item.change.description || item.change.promptExcerpt}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Shared files */}
        {diffDetails && diffDetails.shared.length > 0 && (
          <div className="compare-diff-section border-shared">
            <h4 className="compare-section-title">Changed in BothSnapshots ({diffDetails.shared.length})</h4>
            <div className="shared-changes-table-wrapper">
              <table className="shared-diff-table">
                <thead>
                  <tr>
                    <th>File Path</th>
                    <th>Snapshot A Modification</th>
                    <th>Snapshot B Modification</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {diffDetails.shared.map((item) => (
                    <tr key={item.path} className={item.isDifferent ? 'shared-different' : 'shared-identical'}>
                      <td className="shared-cell-path" title={item.path}>
                        <strong>{item.path.split(/[/\\]/).pop()}</strong>
                        <span className="shared-full-path">{item.path}</span>
                      </td>
                      <td className="shared-cell-change">
                        <span className={`badge badge-cell badge-${item.changeA.changeType}`}>
                          {item.changeA.changeType.toUpperCase()}
                        </span>
                        <p className="shared-change-desc">{item.changeA.description || item.changeA.promptExcerpt}</p>
                      </td>
                      <td className="shared-cell-change">
                        <span className={`badge badge-cell badge-${item.changeB.changeType}`}>
                          {item.changeB.changeType.toUpperCase()}
                        </span>
                        <p className="shared-change-desc">{item.changeB.description || item.changeB.promptExcerpt}</p>
                      </td>
                      <td className="shared-cell-status">
                        {item.isDifferent ? (
                          <span className="badge-comparison diff-marker">DIFFERENT</span>
                        ) : (
                          <span className="badge-comparison ident-marker">IDENTICAL</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* No difference */}
        {diffDetails && diffDetails.uniqueToA.length === 0 && diffDetails.uniqueToB.length === 0 && diffDetails.shared.length === 0 && (
          <div className="no-diff-state">
            <p>No files are changed in either report. The summaries are identical.</p>
          </div>
        )}
      </div>
    </div>
  );
};
export default CompareView;
