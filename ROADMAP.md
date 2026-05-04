# ROADMAP

## Completed

- ✅ **Project Claude Config + Agent Studio** — turns ClauFlow into a "Claude project control panel". Shipped in five phases:
  - ✅ Phase 1A — Claude Config tab + `CLAUDE.md` editor (split editor, live preview, save + push)
  - ✅ Phase 1B — Agents CRUD (`.claude/agents/*.md` editor, model picker, auto-bootstraps `.claude/settings.json`)
  - ✅ Phase 1C — Prereq onboarding (banner that checks `claude` / `git` / `gh` versions, copy-to-clipboard install commands)
  - ✅ Phase 1D — Skill Manager (Installed / Registry / Marketplaces backed by `claude plugin` CLI passthrough — real plugins discoverable by `claude /skills`)
  - ✅ Phase 1E — Agent Studio (node-graph canvas with @xyflow/react, drag-and-drop skill assignment, AI-generated agents from prompt, topology synced to `_graph.json` + Mermaid block in `CLAUDE.md`)
- ✅ Issue ID convention (displayId like `KPI-3`)
- ✅ Structured tool call streaming (stream-json + collapsible tool log)
- ✅ Token + cost observability
- ✅ Task deletion
- ✅ Frontend scale / density (#12)
- ✅ Full UI refresh — Fraunces typography, modern landing (live mini-kanban demo), simplification across every inner page
- ✅ Modern diff view (PR detail) — per-file collapsible block, sticky header, **Mark viewed** toggle + auto-scroll, sidebar tick mirror, lime/coral palette, hunk header humanized as `↳ line N + context`
- ✅ Theme picker on the landing page — sun/moon toggle in the `/` header, synced with the existing `html.light` + `localStorage` plumbing
- ✅ GitHub repos in the sidebar + click-to-clone — listing via `gh repo list`, local/remote split, two-column clone modal (left: form, right: scrollable repo info + GitHub link), WS progress, search filters the GitHub repo list too, the cloned repo becomes the active project automatically, partial-clone cleanup on failure

---

## Planned

- 🗓 **Studio skill injection** — Agent node'una sürüklenen skill'lerin SKILL.md içeriğini `buildNodePrompt` içinde otomatik olarak agent prompt'una enjekte et. Şu an `## Available Skills` tablosu sadece metin olarak prompt'a giriyor; `claude -p` headless modunda slash command çalışmadığından drag-drop'un execution'da hiçbir etkisi yok. Çözüm: agent body parse edilir, listelenen her skill için `~/.claude/skills/<skill>/SKILL.md` okunur, içerik prompt'a blok olarak eklenir. Kullanıcı davranışı aynı kalır, arka planda gerçek skill talimatları agent'a aktarılmış olur.

- 🗓 **Studio main node** — Canvas'ta her zaman bir `main` agent node olsun. Proje Studio'su ilk açıldığında `main.md` agent yoksa otomatik oluşturulsun; canvas'ta entry point olarak sol üste sabit konumlansın, görsel olarak diğer node'lardan ayrışsın (özel border/badge). Diğer agent'lar bu node'a edge ile bağlanır. Silinirse bir sonraki yüklemede yeniden oluşsun. Mevcut Studio bug'ları da bu fazda giderilecek.

- 🗓 **Streaming token events (mid-run budget enforcement)** — currently `onResult` fires once after the full claude CLI run, so a $0.01 budget can't stop a $0.42 run mid-flight. Real enforcement requires parsing streaming JSON events during the run to accumulate token counts, compare against effective budget, and call `controller.abort()` before the run finishes. This enables tight per-task spending caps without relying on post-run detection.

- 🗓 **Docker distribution** — `docker.yml` GitHub Actions workflow: build multi-arch image (amd64 + arm64) on every `v*.*.*` tag, push to GitHub Container Registry (`ghcr.io/furkaanasik/clauflow`). Compose file (`docker-compose.yml`) at repo root: core + gui services, port mapping, volume for SQLite data. Goal: `docker compose up` → running ClauFlow, no Node install needed.

- 🗓 **GitHub Issues → Task import** — Repo'daki açık issue'ları tek tıkla kanban'a çek. `gh issue list` çıktısını parse et, seçilen issue'ları task olarak oluştur. Hedef: ClauFlow'u mevcut iş akışına entegre et, paralel sistem olmasın.

- 🗓 **PR auto-review** — Task REVIEW kolonuna gelince Claude otomatik bir code review pass'i çalıştırsın, çıktısını PR'a comment olarak bıraksın. Şu an kullanıcı manuel review yapıyor; bu adımı executor pipeline'ına ekle.

- 🗓 **Task breakdown AI** — Task drawer'da "Break down" butonu: büyük bir feature açıklaması gir, Claude 5-8 alt task'a böler ve bunları aynı projeye ekler. Mevcut project planner proje seviyesinde çalışıyor; bu task seviyesinde.

- 🗓 **Notification system** — Agent iş bitince veya hata alınca bildirim: browser Notification API (izin istenirse) + opsiyonel webhook URL (Discord / Slack / custom). Şu an terminali izlemek gerekiyor.

- 🗓 **Claude model selector per-task** — Her task için hangi modelin çalışacağını seç (Haiku hızlı/ucuz, Sonnet dengeli, Opus derin iş). Şu an executor hardcoded model kullanıyor; task schema'ya `model` alanı ekle, executor'a ilet.

- 🗓 **Task dependencies** — "Bu task bitmeden şunu başlatma" bağlantısı. Task'lar arası `dependsOn` ilişkisi; bağımlı task'lar DOING'e taşınınca otomatik bekler, bağımlılık DONE olunca serbest kalır. Project planner ile de entegre olmalı: prompt'tan oluşturulan task'lar arası sıralama dependency olarak modellenmeli.

- 🗓 **Rollback button** — DONE kolonundaki bir task'ı tek tıkla geri al: `gh pr revert` veya `git revert` ile branch'i geri döndür, PR'ı kapat. Şu an manuel git işi.

- 🗓 **GitHub Issues two-way sync** — Task oluşturunca GitHub issue da açılsın (`gh issue create`), task DONE'a taşınınca issue kapansın. Mevcut `displayId` ve `prNumber` alanlarına `issueNumber` eklenir.

- 🗓 **Custom workflow columns** — TODO/DOING/REVIEW/DONE sabit seti genişletilsin. Önceden tanımlı ekstra kolonlar: `BLOCKED`, `QA`, `STAGING`. Kullanıcı serbest isim giremez; tipler sabit kalır, her tipin executor davranışı (agent çalıştır / manuel / deploy hook) ayrı tanımlanır.

---

## Working rule

Only **one** item should be active at a time. Finish it, use it, and if you like it move on. Do not start them all in parallel.
