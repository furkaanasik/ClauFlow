# Plan: Streaming Token Budget Enforcement (Mid-Run)

## Summary
Claude CLI emits per-turn usage data in each `assistant` stream-json event, but ClauFlow currently only reads the final `result` event — too late to stop an overrunning task. This plan adds an `onUsage` callback to the stream parser so the executor and graph runner accumulate token costs per-turn and call `controller.abort()` the moment the budget is crossed.

## User Story
As a ClauFlow user with a $0.01 task budget, I want the executor to kill the Claude CLI process the moment it crosses my spending cap, so that I never pay for a full run when my budget was exhausted after the first tool call.

## Problem → Solution
`onResult` fires once after the full claude CLI exits → budget check is post-run, task has already overrun. `onUsage` fires per assistant turn mid-run → check accumulated cost after every turn, abort immediately if over budget.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (ROADMAP item)
- **PRD Phase**: N/A
- **Estimated Files**: 3

---

## UX Design

### Before
```
[Task running] budget=$0.01
Turn 1: $0.05 accumulated — still running
Turn 2: $0.31 accumulated — still running
Turn 3: $0.42 accumulated — run completes
[budget_exceeded WS event fires] ← too late
```

### After
```
[Task running] budget=$0.01
Turn 1: $0.05 accumulated
  → $0.05 >= $0.01 → controller.abort() immediately
  → budget_exceeded WS event fires mid-run
  → task returns to todo with error
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| budget_exceeded WS event | Fires post-run | Fires mid-run after first over-budget turn | Same event shape |
| Task abort | controller.abort() called post-run | controller.abort() called on first over-budget turn | No UI change needed |
| Real-time usage display | Updated post-run | Updated after every assistant turn | Task usage refreshes live |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `core/src/services/claudeService.ts` | 44-138 | `createStreamJsonParser` — where `onUsage` goes |
| P0 (critical) | `core/src/services/claudeService.ts` | 193-363 | `ClaudeRunOptions`, `runClaudeOnce` — wiring `onUsage` |
| P0 (critical) | `core/src/agents/executor.ts` | 361-394 | `onClaudeResult`, `runClaude` call — replace with `onUsage` |
| P1 (important) | `core/src/agents/graphRunner.ts` | 486-528 | `cumulativeUsage`, `onClaudeResult` in graph node loop |
| P1 (important) | `core/src/services/claudeService.ts` | 150-191 | `ClaudeUsage` type, `parseUsageFromResult` — reuse type |
| P2 (reference) | `core/src/services/pricingService.ts` | 60-84 | `calculateCostUsd` signature |
| P2 (reference) | `core/src/services/wsService.ts` | 219-225 | `broadcastBudgetExceeded` signature |

## External Documentation
N/A — feature uses established internal patterns only.

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: core/src/services/claudeService.ts:14-19
export interface StreamJsonParserHandlers {
  onText?: (text: string) => void;
  onToolCallStart?: (toolCall: ParsedToolCall) => void;
  onToolCallEnd?: (toolCall: ParsedToolCall) => void;
  onResult?: (raw: unknown) => void;
}
// New field follows exact same optional-callback pattern: onUsage?: (usage: ClaudeUsage) => void;
```

### STREAM_PARSER_HANDLER
```typescript
// SOURCE: core/src/services/claudeService.ts:60-83
if (e.type === "assistant") {
  const message = e.message as { content?: unknown } | undefined;
  const items = Array.isArray(message?.content) ? message!.content : [];
  for (const item of items as Array<Record<string, unknown>>) {
    // ... process content items
  }
  return;
}
// Add usage extraction inside this same block, before content items loop
```

