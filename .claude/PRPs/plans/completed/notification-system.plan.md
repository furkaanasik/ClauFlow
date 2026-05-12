# Plan: Notification System

## Summary
Fire a browser Notification and/or POST to a webhook URL when an agent finishes (`done`) or errors (`error`). Permission is requested lazily on first agent completion. Settings (browser toggle + webhook URL) live in localStorage and are configurable via a bell icon popover in the Header.

## User Story
As a developer, I want to be notified when an agent finishes or errors, so I don't have to watch the board.

## Problem → Solution
Currently requires watching the terminal or the board tab.  
→ Browser Notification fires automatically; optional Discord/Slack/custom webhook POST.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 5

---

## UX Design

### Before
```
┌─────────────────────────────────────────────────┐
│ Header: [ClauFlow] Board / Project  [Live] [PRs] │
│                                                  │
│  User must keep board tab open to see completion │
└─────────────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────────────┐
│ Header: [ClauFlow] Board / Project  [Live] 🔔 ..│
│                                          ↓       │
│        ┌──────────────────────────┐             │
│        │ Notifications            │             │
│        │ ○ Browser notifications  │             │
│        │   [Enable]               │             │
│        │ Webhook URL              │             │
│        │ [https://hooks.slack...] │             │
│        │ [Save]                   │             │
│        └──────────────────────────┘             │
│                                                  │
│  On agent done → browser Notification fires      │
│  On agent error → browser Notification fires     │
│  If webhook set → POST {taskId, title, status}   │
└─────────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Header right zone | WS status, PRs, Insights, Lang, Theme, GitHub | + Bell icon | Bell opens popover |
| Agent done event | Toast only | Toast + browser notification + webhook | Triggered in `useAgentSocket` |
| Agent error event | Toast only | Toast + browser notification + webhook | Same trigger point |
| First notification | — | Permission prompt (browser) | Asked lazily, not on page load |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `gui/src/hooks/useAgentSocket.ts` | 72-115 | Where to intercept `task_updated` events |
| P0 | `gui/src/hooks/useToast.ts` | all | Pattern for Zustand-backed singleton store |
| P0 | `gui/src/components/Layout/Header.tsx` | 94-177 | Right action zone where bell icon goes |
| P1 | `gui/src/components/ui/Toast.tsx` | all | UI component pattern (styling, Tailwind vars) |
| P1 | `gui/src/app/board/page.tsx` | all | Where `ToastContainer` is mounted (no change needed) |
| P2 | `gui/src/types/index.ts` | 1-20 | `AgentStatus` type |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| Web Notifications API | MDN | `Notification.requestPermission()` → `"granted"\|"denied"\|"default"`; `new Notification(title, {body, icon})` |
| Notification.permission | MDN | Read `Notification.permission` to check current state without prompting |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: gui/src/hooks/useToast.ts:19
export const useToastStore = create<ToastState>((set) => ({
  // ...
}));

export function useToast() {
  const push = useToastStore((s) => s.push);
  return { /* ... */ };
}
```
New hook: `useNotificationStore` + `useNotification()` following same shape.

### LOCALSTORAGE_PATTERN
```typescript
// SOURCE: gui/src/components/Layout/Header.tsx:36
localStorage.setItem("theme", nowLight ? "light" : "dark");

// SOURCE: gui/src/app/layout.tsx:46
var t = localStorage.getItem('theme');
```
Use `localStorage.getItem("notif-browser-enabled")` and `localStorage.getItem("notif-webhook-url")`.

### ZUSTAND_STORE_PATTERN
```typescript
// SOURCE: gui/src/hooks/useToast.ts:19-30
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (type, message) => { ... },
  dismiss: (id) => set(...),
}));
```

### AGENT_STATUS_INTERCEPT
```typescript
// SOURCE: gui/src/hooks/useAgentSocket.ts:76-82
case "task_updated": {
  const t = (msg as Extract<WsMessage, { type: "task_updated" }>).payload;
  upsertTask(t);
  if (t.agent.status === "idle" && t.status === "doing") {
    useBoardStore.getState().clearBudgetExceeded(t.id);
  }
  break;
}
```
Add notification trigger after `upsertTask(t)` when `t.agent.status === "done" || t.agent.status === "error"`.

### UI_COMPONENT_STYLE
```tsx
// SOURCE: gui/src/components/ui/Toast.tsx:24
<div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2">
  <div className="animate-fade-up flex min-w-[260px] items-stretch border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl">
```
Use same CSS variable palette: `var(--border)`, `var(--bg-elevated)`, `var(--text-primary)`, `var(--text-muted)`, `var(--text-faint)`, `var(--accent-primary)`, `var(--status-error)`.

