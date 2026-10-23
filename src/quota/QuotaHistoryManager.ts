/**
 * QuotaHistoryManager: Persists historical remaining percentages,
 * calculates hourly burn rates (%/h), and triggers history clears on quota resets.
 */

import * as vscode from "vscode";

export interface QuotaHistoryPoint {
  timestamp: number;
  usage: Record<string, number>; // Maps groupId to remainingPercentage
}

const STORAGE_KEY = "orbit.quotaHistory_v2";

export class QuotaHistoryManager {
  private history: QuotaHistoryPoint[] = [];
  private globalState: vscode.Memento;
  private maxHistoryDays: number = 7;

  constructor(globalState: vscode.Memento) {
    this.globalState = globalState;
    this.load();
  }

  setHistoryRange(days: number): void {
    this.maxHistoryDays = days;
    this.trimOldHistory();
  }

  /**
   * Records a new quota data point and checks for quota resets
   */
  async recordQuotaPoint(usage: Record<string, number>): Promise<void> {
    const now = Date.now();

    // Reset detection: if remaining percentage increases significantly, clear history for that group
    if (this.history.length > 0) {
      const lastPoint = this.history[this.history.length - 1];
      for (const groupId of Object.keys(usage)) {
        const lastVal = lastPoint.usage[groupId];
        const newVal = usage[groupId];

        if (lastVal !== undefined && newVal > lastVal + 0.1) {
          console.log(`[QuotaHistoryManager] Quota reset detected for ${groupId} (from ${lastVal.toFixed(1)}% to ${newVal.toFixed(1)}%). Resetting history logs.`);
          this.clearGroupHistory(groupId);
        }
      }
    }

    const point: QuotaHistoryPoint = {
      timestamp: now,
      usage,
    };

    this.history.push(point);
    await this.save();
  }

  /**
   * Clears historical points for a specific group (e.g. after a reset)
   */
  private clearGroupHistory(groupId: string): void {
    this.history = this.history.map(p => {
      if (p.usage[groupId] === undefined) return p;
      const updatedUsage = { ...p.usage };
      delete updatedUsage[groupId];
      return {
        ...p,
        usage: updatedUsage,
      };
    }).filter(p => Object.keys(p.usage).length > 0);
  }

  /**
   * Calculates the current burn rate (%/h) based on history in the last few hours (up to 24h)
   */
  calculateBurnRate(): number {
    if (this.history.length < 2) {
      return 0.0;
    }

    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000; // Limit burn rate window to last 24 hours
    const activeHistory = this.history.filter(p => p.timestamp >= cutoff);

    if (activeHistory.length < 2) {
      return 0.0;
    }

    const firstPoint = activeHistory[0];
    const lastPoint = activeHistory[activeHistory.length - 1];
    const timeDeltaHours = (lastPoint.timestamp - firstPoint.timestamp) / (1000 * 60 * 60);

    if (timeDeltaHours < 0.05) {
      return 0.0; // Avoid high volatility on tiny time steps
    }

    let maxBurnRate = 0.0;

    // Calculate burn rate per group and take the maximum rate of consumption
    const allGroups = new Set<string>();
    activeHistory.forEach(p => Object.keys(p.usage).forEach(g => allGroups.add(g)));

    for (const groupId of allGroups) {
      const initialVal = firstPoint.usage[groupId];
      const currentVal = lastPoint.usage[groupId];

      if (initialVal !== undefined && currentVal !== undefined) {
        // Burn rate represents percentage points consumed per hour
        const consumed = initialVal - currentVal;
        if (consumed > 0) {
          const rate = consumed / timeDeltaHours;
          if (rate > maxBurnRate) {
            maxBurnRate = rate;
          }
        }
      }
    }

    return parseFloat(maxBurnRate.toFixed(1));
  }

  getGroupBurnRate(groupId: string): number {
    if (this.history.length < 2) {
      return 0.0;
    }

    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000; // Limit burn rate window to last 24 hours
    const activeHistory = this.history.filter(p => p.timestamp >= cutoff);

    if (activeHistory.length < 2) {
      return 0.0;
    }

    const firstPoint = activeHistory[0];
    const lastPoint = activeHistory[activeHistory.length - 1];
    const timeDeltaHours = (lastPoint.timestamp - firstPoint.timestamp) / (1000 * 60 * 60);

    if (timeDeltaHours < 0.05) {
      return 0.0;
    }

    const initialVal = firstPoint.usage[groupId];
    const currentVal = lastPoint.usage[groupId];

    if (initialVal !== undefined && currentVal !== undefined) {
      const consumed = initialVal - currentVal;
      if (consumed > 0) {
        return parseFloat((consumed / timeDeltaHours).toFixed(1));
      }
    }

    return 0.0;
  }

  private load(): void {
    const data = this.globalState.get<QuotaHistoryPoint[]>(STORAGE_KEY);
    if (data && Array.isArray(data)) {
      this.history = data;
      this.trimOldHistory();
    }
  }

  private async save(): Promise<void> {
    this.trimOldHistory();
    await this.globalState.update(STORAGE_KEY, this.history);
  }

  private trimOldHistory(): void {
    const cutoff = Date.now() - this.maxHistoryDays * 24 * 60 * 60 * 1000;
    this.history = this.history.filter(p => p.timestamp >= cutoff);
  }

  async clear(): Promise<void> {
    this.history = [];
    await this.globalState.update(STORAGE_KEY, []);
    console.log("[QuotaHistoryManager] History cleared successfully.");
  }
}