### USAGE_EXTRACTION
```typescript
// SOURCE: core/src/services/claudeService.ts:166-191 (parseUsageFromResult)
const num = (k: string): number => {
  const v = u[k];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};
const usage: ClaudeUsage = {
  inputTokens: num("input_tokens"),
  outputTokens: num("output_tokens"),
  cacheReadTokens: num("cache_read_input_tokens"),
  cacheWriteTokens: num("cache_creation_input_tokens"),
};
// Use same extraction shape for per-turn usage from e.message.usage
```

### BUDGET_CHECK_PATTERN
```typescript
// SOURCE: core/src/agents/executor.ts:361-381
const effectiveBudget = getTaskEffectiveBudget(task.id);

const onClaudeResult = (raw: unknown): void => {
  const usage = parseUsageFromResult(raw);
  if (!usage) return;
  if (effectiveBudget != null) {
    const spentUsd = calculateCostUsd(usage, DEFAULT_MODEL);
    if (spentUsd >= effectiveBudget) {
      broadcastBudgetExceeded(task.id, spentUsd, effectiveBudget);
      controller.abort();
    }
  }
  updateTaskUsage(task.id, usage)
    .then((t) => { if (t) broadcastTaskUpdated(t); })
    .catch((e) => { console.error(`[executor] updateTaskUsage failed:`, e); });
};
// New onUsageTurn follows this exact shape — same guard, same abort, same DB write
```

### RUNCLAUDE_OPTIONS_WIRING
```typescript
// SOURCE: core/src/services/claudeService.ts:300-308
const streamParser = isStreamJson
  ? createStreamJsonParser({
      onText: (text) => emitText(options, text, "stdout"),
      onToolCallStart: (tc) => options.onToolCallStart?.(tc),
      onToolCallEnd: (tc) => options.onToolCallEnd?.(tc),
      onResult: (raw) => options.onResult?.(raw),
    })
  : null;
// Add: onUsage: (usage) => options.onUsage?.(usage),
```

### GRAPHRUNNER_CUMULATIVE_PATTERN
```typescript
// SOURCE: core/src/agents/graphRunner.ts:486-513
let cumulativeUsage = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
};
const onClaudeResult = (raw: unknown): void => {
  const usage = parseUsageFromResult(raw);
  if (!usage) return;
  cumulativeUsage = usage;  // ← currently overwrites with final total
  // ... budget check + updateTaskUsage
};
// Replace with onUsageTurn that accumulates per turn
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/services/claudeService.ts` | UPDATE | Add `onUsage` to handler interface + parser + run options |
| `core/src/agents/executor.ts` | UPDATE | Wire `onUsage` for mid-run budget check in single-CLI path |
| `core/src/agents/graphRunner.ts` | UPDATE | Wire `onUsage` for mid-run budget check in graph node loop |

## NOT Building
- Frontend changes — `budget_exceeded` WS event and its UI handler already exist
- New WS event types — existing `budget_exceeded` is sufficient
- Per-tool-call budget tracking — per-turn (per-assistant-message) is granular enough
- commentRunner changes — comments don't have budgets

---

## Step-by-Step Tasks

### Task 1: Add `onUsage` to `StreamJsonParserHandlers` and `ClaudeRunOptions`

- **ACTION**: Extend the two interfaces in `claudeService.ts`
- **IMPLEMENT**:
  ```typescript
  // In StreamJsonParserHandlers (after onResult):
  onUsage?: (usage: ClaudeUsage) => void;

  // In ClaudeRunOptions (after onResult):
  onUsage?: (usage: ClaudeUsage) => void;
  ```
- **MIRROR**: `NAMING_CONVENTION` — optional callback, same style as `onText`/`onResult`
- **IMPORTS**: `ClaudeUsage` is already defined in the same file (line 150)
- **GOTCHA**: `ClaudeUsage` is defined AFTER `StreamJsonParserHandlers` in the file. Both are in the same file so no import needed, but keep declaration order — move `ClaudeUsage` above `StreamJsonParserHandlers` OR use a forward reference pattern. Easiest: just add to handlers after the `ClaudeUsage` definition. Actually, since TypeScript hoists interface declarations, this is fine as-is.
- **VALIDATE**: `npm run typecheck` in `core/` passes with zero errors