### HEADER_BUTTON_PATTERN
```tsx
// SOURCE: gui/src/components/Layout/Header.tsx:143-150
<button
  type="button"
  onClick={toggleTheme}
  className="flex h-9 w-9 items-center justify-center text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
  title="..."
>
  {icon}
</button>
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `gui/src/hooks/useNotification.ts` | CREATE | Notification store + logic (permission, browser notify, webhook POST) |
| `gui/src/components/Layout/NotificationPopover.tsx` | CREATE | Bell icon + settings popover |
| `gui/src/components/Layout/Header.tsx` | UPDATE | Import and render `<NotificationPopover />` in right action zone |
| `gui/src/hooks/useAgentSocket.ts` | UPDATE | Call notification hook on `task_updated` done/error events |

## NOT Building
- Per-task notification preferences
- Notification history / inbox UI
- Server-side webhook delivery (client fires the POST)
- Email / SMS notifications
- Push notifications (service worker / PWA)
- Notification badge count
- Sound alerts

---

## Step-by-Step Tasks

### Task 1: Create `useNotification` store and logic
- **ACTION**: Create `gui/src/hooks/useNotification.ts`
- **IMPLEMENT**:
  ```typescript
  "use client";

  import { create } from "zustand";

  interface NotificationState {
    browserEnabled: boolean;
    webhookUrl: string;
    setBrowserEnabled: (v: boolean) => void;
    setWebhookUrl: (url: string) => void;
    requestPermission: () => Promise<void>;
    notify: (title: string, body: string, isError: boolean) => void;
  }

  export const useNotificationStore = create<NotificationState>((set, get) => ({
    browserEnabled: typeof window !== "undefined"
      ? localStorage.getItem("notif-browser-enabled") === "true"
      : false,
    webhookUrl: typeof window !== "undefined"
      ? (localStorage.getItem("notif-webhook-url") ?? "")
      : "",

    setBrowserEnabled: (v) => {
      localStorage.setItem("notif-browser-enabled", String(v));
      set({ browserEnabled: v });
    },

    setWebhookUrl: (url) => {
      localStorage.setItem("notif-webhook-url", url);
      set({ webhookUrl: url });
    },

    requestPermission: async () => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        get().setBrowserEnabled(true);
        return;
      }
      const result = await Notification.requestPermission();
      if (result === "granted") get().setBrowserEnabled(true);
    },

    notify: (title, body, isError) => {
      const { browserEnabled, webhookUrl } = get();

      if (browserEnabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body });
      }

      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, isError, ts: Date.now() }),
        }).catch(() => {});
      }
    },
  }));

  export function useNotification() {
    return {
      notify: useNotificationStore((s) => s.notify),
      requestPermission: useNotificationStore((s) => s.requestPermission),
    };
  }
  ```
- **MIRROR**: `ZUSTAND_STORE_PATTERN`, `LOCALSTORAGE_PATTERN`
- **IMPORTS**: `create` from `zustand`
- **GOTCHA**: `typeof window !== "undefined"` guard required — Next.js SSR will crash without it. Same for `typeof Notification === "undefined"`.
- **VALIDATE**: `pnpm typecheck` in `gui/`; no TS errors.

### Task 2: Create `NotificationPopover` component
- **ACTION**: Create `gui/src/components/Layout/NotificationPopover.tsx`
- **IMPLEMENT**: Bell icon button that toggles a popover. Popover has:
  - "Browser notifications" toggle row — shows current `Notification.permission` state, [Enable] button that calls `requestPermission()` when permission is `"default"`, "Enabled" badge when `browserEnabled && permission === "granted"`, "Blocked by browser" text when `"denied"`
  - "Webhook URL" label + text input (placeholder `https://hooks.slack.com/...`) + [Save] button that calls `setWebhookUrl()`
  - Close on outside click (use `useEffect` + `mousedown` listener)
