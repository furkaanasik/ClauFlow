# Plan: PR Auto-Review

## Summary
When a task reaches the REVIEW column, a new `prReviewRunner` agent automatically runs a Claude-powered code review on the PR diff and posts the result as a comment on the task. The user sees a "running" state in the Comments tab, then the full markdown review appears when complete.

## User Story
As a developer reviewing a task in the REVIEW column,
I want Claude to automatically post a code review comment when the PR lands in review,
So that I have an AI-generated first-pass review without manual effort.

## Problem → Solution
User must manually review every PR diff → Claude auto-posts a structured review comment as soon as the task enters REVIEW.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 5 (1 new, 4 updated)

---

## UX Design

### Before
```
Task moves to REVIEW column
↓
Comments tab is empty
↓
User must open PR, read diff, form opinion manually
```

### After
```
Task moves to REVIEW column
↓
Comments tab shows: "🔍 Auto-review in progress…" [running spinner]
↓
Claude runs gh pr diff + analyzes
↓
Comment updates to full markdown review: Summary / Issues / Suggestions / Verdict
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Comments tab on REVIEW entry | Empty | Shows running comment | Automatically, no user action |
| Review completion | — | Full markdown renders | CommentsTab already renders done+markdown via ReactMarkdown |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/agents/commentRunner.ts` | 1-254 | Pattern to mirror exactly — same comment lifecycle |
| P0 | `core/src/services/commentService.ts` | 1-107 | comment CRUD, need to add `body` to updateComment patch |
| P0 | `core/src/agents/executor.ts` | 628-648 | Where finalStatus is set — trigger point 1 |
| P0 | `core/src/services/ciWatcher.ts` | 100-107, 222-232 | moveToReview() — trigger point 2 |
| P1 | `core/src/services/claudeService.ts` | 1-50 | runClaude signature |
| P1 | `core/src/types/index.ts` | 30-50, 76-85 | Task and Comment types |
| P2 | `gui/src/components/Card/CommentsTab.tsx` | 65-116 | How comments render — body used as markdown when status=done |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: core/src/agents/commentRunner.ts:24-40
const RUNNING = new Map<string, Promise<void>>();

export function runComment(comment: Comment, projectRepoPath: string): Promise<void> {
  const previous = RUNNING.get(comment.taskId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => runCommentInner(comment, projectRepoPath));
  RUNNING.set(comment.taskId, next);
  next.finally(() => {
    if (RUNNING.get(comment.taskId) === next) RUNNING.delete(comment.taskId);
  });
  return next;
}
```

### COMMENT_LIFECYCLE
```typescript
// SOURCE: core/src/agents/commentRunner.ts:48-50, 237-252
// Mark running
const running = updateComment(comment.id, { status: "running" });
broadcastCommentUpdated(running);
// ... work ...
// Mark done
const done = updateComment(comment.id, { status: "done" });
broadcastCommentUpdated(done);
// On error
const errored = updateComment(comment.id, { status: "error" });
broadcastCommentUpdated(errored);
```

### COMMENT_LOG_PATTERN
```typescript
// SOURCE: core/src/agents/commentRunner.ts:90-98
const onLogLine = async (line: string, stream: "stdout" | "stderr"): Promise<void> => {
  const entry = stream === "stderr" ? `[stderr] ${line}` : line;
  appendCommentLog(comment.id, entry);
  const fresh = getComment(comment.id);
  if (fresh) broadcastCommentUpdated(fresh);
};
```

### ERROR_HANDLING
```typescript
// SOURCE: core/src/agents/commentRunner.ts:239-253
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[commentRunner] comment ${comment.id} failed:`, message);
  try { appendCommentLog(comment.id, `[error] ${message}`); } catch {}
  try {
    const errored = updateComment(comment.id, { status: "error" });
    broadcastCommentUpdated(errored);
  } catch {}
}
```

### FIRE_AND_FORGET
```typescript
// SOURCE: core/src/agents/executor.ts:99-101
export function enqueue(task: Task, project: Project, options: EnqueueOptions = {}): void {
  run(task, project, options).catch(() => {}); // errors handled inside run()
}
```

### COMMENT_CREATE_PATTERN
```typescript
// SOURCE: core/src/agents/executor.ts:506-513
const comment = createComment(task.id, textBuffer);
const done = updateComment(comment.id, { status: "done" });
broadcastCommentUpdated(done);
```

