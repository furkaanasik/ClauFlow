import type { TaskUsage } from "@/types";

/** Default per-task budget when neither the task nor the project sets one (core `DEFAULT_TASK_BUDGET_USD`). */
export const DEFAULT_TASK_BUDGET_USD = 2;

/**
 * Total token count across all categories.
 */
export function totalTokens(usage: TaskUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheWriteTokens +
    usage.cacheReadTokens
  );
}