### Task 2: Extract per-turn usage in `createStreamJsonParser`

- **ACTION**: Inside the `if (e.type === "assistant")` branch, extract `e.message.usage` and fire `handlers.onUsage?.()`
- **IMPLEMENT**:
  ```typescript
  // Inside processLine, in the `if (e.type === "assistant")` block,
  // BEFORE the content items loop:
  const message = e.message as { content?: unknown; usage?: unknown } | undefined;
  const usageObj = message?.usage;
  if (usageObj && typeof usageObj === "object") {
    const u = usageObj as Record<string, unknown>;
    const num = (k: string): number => {
      const v = u[k];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    handlers.onUsage?.({
      inputTokens: num("input_tokens"),
      outputTokens: num("output_tokens"),
      cacheReadTokens: num("cache_read_input_tokens"),
      cacheWriteTokens: num("cache_creation_input_tokens"),
    });
  }
  ```
- **MIRROR**: `STREAM_PARSER_HANDLER` + `USAGE_EXTRACTION`
- **IMPORTS**: None new — `ClaudeUsage` is in same file
- **GOTCHA**: The existing code already casts `e.message` as `{ content?: unknown }`. Widen the cast to `{ content?: unknown; usage?: unknown }` so TypeScript doesn't complain. The actual runtime shape may or may not include usage (older CLI versions may not emit it) — the `if (usageObj && ...)` guard handles this safely.
- **VALIDATE**: `npm run typecheck` passes; log-level test: run a task and verify `updateTaskUsage` is called before the run finishes

### Task 3: Wire `onUsage` through `runClaudeOnce`

- **ACTION**: Pass `onUsage` from `options` to `createStreamJsonParser` in `runClaudeOnce`
- **IMPLEMENT**:
  ```typescript
  // In runClaudeOnce, update streamParser creation:
  const streamParser = isStreamJson
    ? createStreamJsonParser({
        onText: (text) => emitText(options, text, "stdout"),
        onToolCallStart: (tc) => options.onToolCallStart?.(tc),
        onToolCallEnd: (tc) => options.onToolCallEnd?.(tc),
        onResult: (raw) => options.onResult?.(raw),
        onUsage: (usage) => options.onUsage?.(usage),
      })
    : null;
  ```
- **MIRROR**: `RUNCLAUDE_OPTIONS_WIRING`
- **IMPORTS**: None
- **GOTCHA**: `onUsage` only fires when `isStreamJson` is true. The non-stream-json fallback path in executor retries without `outputFormat`, which means no `onUsage` there — that's acceptable since the fallback path already skips all streaming callbacks.
- **VALIDATE**: `npm run typecheck` passes

### Task 4: Mid-run budget enforcement in `executor.ts` (single-CLI path)

- **ACTION**: Add `onUsageTurn` closure and wire it as `onUsage` in the `runClaude` call. Keep existing `onClaudeResult`/`onResult` as a final-sync fallback.
- **IMPLEMENT**:
  ```typescript
  // Add BEFORE the runClaude call (after effectiveBudget is defined):
  let midRunUsage: ClaudeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  const onUsageTurn = (usage: ClaudeUsage): void => {
    midRunUsage = {
      inputTokens: midRunUsage.inputTokens + usage.inputTokens,
      outputTokens: midRunUsage.outputTokens + usage.outputTokens,
      cacheReadTokens: midRunUsage.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: midRunUsage.cacheWriteTokens + usage.cacheWriteTokens,
    };
    if (effectiveBudget != null) {
      const spentUsd = calculateCostUsd(midRunUsage, DEFAULT_MODEL);
      if (spentUsd >= effectiveBudget) {
        broadcastBudgetExceeded(task.id, spentUsd, effectiveBudget);
        controller.abort();
        return;
      }
    }
    updateTaskUsage(task.id, midRunUsage)
      .then((t) => { if (t) broadcastTaskUpdated(t); })
      .catch((e) => { console.error(`[executor] mid-run updateTaskUsage failed:`, e); });
  };

  // In runClaude call, add:
  onUsage: onUsageTurn,
  ```