### RUN_CLAUDE_MINIMAL
```typescript
// SOURCE: core/src/services/ciWatcher.ts:170-179
const claudeResult = await runClaude({
  prompt,
  cwd: project.repoPath,
  allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  onLine: async (line, stream) => {
    const entry = stream === "stderr" ? `[stderr] ${line}` : line;
    await appendAgentLog(taskId, entry);
    broadcastLog(taskId, line);
  },
});
```

### COMMENT_SERVICE_UPDATE
```typescript
// SOURCE: core/src/services/commentService.ts:91-103
export function updateComment(
  id: string,
  patch: Partial<Pick<Comment, "status" | "agentLog">>,
): Comment {
  if (patch.status !== undefined) stmtUpdateCommentStatus.run(patch.status, id);
  if (patch.agentLog !== undefined) stmtUpdateCommentLog.run(JSON.stringify(patch.agentLog), id);
  const row = stmtGetComment.get(id) as CommentRow | undefined;
  if (!row) throw new Error(`Comment not found: ${id}`);
  return rowToComment(row);
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/agents/prReviewRunner.ts` | CREATE | New agent — mirrors commentRunner pattern |
| `core/src/services/commentService.ts` | UPDATE | Add `body` to updateComment patch + prepared stmt |
| `core/src/agents/executor.ts` | UPDATE | Call `enqueueReview` when finalStatus === "review" |
| `core/src/services/ciWatcher.ts` | UPDATE | Pass project to moveToReview; call enqueueReview |

## NOT Building
- GitHub PR comment posting via `gh pr review` (stays in-app comments only)
- Streaming review text to WS in real-time (full text appears on completion)
- Per-task toggle to disable auto-review
- Auto-review on manual column moves (only on agent-driven REVIEW entry)

---

## Step-by-Step Tasks

### Task 1: Extend `updateComment` to accept body patch

- **ACTION**: Add `body` to the Partial<Pick<>> in `updateComment`, add a new prepared statement `stmtUpdateCommentBody`, run it when `patch.body !== undefined`
- **IMPLEMENT**:
  ```typescript
  // Add after stmtAppendCommentLog (line ~54):
  const stmtUpdateCommentBody = db.prepare(
    `UPDATE comments SET body = ? WHERE id = ?`,
  );

  // Change updateComment signature:
  export function updateComment(
    id: string,
    patch: Partial<Pick<Comment, "status" | "agentLog" | "body">>,
  ): Comment {
    if (patch.status !== undefined) stmtUpdateCommentStatus.run(patch.status, id);
    if (patch.agentLog !== undefined) stmtUpdateCommentLog.run(JSON.stringify(patch.agentLog), id);
    if (patch.body !== undefined) stmtUpdateCommentBody.run(patch.body, id);
    // ... rest unchanged
  }
  ```
- **MIRROR**: COMMENT_SERVICE_UPDATE pattern
- **IMPORTS**: None new
- **GOTCHA**: `body` column already exists in the `comments` table — no migration needed
- **VALIDATE**: TypeScript: `pnpm typecheck` in core/ passes. Call `updateComment(id, { body: "x" })` — row body updates.

### Task 2: Create `prReviewRunner.ts`

