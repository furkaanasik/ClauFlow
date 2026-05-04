# CI Configuration Guide

## How CI Watching Works

After ClauFlow opens a pull request, the executor starts a **CI watcher** that polls GitHub's check status for that PR. The watcher runs in the background while the task sits in the **CI** column.

Poll sequence:
1. Wait `CI_POLL_INTERVAL_MS` (default 30 s)
2. Run `gh pr checks <pr-number> --json name,state`
3. If all checks pass → task moves to **Review**
4. If any check fails → enter the fix loop
5. After `CI_MAX_FIX_ITERATIONS` failed fix attempts → escalate (task stays in CI with `agent.status: error`)

## Fix Loop

Each fix iteration:
1. Fetch the failing check's log via `gh run view`
2. Feed the log back to the `claude` CLI with a targeted fix prompt
3. Commit + force-push to the same branch
4. Wait for the next CI cycle

The fix loop does **not** open a new PR — it pushes to the existing branch.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CI_POLL_INTERVAL_MS` | `30000` | Milliseconds between `gh pr checks` calls |
| `CI_MAX_FIX_ITERATIONS` | `3` | Max automatic fix attempts before giving up |

Set these in `core/.env` or in the process environment before starting the server:

```bash
CI_POLL_INTERVAL_MS=60000 CI_MAX_FIX_ITERATIONS=5 npm run dev
```

## Task State Transitions

```
PR opened
  │
  ▼
[ci column] ←──── fix attempt (up to CI_MAX_FIX_ITERATIONS)
  │                    │
  │ all checks pass    │ check still fails
  ▼                    │
[review column]    [ci column, agent.status: error]
```

## Manual Override

To bypass CI watching and move a task directly to Review, drag the card from **CI** to **Review** on the board. ClauFlow confirms the manual move before proceeding.

To reset a stuck CI task, drag it back to **Todo** — this resets `agent.status` to `idle` and clears the fix iteration counter.