- **MIRROR**: `BUDGET_CHECK_PATTERN`
- **IMPORTS**: `ClaudeUsage` — add to import from `../services/claudeService.js`:
  ```typescript
  import { parseUsageFromResult, runClaude, type ClaudeUsage } from "../services/claudeService.js";
  ```
- **GOTCHA**: Accumulate per turn — do NOT replace `midRunUsage` with each turn's value (that would only track the last turn). Use additive accumulation `midRunUsage.x += usage.x`. The final `result` event's usage is the authoritative total; `onClaudeResult` remains as-is for the final sync — it will overwrite the accumulated with the correct total. This is safe because abort has already happened by the time budget is exceeded.
- **GOTCHA**: Do NOT remove `onResult: onClaudeResult`. It serves as a final authoritative total write and handles the case where `onUsage` fires 0 times (e.g., non-stream-json fallback or older CLI with no per-turn usage).
- **VALIDATE**: Set a $0.001 budget on a task, run it, verify task aborts within the first turn rather than completing the full run

### Task 5: Mid-run budget enforcement in `graphRunner.ts` (per-node)

- **ACTION**: Replace per-node `cumulativeUsage = usage` (overwrite) with per-turn accumulation via `onUsage`. Keep `onResult` to finalize `cumulativeUsage` with the authoritative total.
- **IMPLEMENT**:
  ```typescript
  // Replace the existing cumulativeUsage + onClaudeResult block with:
  let cumulativeUsage: ClaudeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  const onUsageTurn = (usage: ClaudeUsage): void => {
    cumulativeUsage = {
      inputTokens: cumulativeUsage.inputTokens + usage.inputTokens,
      outputTokens: cumulativeUsage.outputTokens + usage.outputTokens,
      cacheReadTokens: cumulativeUsage.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: cumulativeUsage.cacheWriteTokens + usage.cacheWriteTokens,
    };
    if (effectiveBudget != null) {
      const spentUsd = calculateCostUsd(cumulativeUsage, agent.frontmatter.model ?? DEFAULT_MODEL);
      if (spentUsd >= effectiveBudget) {
        broadcastBudgetExceeded(task.id, spentUsd, effectiveBudget);
        controller.abort();
        return;
      }
    }
    updateTaskUsage(task.id, cumulativeUsage)
      .then((t) => { if (t) broadcastTaskUpdated(t); })
      .catch((e) => { console.error(`[graphRunner] mid-run updateTaskUsage failed:`, e); });
  };

  const onClaudeResult = (raw: unknown): void => {
    const usage = parseUsageFromResult(raw);
    if (!usage) return;
    cumulativeUsage = usage; // authoritative final total overwrites accumulated
    updateTaskUsage(task.id, usage)
      .then((t) => { if (t) broadcastTaskUpdated(t); })
      .catch((e) => { console.error(`[graphRunner] updateTaskUsage failed:`, e); });
  };

  // In runClaude call, add:
  onUsage: onUsageTurn,
  ```
- **MIRROR**: `GRAPHRUNNER_CUMULATIVE_PATTERN` + `BUDGET_CHECK_PATTERN`
- **IMPORTS**: `ClaudeUsage` — add to import from `../services/claudeService.js`:
  ```typescript
  import { parseUsageFromResult, runClaude, type ClaudeUsage } from "../services/claudeService.js";
  ```
