/**
 * QuotaService: Gateway client that retrieves and parses Cascade AI models
 * and available promotional / monthly prompt and flow credits.
 */

import { httpRequest, HttpResponse } from "./http_client";
import { QuotaStrategyManager, GroupDefinition } from "./QuotaStrategy";

export interface ModelQuotaInfo {
  label: string;
  modelId: string;
  remainingPercentage: number;
  isExhausted: boolean;
  resetTime: Date;
  timeUntilReset: string;
}

export interface PromptCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface FlowCreditsInfo {
  available: number;
  monthly: number;
  usedPercentage: number;
  remainingPercentage: number;
}

export interface UserCredit {
  creditType: string;
  creditAmount: string;
}

export interface TokenUsageInfo {
  promptCredits?: PromptCreditsInfo;
  flowCredits?: FlowCreditsInfo;
  totalAvailable: number;
  totalMonthly: number;
  overallRemainingPercentage: number;
  userCredits?: UserCredit[];
}

export interface UserInfo {
  name?: string;
  email?: string;
  tier?: string;
  tierId?: string;
  tierDescription?: string;
  planName?: string;
  teamsTier?: string;
  upgradeUri?: string;
  upgradeText?: string;
  browserEnabled?: boolean;
  knowledgeBaseEnabled?: boolean;
  canBuyMoreCredits?: boolean;
  monthlyPromptCredits?: number;
  availablePromptCredits?: number;
}

export interface QuotaSnapshot {
  timestamp: Date;
  promptCredits?: PromptCreditsInfo;
  flowCredits?: FlowCreditsInfo;
  tokenUsage?: TokenUsageInfo;
  userInfo?: UserInfo;
  models: ModelQuotaInfo[];
}

interface RawModelConfig {
  label: string;
  modelOrAlias?: { model: string };
  quotaInfo?: {
    remainingFraction?: number;
    resetTime: string;
  };
}

interface ServerUserStatusResponse {
  userStatus?: {
    name?: string;
    email?: string;
    userTier?: {
      id?: string;
      name?: string;
      description?: string;
      upgradeSubscriptionUri?: string;
      upgradeSubscriptionText?: string;
      availableCredits?: UserCredit[];
    };
    planStatus?: {
      planInfo: {
        monthlyPromptCredits: number;
        monthlyFlowCredits?: number;
        planName?: string;
        teamsTier?: string;
        browserEnabled?: boolean;
        knowledgeBaseEnabled?: boolean;
        canBuyMoreCredits?: boolean;
      };
      availablePromptCredits: number;
      availableFlowCredits?: number;
    };
    cascadeModelConfigData?: {
      clientModelConfigs: RawModelConfig[];
    };
  };
}

export class QuotaService {
  private port: number | null = null;
  private csrfToken: string | null = null;
  private strategyManager: QuotaStrategyManager;

  constructor() {
    this.strategyManager = new QuotaStrategyManager();
  }

  public getStrategyManager(): QuotaStrategyManager {
    return this.strategyManager;
  }

  setServerInfo(port: number, csrfToken: string): void {
    this.port = port;
    this.csrfToken = csrfToken;
  }

  async fetchQuota(): Promise<QuotaSnapshot | null> {
    if (!this.port || !this.csrfToken) {
      console.warn("[QuotaService] Cannot fetch quota: server info not set.");
      return null;
    }

    try {
      const response = await httpRequest<ServerUserStatusResponse>({
        hostname: "127.0.0.1",
        port: this.port,
        path: "/exa.language_server_pb.LanguageServerService/GetUserStatus",
        method: "POST",
        headers: {
          "Connect-Protocol-Version": "1",
          "X-Codeium-Csrf-Token": this.csrfToken,
        },
        body: JSON.stringify({
          metadata: {
            ideName: "antigravity",
            extensionName: "antigravity",
            locale: "en",
          },
        }),
        timeout: 10000,
        allowFallback: true,
      });

      if (response.statusCode !== 200 || !response.data || !response.data.userStatus) {
        console.error(`[QuotaService] Server responded with error status ${response.statusCode}`);
        return null;
      }

      return this.parseResponse(response.data);
    } catch (error) {
      console.error("[QuotaService] Exception while fetching quota:", error);
      return null;
    }
  }

