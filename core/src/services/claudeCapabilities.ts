export const ADVISOR_SUPPORTED = true;

export const MODEL_ALIASES = ["haiku", "sonnet", "opus", "fable"] as const;

const HAIKU_RANK = 0;
const FABLE_RANK = 3;

export function modelRank(model: string): number | null {
  const m = model.toLowerCase();
  for (let i = MODEL_ALIASES.length - 1; i >= 0; i--) {
    if (m.includes(MODEL_ALIASES[i]!)) return i;
  }
  if (m.includes("mythos")) return FABLE_RANK;
  return null;
}

export function isValidAdvisor(mainModel: string, advisorModel: string): boolean {
  const main = modelRank(mainModel);
  const adv = modelRank(advisorModel);
  if (main === null || adv === null) return false;
  if (adv === HAIKU_RANK) return false;
  return adv >= main;
}

interface ClaudeCapabilities {
  advisor: boolean;
  models: string[];
}

export function getClaudeCapabilities(): ClaudeCapabilities {
  return { advisor: ADVISOR_SUPPORTED, models: [...MODEL_ALIASES] };
}