- **GOTCHA**: `effectiveBudget` in graph runner is declared once before the node loop (line 493) and reused for every node — this is correct, budget is task-level not node-level. The `agent.frontmatter.model` lookup for the node model is already used for cost calculation; keep it.
- **GOTCHA**: `cumulativeUsage` in graph runner tracks **one node's** usage (it's re-initialized each loop iteration, inside the `for` block). Don't confuse it with task-level cumulative usage. The `updateTaskUsage` call accumulates across nodes in the DB — the service adds to existing totals.
- **VALIDATE**: `npm run typecheck` passes

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `onUsage` fires for assistant events | Mock stream with `type:"assistant"` + `message.usage` | `handlers.onUsage` called with parsed ClaudeUsage | No |
| `onUsage` skips when no usage field | Mock `type:"assistant"` without `message.usage` | `handlers.onUsage` not called | Yes |
| `onUsage` not fired for non-stream-json mode | `outputFormat` omitted | No `onUsage` calls | Yes |
| Accumulation is additive | 3 turns of usage | `midRunUsage` = sum of all 3 | No |
| Abort fires on first over-budget turn | budget=$0.01, turn1=$0.05 | `controller.abort()` called after turn 1 | No |

### Edge Cases Checklist
- [ ] Claude CLI version that doesn't emit per-turn usage → `onUsage` never fires, `onResult` fallback still works
- [ ] Budget of `null` (no limit set) → `onUsageTurn` runs but skips abort check
- [ ] Abort already triggered before `onUsageTurn` returns → harmless double-abort (AbortController is idempotent)
- [ ] `updateTaskUsage` throws mid-run → error logged, run continues (same fire-and-forget pattern as before)
- [ ] Graph node 2 of 3 triggers budget abort → `controller.abort()` propagates to `runGraph`, which checks `controller.signal.aborted` at the top of each loop iteration

---

## Validation Commands

### Static Analysis
```bash
cd core && npm run typecheck
```
EXPECT: Zero type errors

### Build
```bash
cd core && npm run build
```
EXPECT: Clean build

### Manual Validation
- [ ] Set task budget to $0.001 on any task, move it to DOING
- [ ] Observe task logs — should abort within the first turn (first `▸ Running claude CLI…` message, then abort)
- [ ] Verify `budget_exceeded` toast or WS event fires before the task run completes
- [ ] Set budget to $10, run a real task — verify it completes normally, usage updated live in task drawer
- [ ] Verify graph-mode task with a low budget also aborts mid-node (not after all nodes finish)

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] A task with budget=$0.001 aborts within the first assistant turn (not after the full run)
- [ ] Real-time token usage updates visible in the task drawer during a run (not just post-run)
- [ ] Graph-mode tasks with a low budget abort mid-node
- [ ] Tasks with no budget run to completion unchanged

## Completion Checklist
- [ ] Code follows discovered patterns (optional callbacks, fire-and-forget updateTaskUsage)
- [ ] Error handling matches codebase style (console.error + continue, no throws in callbacks)
- [ ] No hardcoded values
- [ ] `onResult` kept as final-sync fallback
- [ ] No unnecessary scope additions (no frontend changes, no new WS types)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude CLI doesn't emit `usage` in `assistant` events (older version) | Low | Medium | `onUsage` never fires; `onResult` fallback still catches post-run. No regression. |
| Per-turn usage summing double-counts tokens if CLI batches turns | Low | Medium | `onResult` overwrites with authoritative total at the end; cost overestimate only causes earlier (not later) abort — safe. |
| Rapid `updateTaskUsage` writes cause DB contention | Low | Low | Same fire-and-forget pattern already used; WAL mode handles concurrent writes. |

## Notes
- The `onResult` callback is intentionally kept in both executor and graphRunner — it acts as an authoritative final sync even after mid-run accumulation. This ensures the final task usage matches the Claude CLI's own accounting.
- Per-turn usage from `message.usage` is the usage for THAT specific API call turn, not the session total. Accumulation is correct: sum all turns = total session usage (verified against `result.usage` which should match).
- `commentRunner.ts` is not updated — comment tasks have no budget field.
