# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Team

Agent takımı mevcut ama **her iş için takım kurulmaz** — takım kurma/spawn/shutdown zincirinin token maliyeti küçük işlerde faydayı geçer. Koordinatör önce iş büyüklüğüne bakıp karar verir.

### Agent Rolleri

- **planner** → isteği analiz eder, task'lara böler, hangi agent ne yapacak belirler
- **frontend** → `gui/` altındaki tüm UI/Next.js değişiklikleri
- **executor** → git branch, claude CLI çalıştırma, commit/push/PR
- **reviewer** → kod inceleme, tip hataları, bug kontrolü

### Ne Zaman Takım, Ne Zaman Koordinatör?

**Koordinatör direkt çözer** (takım kurmadan):
- Soru, açıklama, araştırma (zaten istisna)
- Tek dosyada birkaç satırlık bug fix
- Dokümantasyon, config, memory güncellemeleri
- DB'ye tek seferlik veri işlemi
- Dosya taşıma/yeniden adlandırma, küçük string/stil düzeltmeleri
- Açıkça lokalize ve tek domainli değişiklikler

**Takım kurulur** (TeamCreate → planner → ilgili agent'lar → reviewer → TeamDelete):
- Birden fazla alana dokunan iş (frontend + backend, UI + DB, vb.)
- Yeni özellik / non-trivial refactor / mimari karar
- 4+ dosyada koordinasyon gerektiren değişiklikler
- Executor gerektiren git/PR otomasyonları (branch + claude CLI + PR akışı)
- Kullanıcı açıkça "takım kur", "planla", "reviewer'a göster" dediğinde

Emin değilsen küçük tarafa kay — takım kurmak pahalı, gereksizse yapma. Koordinatör değişikliği bitirdikten sonra **tek dosya/birkaç satır** ölçütünü aştığını fark ederse, o noktadan itibaren takıma devredebilir.

Agent team özelliği `.claude/settings.local.json` üzerinden aktif:
```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

### Takım Kurulumu (Takım kararı verildiğinde)

**TeamCreate** ile takımı ayağa kaldır:

```
TeamCreate({ team_name: "<feature-slug>", agent_type: "team-lead", description: "<kısa amaç>" })
```

Agent'ları spawn ederken `team_name` ve `name` parametrelerini mutlaka geç:

```
Agent({ subagent_type: "planner", name: "planner", team_name: "<feature-slug>", prompt: "..." })
```

SendMessage ile `to: "<name>"` üzerinden iletişim kur — **sadece takım üyesi agent'lara mesaj gidebilir; takımsız spawn edilen agent'a SendMessage ulaşmaz ve inbox'ta kaybolur.**

İş bitince: tüm agent'lara `{ type: "shutdown_request" }` gönder, sonra `TeamDelete` ile takımı kapat.

Idle agent'a yeni spawn etme — `SendMessage` ile devam et (takım ayaktaysa mesaj agent'ı uyandırır).

## Servisler

İki ayrı paket, ayrı ayrı çalıştırılır:

| Servis | Dizin | Port | Komut |
|--------|-------|------|-------|
| Backend (core) | `core/` | 3001 | `npm run dev` |
| Frontend (gui) | `gui/` | 3000 | `pnpm dev` |

```bash
# Backend
cd core && npm run dev

# Frontend
cd gui && pnpm dev

# Type check
cd core && npm run typecheck
cd gui && pnpm typecheck

# Lint (gui only)
cd gui && pnpm lint

# Build
cd core && npm run build
cd gui && pnpm build
```

## Mimari

```
kanban/
├── core/          # Express + WebSocket backend (Node.js / tsx)
│   ├── src/
│   │   ├── agents/
│   │   │   ├── executor.ts      # Git + claude CLI orchestrator
│   │   │   └── commentRunner.ts # Yorum → branch checkout → claude CLI → commit/push
│   │   ├── routes/              # REST: /api/tasks, /api/projects, /api/auth, /api/tasks/:id/comments, /github/prs*
│   │   ├── services/
│   │   │   ├── taskService.ts    # SQLite CRUD (better-sqlite3, WAL modu)
│   │   │   ├── commentService.ts # comments tablosu CRUD
│   │   │   ├── wsService.ts      # WebSocket broadcast helpers
│   │   │   ├── gitService.ts     # git/gh shell helpers
│   │   │   └── claudeService.ts  # claude CLI runner (spawn)
│   │   └── types/index.ts        # Paylaşılan tipler (Task, Project, WsMessage…)
│   ├── .claude/
│   │   ├── settings.json         # bypassPermissions — soru sormadan çalışır
│   │   └── agents/               # planner, frontend, backend, reviewer (vibe coding için)
│   ├── CLAUDE.md                 # core'a özgü agent team talimatları
│   └── data/tasks.db             # SQLite veritabanı (tasks + projects + comments tabloları)
└── gui/           # Next.js 15 + Tailwind CSS 4 + dnd-kit frontend
    └── src/
        ├── app/
        │   ├── page.tsx           # Landing page (/)
        │   ├── board/page.tsx     # Kanban board (/board)
        │   ├── github/page.tsx    # GitHub PR listesi (/github?projectId=xxx)
        │   ├── icon.tsx           # Favicon (Next.js OG image)
        │   └── layout.tsx         # Root layout, metadata, tema init
        ├── components/
        │   ├── Board/             # Board.tsx, BoardColumn.tsx — dnd-kit
        │   ├── Card/              # TaskCard, TaskDetailDrawer, AgentBadge, CommentsTab
        │   ├── Github/            # PRDetailDrawer (tam ekran modal, side-by-side diff)
        │   ├── Modals/            # AddTaskModal, NewProjectModal
        │   ├── Sidebar/           # ProjectSidebar (proje araması dahil)
        │   ├── Layout/            # Header (logo, TR/EN toggle, tema, WS status, GitHub)
        │   ├── Auth/              # GithubConnectModal
        │   └── ui/                # Badge, ConfirmDialog, Modal, Toast
        ├── hooks/
        │   ├── useAgentSocket.ts  # WS bağlantısı + event dispatch
        │   ├── useBoard.ts        # Board yükleme, optimistic update
        │   ├── useGithubAuth.ts   # GitHub bağlantı durumu
        │   ├── useKeyboardShortcuts.ts
        │   ├── useToast.ts
        │   └── useTranslation.ts  # TR/EN dil hook'u
        ├── lib/
        │   ├── api.ts             # fetch wrapper → NEXT_PUBLIC_API_BASE
        │   ├── githubConstants.ts
        │   └── i18n/
        │       ├── types.ts       # Translations interface
        │       ├── tr.ts          # Türkçe çeviriler
        │       └── en.ts          # İngilizce çeviriler
        ├── store/
        │   └── boardStore.ts      # Zustand global state (tasks, projects, lang, theme…)
        └── types/
            └── index.ts
```

## Temel Veri Akışı

1. Kullanıcı `todo → doing`'a sürükler
2. GUI `PATCH /api/tasks/:id` ile `status: "doing"` gönderir
3. Core route handler executor'ı fire-and-forget başlatır
4. Executor: checkout → branch → `claude CLI` → commit → push → `gh pr create`
5. Her adımda WebSocket ile `agent_log` / `agent_status` / `task_updated` broadcast edilir
6. GUI `useAgentSocket` hook'u olayları alır → Zustand store güncellenir
7. Remote yoksa task doğrudan `done`'a; remote varsa `review`'a geçer

## Yorum Akışı (Task Comments + AI)

1. Kullanıcı review'daki task'a yorum ekler
2. GUI `POST /api/tasks/:id/comments` çağırır (`{ body: "..." }`)
3. Backend yorumu `comments` tablosuna kaydeder, `commentRunner`'ı fire-and-forget başlatır
4. Runner: task'ın `branch`'ine checkout → `claude CLI` ile yorumu uygular → commit → push (PR açmaz)
5. Her adımda WebSocket ile `comment_updated` broadcast edilir
6. UI'da yorum yanında spinner → yeşil tik (done) / kırmızı hata (error)

## Önemli Detaylar

- Veri katmanı SQLite (`better-sqlite3`, WAL modu) — write queue yok, transaction güvenli
- Migration: eski `tasks.json` ilk açılışta otomatik import edilir, `tasks.json.migrated` olarak arşivlenir
- GitHub auth: `gh auth login` device flow kullanır (custom OAuth app gerekmez), `gh auth setup-git` her executor çalışmasında git credential'ı günceller
- Review → Done sürüklenince `gh pr merge --merge` tetiklenir (branch silinmez)
- PR `/github` sayfasından da merge edilebilir — merge sonrası aynı `prNumber`'a sahip task otomatik `done`'a taşınır
- Agent log GUI'de canlı akış olarak görünür (`TaskDetailDrawer`)
- Executor başarısız olursa task `todo`'ya döner, `agent.status: "error"` olur
- GUI ortam değişkenleri: `gui/.env.local` → `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_WS_URL`
- `core/` `npm`, `gui/` `pnpm` kullanır
- Agent tanımları: `.claude/agents/` — her agent hangi skill'i kullanacağını bilir
- **Claude CLI çağrısı**: `-p <prompt>` ilk argüman olmalı, diğer flagler (`--permission-mode` vb.) sonra gelir
- `window.confirm` kullanılmaz — `ConfirmDialog` bileşeni (`gui/src/components/ui/ConfirmDialog.tsx`)
- Tema: Tailwind v4'te light mode için `html.light { --color-zinc-* }` CSS variable override kullanılır (class adı override değil)
- Dil tercihi (TR/EN): `lang` Zustand state'inde, `localStorage` ile sync — `useTranslation()` hook'u ile erişilir
- `comments` tablosu: `id, taskId, body, status (pending/running/done/error), agentLog, createdAt`
- Comment WS eventi: `comment_updated` — `{ type, taskId, payload: Comment }`
- Routing: `/` landing page, `/board` kanban board, `/github` PR listesi
