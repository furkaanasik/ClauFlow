# ClauFlow — Ürün Geliştirme Planı

> Oluşturulma: 2026-05-12
> Kaynak: product-analysis.md + ROADMAP.md mevcut planned items
> Kural: bir seferde bir item. Bitti → test → sonraki.

---

## Faz 1 — Acil Güvenlik & Maliyet Kontrolü
> Hedef: para sızıntısını kapat, runaway agent'ı durdur.
> Tahmini süre: 1-2 gün

### 1.1 `commentRunner` budget cap
- `commentRunner.ts` — executor'daki `onUsage` + mid-run abort pattern'ini kopyala
- Task'ın `budget_tokens` / `budget_usd` field'ını oku, comment başına $0.50 default cap
- Aşılınca `controller.abort()` + comment status `error` + log satırı
- **Dosyalar:** `core/src/agents/commentRunner.ts`

### 1.2 `prReviewRunner` stream-json + budget cap
- Output format `text` → `stream-json` geçir
- `onUsage` callback ekle, $1.00 default cap
- Token/cost DB'ye kaydet (comment altında)
- **Dosyalar:** `core/src/agents/prReviewRunner.ts`

### 1.3 `--max-turns` limiti
- `claudeService.ts runClaudeOnce()` — args array'e `--max-turns` ekle
- `ClaudeRunOptions`'a `maxTurns?: number` alan ekle
- Executor default: 30, graph node: agent frontmatter'dan oku, comment runner: 15
- **Dosyalar:** `core/src/services/claudeService.ts`, `core/src/agents/executor.ts`, `core/src/agents/commentRunner.ts`, `core/src/agents/graphRunner.ts`

---

## Faz 2 — Per-Task Model Seçimi
> Hedef: maliyet ~2-3x azalt, kullanıcıya kontrol ver.
> Tahmini süre: 2-3 gün

### 2.1 Task schema + DB migration
- `model` alanı ekle: `"haiku" | "sonnet" | "opus" | null` (null = default)
- SQLite migration yaz
- **Dosyalar:** `core/src/services/taskService.ts`, `core/src/types/index.ts`

### 2.2 Executor + graphRunner model passthrough
- `CLAUFLOW_DEFAULT_MODEL` env var zaten var ama Claude CLI'ya geçilmiyor
- `runClaude`'a `--model <id>` flag ekle
- Cost calc'da da doğru model kullan (şu an DEFAULT_MODEL sabit)
- **Dosyalar:** `core/src/agents/executor.ts`, `core/src/agents/graphRunner.ts`, `core/src/services/claudeService.ts`

### 2.3 UI — AddTaskModal + TaskDetailDrawer model picker
- Haiku / Sonnet / Opus dropdown (ikonla maliyet göster: $/$$/$$$ )
- Seçilmezse proje default devreye girer
- **Dosyalar:** `gui/src/components/Modals/AddTaskModal.tsx`, task detail drawer

---

## Faz 3 — Mevcut Roadmap Items
> Hedef: söz verilen özellikler.
> Tahmini süre: 1-2 hafta

### 3.1 Task bağımlılıkları (`dependsOn`)
- Task schema'ya `dependsOn: string[]` ekle
- Executor `acquireSlot()` içinde bağımlı task'lar DONE değilse bekle
- UI'da task drawer'a "Depends on" bölümü + seçici
- Project planner ürettiği task sırasını `dependsOn` olarak modelle
- **Dosyalar:** `core/src/services/taskService.ts`, `core/src/agents/executor.ts`, `core/src/types/index.ts`, task drawer

### 3.2 Rollback butonu
- DONE kolonundaki task'a "Revert" butonu
- Backend: `gh pr revert <prNumber>` veya `git revert` + push
- Task status → `todo` + `agent.status: "idle"` reset
- **Dosyalar:** `core/src/routes/tasks.ts`, `core/src/services/gitService.ts`, task drawer

### 3.3 GitHub Issues two-way sync
- Task DONE → `gh issue close <issueNumber>` + yorum ekle
- `issueNumber` zaten schema'da mevcut mi kontrol et
- **Dosyalar:** `core/src/agents/executor.ts`, `core/src/services/gitService.ts`

### 3.4 Custom workflow columns
- Sabit tipler: `BLOCKED`, `QA`, `STAGING`
- Her tip için executor davranışı: `BLOCKED` → manual, `QA` → deploy hook, `STAGING` → deploy hook
- Column sırasını project bazında persist et
- **Dosyalar:** `core/src/types/index.ts`, `core/src/services/taskService.ts`, board UI

---

## Faz 4 — Token Optimizasyonu (Teknik Borç)
> Hedef: her Claude çağrısında israf azalt.
> Tahmini süre: 3-4 gün

### 4.1 `testingInstructions` koşullu
- Görev başlığı/açıklamasında "test|spec|coverage|tdd" varsa ekle, yoksa atla
- Veya task'a `requireTests: boolean` flag ekle
- **Dosyalar:** `core/src/agents/executor.ts`