  private parseResponse(data: ServerUserStatusResponse): QuotaSnapshot {
    const userStatus = data.userStatus!;
    const planInfo = userStatus.planStatus?.planInfo;
    const availableCredits = userStatus.planStatus?.availablePromptCredits;
    const availableFlowCredits = userStatus.planStatus?.availableFlowCredits;
    const userTier = userStatus.userTier;

    // 1. Parse Prompt Credits
    let promptCredits: PromptCreditsInfo | undefined;
    if (planInfo && availableCredits !== undefined) {
      const monthly = Number(planInfo.monthlyPromptCredits);
      const available = Number(availableCredits);
      if (monthly > 0) {
        promptCredits = {
          available,
          monthly,
          usedPercentage: ((monthly - available) / monthly) * 100,
          remainingPercentage: (available / monthly) * 100,
        };
      }
    }

    // 2. Parse Flow Credits
    let flowCredits: FlowCreditsInfo | undefined;
    if (planInfo?.monthlyFlowCredits && availableFlowCredits !== undefined) {
      const monthly = Number(planInfo.monthlyFlowCredits);
      const available = Number(availableFlowCredits);
      if (monthly > 0) {
        flowCredits = {
          available,
          monthly,
          usedPercentage: ((monthly - available) / monthly) * 100,
          remainingPercentage: (available / monthly) * 100,
        };
      }
    }

    // 3. Token usage
    let tokenUsage: TokenUsageInfo | undefined;
    const credits = userTier?.availableCredits || [];
    if (promptCredits || flowCredits || credits.length > 0) {
      const totalAvailable = promptCredits?.available ?? 0;
      const totalMonthly = promptCredits?.monthly ?? 0;
      tokenUsage = {
        promptCredits,
        flowCredits,
        totalAvailable,
        totalMonthly,
        overallRemainingPercentage: totalMonthly > 0 ? (totalAvailable / totalMonthly) * 100 : 0,
        userCredits: credits,
      };
    }

    // 4. User Info
    const userInfo: UserInfo | undefined = userStatus.name || userTier ? {
      name: userStatus.name,
      email: userStatus.email,
      tier: userTier?.name || planInfo?.teamsTier || "Pro Plan",
      tierId: userTier?.id,
      tierDescription: userTier?.description,
      planName: planInfo?.planName,
      teamsTier: planInfo?.teamsTier,
      upgradeUri: userTier?.upgradeSubscriptionUri,
      upgradeText: userTier?.upgradeSubscriptionText,
      browserEnabled: planInfo?.browserEnabled,
      knowledgeBaseEnabled: planInfo?.knowledgeBaseEnabled,
      canBuyMoreCredits: planInfo?.canBuyMoreCredits,
      monthlyPromptCredits: planInfo?.monthlyPromptCredits,
      availablePromptCredits: availableCredits,
    } : {
      tier: "Pro Plan"
    };

    // 5. Models
    const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
    const models: ModelQuotaInfo[] = rawModels
      .filter((m: RawModelConfig) => m.quotaInfo)
      .map((m: RawModelConfig) => {
        const now = new Date();
        let resetTime = new Date(m.quotaInfo!.resetTime);

        if (Number.isNaN(resetTime.getTime())) {
          resetTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h fallback
        }

        const diff = resetTime.getTime() - now.getTime();
        const remainingFraction = m.quotaInfo!.remainingFraction ?? 0;

        return {
          label: m.label,
          modelId: m.modelOrAlias?.model || "unknown",
          remainingPercentage: remainingFraction * 100,
          isExhausted: remainingFraction === 0,
          resetTime,
          timeUntilReset: this.formatTime(diff),
        };
      });

    return {
      timestamp: new Date(),
      promptCredits,
      flowCredits,
      tokenUsage,
      userInfo,
      models,
    };
  }

  private formatTime(ms: number): string {
    if (ms <= 0) {
      return "Ready";
    }
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) {
      return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      if (days >= 7) {
        const weeks = Math.floor(days / 7);
        const remDays = days % 7;
        if (remDays === 0 && remainingHours === 0) {
          return `${weeks}w`;
        }
        if (remDays === 0) {
          return `${weeks}w ${remainingHours}h`;
        }
        if (remainingHours === 0) {
          return `${weeks}w ${remDays}d`;
        }
        return `${weeks}w ${remDays}d ${remainingHours}h`;
      }
      return `${days}d ${remainingHours}h`;
    }
    return `${hours}h ${mins % 60}m`;
  }
}