- **MIRROR**: `HEADER_BUTTON_PATTERN`, `UI_COMPONENT_STYLE`
- **IMPORTS**: `useState`, `useEffect`, `useRef` from React; `useNotificationStore` from `@/hooks/useNotification`
- **GOTCHA**: `Notification.permission` is not reactive — read it fresh in render (it's a getter on the Notification constructor, reads current browser state). Wrap access in `typeof Notification !== "undefined"` check for SSR safety.
- **VALIDATE**: Bell icon appears in header; popover opens/closes; input saves to localStorage on [Save].

### Task 3: Add bell to Header
- **ACTION**: Update `gui/src/components/Layout/Header.tsx`
- **IMPLEMENT**: Import `NotificationPopover` and render it in the right action zone, between the `wsConnected` indicator and the `PrereqIndicator`:
  ```tsx
  import { NotificationPopover } from "@/components/Layout/NotificationPopover";
  // ...
  {/* in right action zone, after wsConnected span */}
  <NotificationPopover />
  ```
- **MIRROR**: `HEADER_BUTTON_PATTERN`
- **IMPORTS**: `NotificationPopover` from `@/components/Layout/NotificationPopover`
- **GOTCHA**: Keep existing button order — insert after the WS status span, before `PrereqIndicator`.
- **VALIDATE**: Bell renders without layout shift; existing elements unchanged.

### Task 4: Trigger notifications from `useAgentSocket`
- **ACTION**: Update `gui/src/hooks/useAgentSocket.ts`
- **IMPLEMENT**: In the `task_updated` case, after `upsertTask(t)`, add:
  ```typescript
  if (t.agent.status === "done" || t.agent.status === "error") {
    const isError = t.agent.status === "error";
    useNotificationStore.getState().notify(
      isError ? `Error: ${t.title}` : `Done: ${t.title}`,
      isError
        ? (t.agent.error ?? "Agent encountered an error")
        : "Agent finished successfully",
      isError,
    );
  }
  ```
- **MIRROR**: `AGENT_STATUS_INTERCEPT`
- **IMPORTS**: `useNotificationStore` from `@/hooks/useNotification`
- **GOTCHA**: Use `useNotificationStore.getState()` (not the hook) — this is outside React rendering, same pattern as how `useToastStore.getState()` is called in the `budget_exceeded` case (`useAgentSocket.ts:208`).
- **VALIDATE**: Drag task to doing → on completion a browser notification fires (if permission granted); webhook POST is sent (visible in browser Network tab).

---

## Testing Strategy

### Manual Validation Steps
1. Open board in a different tab / minimize browser → drag task to doing → browser notification fires when done
2. Set a webhook URL (e.g. a [requestbin](https://requestbin.com) or local `nc -l 8999`) → agent completes → POST received with `{title, body, isError, ts}`
3. When `Notification.permission === "denied"` → popover shows "Blocked by browser" (no Enable button)
4. Reload page → `browserEnabled` and `webhookUrl` persist from localStorage
5. `webhookUrl` empty → no fetch call (no network error)

### Edge Cases Checklist
- [ ] SSR: `typeof window`, `typeof Notification` guards prevent server crash
- [ ] Permission denied: popover shows message, no permission prompt fired
- [ ] Webhook URL unreachable: fetch failure silently swallowed (`.catch(() => {})`)
- [ ] Agent transitions through `done` multiple times (e.g. re-run): each fires notification (expected)
- [ ] Browser notifications permission "default" → user dismisses prompt → `browserEnabled` stays false

---

## Validation Commands

### Static Analysis
```bash
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: No lint errors

### Build
```bash
cd gui && pnpm build
```
EXPECT: Build succeeds

### Manual Validation
- [ ] Bell icon renders in header between WS indicator and PrereqIndicator
- [ ] Popover opens on click, closes on outside click
- [ ] [Enable] button triggers browser permission prompt
- [ ] After permission granted, `browserEnabled` becomes true; notification fires on next agent done/error
- [ ] Webhook URL saved and persisted after page reload
- [ ] Browser notification fires with correct title ("Done: X" / "Error: X")
- [ ] Network tab shows POST to webhook URL with correct JSON body

---

## Acceptance Criteria
- [ ] Bell icon in Header opens notification settings popover
- [ ] Browser notification fires on agent `done` or `error`
- [ ] Permission requested lazily (not on page load)
- [ ] Webhook POST fired on agent `done` or `error` when URL is set
- [ ] Settings persist in localStorage across reloads
- [ ] Zero type errors, zero lint errors, build passes

## Completion Checklist
- [ ] Code follows discovered patterns (Zustand store, localStorage, CSS vars)
- [ ] SSR guards in place (`typeof window`, `typeof Notification`)
- [ ] Fetch failure silently ignored
- [ ] No hardcoded values (titles built from task data)
- [ ] No unnecessary scope additions (no notification history, no server-side delivery)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SSR crash on `Notification` access | High without guard | Build failure | `typeof Notification !== "undefined"` guards in all access points |
| Browser blocks notification permission | Medium | Feature partially unavailable | Show clear "Blocked by browser" state in popover |
| Webhook CORS rejection | Medium | Silent failure | Already swallowed in `.catch(()=>{})`, user must configure webhook to allow browser origin |
| Notification fires on every status change (not just terminal) | Low | Spam | Guard is `=== "done" || === "error"` — both are terminal AgentStatus values |

## Notes
- Webhook POST is client-side (browser fires it, not core). No DB changes, no backend changes.
- `AgentStatus` of `"done"` and `"error"` are the only two terminal states — see `core/src/types/index.ts:3-10`.
- `useNotificationStore.getState()` (imperative access) is the correct pattern outside React components — identical to how `useToastStore.getState()` is used at `useAgentSocket.ts:208`.