### 4.2 Skill içeriği process-level cache
- `graphRunner.ts loadSkillContent()` — Map<skillId, {content, mtime}> cache
- Process start'ta boş, ilk okumada doldur, `fs.statSync` mtime değişince invalidate
- **Dosyalar:** `core/src/agents/graphRunner.ts`

### 4.3 `allowedTools` task türüne göre otomatik daralt
- Analysis-only task (no `Write`/`Edit` beklenen): `["Read", "Glob", "Grep", "Bash"]`
- Full implementation: tüm 6 tool
- Heuristik: task başlığında "review|analyze|check|report" varsa dar set
- **Dosyalar:** `core/src/agents/executor.ts`

### 4.4 `DIFF_TRUNCATE` akıllılaştır
- Binary dosyaları (`.png`, `.lock`, `.wasm`) diff'ten çıkar
- Satır sayısı > 500 ise sadece değişen dosya listesi + ilk 50 satır
- **Dosyalar:** `core/src/agents/graphRunner.ts`

---

## Faz 5 — Yeni Özellikler (Büyüme)
> Hedef: kullanıcı tabanını genişlet, güven oluştur.
> Tahmini süre: 3-4 hafta

### 5.1 Velocity / cost dashboard
- `/insights` route zaten var — genişlet
- Per-project: task/gün, ortalama tamamlanma süresi, toplam USD harcama
- Haftlık trend grafik (Recharts, zaten projede var mı kontrol et)
- **Dosyalar:** `core/src/routes/insights.ts`, yeni dashboard sayfası

### 5.2 Cross-project budget dashboard
- Tüm projeler → toplam token/maliyet özeti
- Aylık cap ayarı (aşılınca yeni task'lar blokla, uyarı ver)
- **Dosyalar:** yeni route + UI

### 5.3 Task şablonları
- Önceden tanımlı task yapıları: "Bugfix", "Feature", "Refactor", "Test Coverage"
- AddTaskModal'da şablon seçici
- Şablon: başlık prefix, description boilerplate, model önerisi, allowedTools seti
- **Dosyalar:** `core/src/services/taskService.ts`, AddTaskModal

### 5.4 Dry-run modu
- Task DOING'e atılmadan önce "Preview" butonu
- Haiku ile $0.01'lık analiz: hangi dosyalar etkilenecek, tahmini süre/maliyet
- Sonucu task drawer'da göster, kullanıcı onaylayınca gerçek run başlat
- **Dosyalar:** yeni route, executor pre-flight, task drawer

### 5.5 Inbound webhook trigger
- `POST /api/webhooks/trigger` — secret key + task payload
- Slack slash command veya GitHub Action'dan task oluştur ve DOING'e at
- **Dosyalar:** yeni route + auth middleware genişletmesi

---

## Faz 6 — Platform Genişleme
> Hedef: Claude bağımlılığını azalt, daha geniş ekiplere ulaş.
> Tahmini süre: 4-6 hafta

### 6.1 Auth / multi-user
- JWT tabanlı basit auth (kullanıcı adı + şifre, OAuth sonra)
- Task'lara `createdBy` field ekle
- API key desteği (CI/CD entegrasyonu için)
- **Not:** SQLite yeterli, PostgreSQL'e geçiş bu fazda değil

### 6.2 Multi-model desteği (non-Claude)
- `claudeService.ts` → `agentService.ts` soyutlama katmanı
- Provider: `claude` | `openai` | `gemini` | `ollama`
- Her provider için `runAgent(options): Promise<RunResult>` implement et
- Per-task model seçimi bu altyapıya taşır
- **Not:** Büyük refactor. Önce Faz 2 tamamlanmış olmalı.

### 6.3 GitLab desteği
- `gitService.ts` — GitHub CLI çağrıları soyutla
- GitLab CLI (`glab`) provider ekle
- PR → MR terminoloji adaptasyonu
- **Not:** `gh` CLI'ya çok derin bağımlılık var, dikkatli soyutlama gerek.

---

## Uygulama Kuralları

1. **Bir seferde bir item** — bitti, test edildi, commit atıldı, sonraki başlar
2. Her item için: `core/` → `npm run typecheck`, `gui/` → `pnpm typecheck && pnpm lint`
3. Faz sırası değişmez — kritik güvenlik/maliyet önce, platform genişleme sonra
4. Her item tamamlandığında `ROADMAP.md`'yi güncelle (Completed bölümüne taşı)
5. Faz 3 roadmap itemleri için mevcut `ROADMAP.md` Planned section silinir, bu plan esas alınır

---

## Başlangıç Noktası

**Şu an yapılacak ilk iş:** `1.1 commentRunner budget cap` + `1.3 --max-turns limiti`

Bu ikisi en az eforla en kritik riski kapatır.