- **ACTION**: Create `core/src/agents/prReviewRunner.ts` — fire-and-forget runner that creates a running comment, invokes Claude with `gh pr diff` via Bash, then sets body+done on the comment
- **IMPLEMENT**:
  ```typescript
  import { runClaude } from "../services/claudeService.js";
  import { createComment, updateComment, appendCommentLog, getComment } from "../services/commentService.js";
  import { broadcastCommentUpdated } from "../services/wsService.js";
  import type { Project, Task } from "../types/index.js";

  const RUNNING = new Map<string, Promise<void>>();

  export function enqueue(task: Task, project: Project): void {
    if (!task.prNumber) return;
    const previous = RUNNING.get(task.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => runInner(task, project));
    RUNNING.set(task.id, next);
    next.finally(() => {
      if (RUNNING.get(task.id) === next) RUNNING.delete(task.id);
    });
  }

  async function runInner(task: Task, project: Project): Promise<void> {
    const comment = createComment(task.id, "🔍 Auto-review in progress…");
    try {
      const running = updateComment(comment.id, { status: "running" });
      broadcastCommentUpdated(running);

      const prompt =
        `You are performing an automated code review for PR #${task.prNumber}.\n\n` +
        `Task: ${task.title}\n` +
        (task.description ? `Description: ${task.description}\n\n` : "\n") +
        `Run \`gh pr diff ${task.prNumber}\` to fetch the diff, then write a concise review.\n\n` +
        `Format your response as:\n` +
        `## Code Review\n\n` +
        `### Summary\n[what changed]\n\n` +
        `### Issues Found\n[bugs, security, correctness — with file:line refs; "None" if clean]\n\n` +
        `### Suggestions\n[style, perf, clarity improvements; "None" if clean]\n\n` +
        `### Verdict\n**LGTM** | **Needs Changes** | **Critical Issues**\n\n` +
        `Keep it concise. Focus on correctness over nitpicks.`;

      let reviewText = "";
      const onLogLine = async (line: string, stream: "stdout" | "stderr"): Promise<void> => {
        const entry = stream === "stderr" ? `[stderr] ${line}` : line;
        appendCommentLog(comment.id, entry);
        const fresh = getComment(comment.id);
        if (fresh) broadcastCommentUpdated(fresh);
      };

      const claudeResult = await runClaude({
        prompt,
        cwd: project.repoPath,
        allowedTools: ["Bash"],
        onLine: onLogLine,
        onText: (text) => { reviewText += text; },
      });

      if (claudeResult.code !== 0 || !reviewText.trim()) {
        throw new Error(
          claudeResult.code !== 0
            ? `claude CLI exited ${claudeResult.code}: ${claudeResult.stderr.slice(0, 300)}`
            : "claude produced no review text",
        );
      }

      const done = updateComment(comment.id, { body: reviewText, status: "done" });
      broadcastCommentUpdated(done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[prReviewRunner] task ${task.id} failed:`, message);
      try { appendCommentLog(comment.id, `[error] ${message}`); } catch {}
      try {
        const errored = updateComment(comment.id, { status: "error" });
        broadcastCommentUpdated(errored);
      } catch {}
    }
  }
  ```
- **MIRROR**: NAMING_CONVENTION, COMMENT_LIFECYCLE, COMMENT_LOG_PATTERN, ERROR_HANDLING, FIRE_AND_FORGET
- **IMPORTS**: claudeService, commentService, wsService, types/index
- **GOTCHA**: `runClaude` `onText` callback collects the full markdown response. Only `Bash` tool is allowed — Claude calls `gh pr diff <number>` itself. Do NOT pass `outputFormat: "stream-json"` unless you add the full fallback logic from commentRunner — keep it simple.
- **VALIDATE**: TypeScript passes. File compiles with `cd core && npm run typecheck`.

### Task 3: Trigger from `executor.ts` when finalStatus === "review"

- **ACTION**: After task is updated to `finalStatus` in executor's final block, if `finalStatus === "review"` call `enqueueReview(final, project)`
- **IMPLEMENT**:
  ```typescript
  // At top of file, add import:
  import { enqueue as enqueueReview } from "./prReviewRunner.js";

  // After broadcastTaskUpdated(final) at ~line 643, add:
  if (finalStatus === "review") {
    enqueueReview(final, project);
  }
  ```
  The final block looks like:
  ```typescript
  const finalStatus = hasRemote && prNumber ? "ci" : hasRemote ? "review" : "done";
  const final = await updateTask(task.id, { ... });
  broadcastStatus(task.id, "done", "completed");
  broadcastTaskUpdated(final);

  if (finalStatus === "ci") {
    startCiWatch(final, project);
  }
  // ADD HERE:
  if (finalStatus === "review") {
    enqueueReview(final, project);
  }
  ```
- **MIRROR**: FIRE_AND_FORGET pattern
- **IMPORTS**: `import { enqueue as enqueueReview } from "./prReviewRunner.js";`
- **GOTCHA**: `final` has the updated `prNumber` from the task record. The `project` variable is in scope. Only call when `finalStatus === "review"` (no CI) — CI path is handled in Task 4.
- **VALIDATE**: Move a task to DOING with a remote repo → PR opens → task moves to REVIEW → auto-review comment appears.

### Task 4: Trigger from `ciWatcher.ts` when CI passes → review

- **ACTION**: Update `moveToReview` to accept `project: Project | null` and call `enqueueReview` after broadcasting. Pass `project` from all call sites.
- **IMPLEMENT**:
  ```typescript
  // Add import at top of ciWatcher.ts:
  import { enqueue as enqueueReview } from "../agents/prReviewRunner.js";
  // Also import Project type if not already:
  import type { CiFailure, Project, Task } from "../types/index.js";

  // Change moveToReview signature:
  async function moveToReview(taskId: string, project: Project): Promise<void> {
    const updated = await updateTask(taskId, {
      status: "review",
      agent: {
        status: "done",
        currentStep: "ci_complete",
        finishedAt: new Date().toISOString(),
      },
    });
    broadcastTaskUpdated(updated);
    enqueueReview(updated, project);
  }

  // Update call sites in poll():
  // Line ~106: await moveToReview(taskId);  →  await moveToReview(taskId, project);
  // Line ~124: await moveToReview(taskId);  →  await moveToReview(taskId, project);
  ```
  Both calls to `moveToReview` are inside `poll(taskId, prNumber, project, state)` which already has `project`.
- **MIRROR**: FIRE_AND_FORGET pattern
- **IMPORTS**: `import { enqueue as enqueueReview } from "../agents/prReviewRunner.js";`
- **GOTCHA**: `updated` task returned from `updateTask` has all fields including `prNumber`. `project` is already a parameter in `poll()`. Check both `moveToReview` call sites (line ~106 pass and exhausted path ~124).
- **VALIDATE**: TypeScript passes. With CI configured: task moves through ci → review → auto-review comment appears.

---

## Testing Strategy

### Manual Validation Flow
1. Have a project with a GitHub remote
2. Create a task, drag to DOING
3. Wait for executor: branch → claude → commit → push → PR opened → task moves to REVIEW (or CI → REVIEW)
4. Open task drawer → Comments tab
5. See "🔍 Auto-review in progress…" comment with `running` status
6. Wait for Claude to finish
7. Comment body updates to full `## Code Review` markdown, status = done

### Edge Cases Checklist
- [ ] Task without `prNumber` — `enqueue` returns early, no comment created
- [ ] Claude fails / non-zero exit — comment → `error` status, error appended to agentLog
- [ ] Claude produces no text — treated as error
- [ ] `gh pr diff` fails (e.g. no remote access) — Claude stderr captured in agentLog
- [ ] CI path: exhausted iterations → review → auto-review still fires
- [ ] Multiple rapid retries — `RUNNING` map serializes via promise chaining (same pattern as commentRunner)

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
EXPECT: Successful build

### Manual Validation
- [ ] Create task with GitHub remote project
- [ ] Drag to DOING — executor runs, PR opens
- [ ] Task moves to REVIEW — Comments tab shows running comment
- [ ] After ~30–60s — comment body shows `## Code Review` markdown
- [ ] Status indicator shows "Applied" (done)
- [ ] Repeat test with CI-enabled repo (ci → review path)

---

## Acceptance Criteria
- [ ] Auto-review comment created immediately when task enters REVIEW
- [ ] Comment shows "running" status while Claude works
- [ ] Comment body becomes full markdown review when done
- [ ] Comment shows "error" status if Claude fails
- [ ] Works for both paths: direct review (no CI) and CI-pass → review
- [ ] No review fired when task has no prNumber (local-only projects)
- [ ] TypeScript passes, no regressions

## Completion Checklist
- [ ] Code follows commentRunner pattern exactly
- [ ] Error handling mirrors commentRunner's try/catch structure
- [ ] No hardcoded values (prompt uses task.title, task.prNumber)
- [ ] `body` column update in commentService is additive (no migration needed)
- [ ] RUNNING map prevents concurrent runs for same task
- [ ] No WS streaming of individual log lines to keep it simple

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `gh pr diff` returns huge diff (>100k tokens) | Medium | Claude context overflow | Claude is prompted to be concise; large diffs truncated by Claude's context window naturally |
| Claude CLI not in PATH in ci runner | Low | Error comment | Same risk as all other Claude invocations — pre-existing constraint |
| `onText` not called (stream-json mode off) | Low | Empty review | Don't use stream-json — use plain mode. `onText` works in plain mode via stdout line accumulation. Actually need to verify: in plain mode, `onText` is NOT called. Use `onLine` accumulation instead. |

## Notes

**CRITICAL GOTCHA on `onText` vs plain mode**: `onText` is only called in `stream-json` mode (via `createStreamJsonParser`). In plain mode (no `outputFormat`), only `onLine` is called. 

The `prReviewRunner` should NOT use `outputFormat: "stream-json"` to keep things simple (avoids the fallback complexity in commentRunner). Instead, accumulate review text via `onLine`:

```typescript
let reviewLines: string[] = [];
const onLogLine = async (line: string, stream: "stdout" | "stderr"): Promise<void> => {
  if (stream === "stdout") reviewLines.push(line);
  const entry = stream === "stderr" ? `[stderr] ${line}` : line;
  appendCommentLog(comment.id, entry);
  const fresh = getComment(comment.id);
  if (fresh) broadcastCommentUpdated(fresh);
};
// ... after runClaude:
const reviewText = reviewLines.join("\n").trim();
```

This is safe, simple, and consistent with how ciWatcher collects output.

> Next step: Run `/prp-implement .claude/PRPs/plans/pr-auto-review.plan.md` to execute this plan.
