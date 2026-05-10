# Plan: Auto-Comment + Nothing Status

## Feature 1: Auto-comment from review output
- executor.ts: textBuffer accumulates onAgentText chunks
- After successful run: check for "## Code Review Report" marker
- createComment → updateComment(done) → broadcastCommentUpdated
- No commentRunner trigger

## Feature 2: "nothing" status column
- TaskStatus + "nothing" (done's right, numeral "06")
- executor.ts no-op path → status "nothing"
- Board: COLUMN_STATUSES/NUMERALS/TRANSITIONS/TONE updates
- Comment agentLog: conditional render when empty

## Files
- core/src/types/index.ts
- core/src/agents/executor.ts
- core/src/routes/tasks.ts
- gui/src/types/index.ts (or wherever TaskStatus lives)
- gui/src/components/Board/Board.tsx
- gui/src/components/Board/BoardColumn.tsx
- gui comment component (agentLog conditional)
