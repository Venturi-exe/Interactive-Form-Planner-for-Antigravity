/**
 * Quota Strategy Manager for Orbit
 * Handles model classification, display names, and color palettes.
 */

export interface ModelDefinition {
  id: string;
  modelName: string;
  displayName: string;
}

export interface GroupDefinition {
  id: string;
  label: string;
  themeColor: string;
  prefixes?: string[];
  shortLabel: string;
  models: ModelDefinition[];
}

const STRATEGY_DATA: { groups: GroupDefinition[] } = {
  "groups": [
    {
      "id": "gemini-flash",
      "label": "Gemini Flash",
      "shortLabel": "Flash",
      "themeColor": "#40C4FF",
      "prefixes": [
        "gemini-3-flash",
        "flash"
      ],
      "models": [
        {
          "id": "gemini-3-flash",
          "modelName": "MODEL_PLACEHOLDER_M47",
          "displayName": "Gemini 3 Flash"
        }
      ]
    },
    {
      "id": "gemini-pro",
      "label": "Gemini Pro",
      "shortLabel": "Pro",
      "themeColor": "#3B82F6",
      "prefixes": [
        "gemini"
      ],
      "models": [
        {
          "id": "gemini-3-pro-high",
          "modelName": "MODEL_PLACEHOLDER_M37",
          "displayName": "Gemini 3.1 Pro (High)"
        },
        {
          "id": "gemini-3-pro-low",
          "modelName": "MODEL_PLACEHOLDER_M36",
          "displayName": "Gemini 3.1 Pro (Low)"
        }
      ]
    },
    {
      "id": "claude",
      "label": "Claude",
      "shortLabel": "Claude",
      "themeColor": "#FFAB40",
      "prefixes": [
        "claude"
      ],
      "models": [
        {
          "id": "claude-4-6-sonnet-thinking",
          "modelName": "MODEL_PLACEHOLDER_M35",
          "displayName": "Claude Sonnet 4.6 (Thinking)"
        },
        {
          "id": "claude-4-6-opus-thinking",
          "modelName": "MODEL_PLACEHOLDER_M26",
          "displayName": "Claude Opus 4.6 (Thinking)"
        }
      ]
    },
    {
      "id": "gpt",
      "label": "GPT",
      "shortLabel": "GPT",
      "themeColor": "#A855F7",
      "prefixes": [
        "gpt"
      ],
      "models": [
        {
          "id": "gpt-oss-120b-medium",
          "modelName": "MODEL_OPENAI_GPT_OSS_120B_MEDIUM",
          "displayName": "GPT-OSS 120B"
        }
      ]
    }
  ]
};

export class QuotaStrategyManager {
  private groups: GroupDefinition[];

  constructor() {
    this.groups = STRATEGY_DATA.groups;
  }

  getGroups(): GroupDefinition[] {
    return this.groups;
  }

  /**
   * Find the group that a model belongs to based on model ID
   */
  getGroupForModel(modelId: string, modelLabel?: string): GroupDefinition {
    // 0. Strong Match via Model Definition
    const def = this.getModelDefinition(modelId, modelLabel);
    if (def) {
      const group = this.groups.find(g => g.models.includes(def));
      if (group) return group;
    }

    // 1. Exact match in configured models list (Backup)
    for (const group of this.groups) {
      if (group.models.some(m => m.id === modelId)) {
        return group;
      }
    }

    // 2. Configuration Driven Prefix/Keyword Matching (longest prefix wins)
    const lowerId = modelId.toLowerCase();
    const lowerLabel = modelLabel?.toLowerCase() || '';

    type PrefixMatch = { group: GroupDefinition; prefixLen: number };
    const matches: PrefixMatch[] = [];

    for (const group of this.groups) {
      if (!group.prefixes) continue;
      for (const prefix of group.prefixes) {
        const p = prefix.toLowerCase();
        // The broad "gemini" prefix must not classify Gemini Flash (IDs and labels like "Gemini 3 Flash").
        if (group.id === 'gemini-pro' && p === 'gemini') {
          if (lowerId.includes('flash') || lowerLabel.includes('flash')) {
            continue;
          }
        }
        const inId = lowerId.includes(p);
        const inLabel = modelLabel !== undefined && lowerLabel.includes(p);
        if (inId || inLabel) {
          matches.push({ group, prefixLen: p.length });
        }
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => {
        if (b.prefixLen !== a.prefixLen) return b.prefixLen - a.prefixLen;
        return this.groups.indexOf(a.group) - this.groups.indexOf(b.group);
      });
      return matches[0].group;
    }

    // 3. Classify as "Other"
    const otherGroup = this.groups.find(g => g.id === 'other') || {
      id: "other",
      label: "Other Models",
      shortLabel: "Other",
      themeColor: "#E0E0E0",
      models: []
    };
    return otherGroup;
  }

  /**
   * Get model display name
   */
  getModelDisplayName(modelId: string, modelLabel?: string): string | undefined {
    const def = this.getModelDefinition(modelId, modelLabel);
    return def?.displayName;
  }

  /**
   * Get the full model definition config
   */
  getModelDefinition(modelId: string, modelLabel?: string): ModelDefinition | undefined {
    // 1. Exact Match
    for (const group of this.groups) {
      const model = group.models.find(m => m.id === modelId);
      if (model) return model;
    }

    // 2. Normalized Match
    const normalized = modelId.toLowerCase().replace(/^model_/, '').replace(/_/g, '-');
    for (const group of this.groups) {
      const model = group.models.find(m => m.id === normalized);
      if (model) return model;
    }

    // 3. Label Match (Fallback)
    if (modelLabel) {
      const model = this.findModelByLabel(modelLabel, modelId);
      if (model) return model;
    }

    return undefined;
  }

  /**
   * Enhanced find model that matches logic used in getModelDisplayName
   */
  private findModelByLabel(label: string, modelId?: string): ModelDefinition | undefined {
    const lowerLabel = label.toLowerCase();
    const lowerId = modelId?.toLowerCase() || '';

    for (const group of this.groups) {
      const model = group.models.find(m => {
        const mName = m.modelName.toLowerCase();
        if (mName === lowerLabel || lowerLabel.includes(mName)) return true;
        if (modelId && (lowerId === mName || lowerId.includes(mName))) return true;
        return false;
      });
      if (model) return model;
    }
    return undefined;
  }
}
