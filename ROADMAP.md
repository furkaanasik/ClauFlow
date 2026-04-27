# ROADMAP

Multica'yı incelerken çıkan ilham notları. Sırasıyla 3 küçük iş; gerisini atla.

---

## 1. Issue ID konvansiyonu (`KPI-3` gibi)

**Maliyet:** ~1 saat · **Değer:** yüksek (paylaşması/konuşması kolay, "ciddi tool" hissi)

- `projects` tablosuna `slug` (örn `"kpi"`) + `taskCounter` (autoincrement) alanları
- `tasks` tablosuna `displayId` (örn `"KPI-3"`)
- Yeni task oluşturulurken: `displayId = "${project.slug.toUpperCase()}-${++project.taskCounter}"`
- TaskCard, TaskDetailDrawer header, PR title, branch name (`feature/kpi-3-add-login`), comment'larda raw UUID yerine `displayId` göster
- Migration: mevcut task'ları proje bazında `createdAt`'e göre sırala, 1-2-3 numarala

---

## 2. Yapılandırılmış tool call streaming

**Maliyet:** ~1-2 gün · **Değer:** yüksek (log okurluğu kat kat artar)

- `claudeService.runClaude` zaten `outputFormat` parametresi destekliyor — `"stream-json"` kullan
- Stream-json event tipleri: `text` / `tool_use` / `tool_result` / `usage`
- Yeni WS event: `agent_tool_call` payload `{ tool, args, result, durationMs, status }`
- DB:
  - Ya `agent.toolCalls: ToolCall[]` JSON sütunu
  - Ya da ayrı `task_tool_calls` tablosu (taskId, toolName, args, result, startedAt, finishedAt)
- TaskDetailDrawer'da log bölümü:
  - Read / Edit / Bash / Grep gibi tool'lar renk-kodlu badge'le
  - Her tool call collapsible (caret); result expand'de inline
  - Üstte özet: "10 tool calls · 7m 17s"

---

## 3. Token + cost observability

**Maliyet:** ~1 gün · **Değer:** orta (maliyet farkındalığı, optimize etmek için ölçüm)

- `claude --output-format json` envelope'unda zaten `usage` blokları var: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
- `tasks` tablosuna `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` (hepsi `INTEGER DEFAULT 0`)
- Her `runClaude` sonrası agent log'tan `usage`'ı çek, task'a yaz
- TaskDetailDrawer altında pill: `"Used 32K tokens · ~$0.18"` (basit hesap: input × $3 + output × $15 / 1M, Sonnet 4.5 fiyatları)
- (Opsiyonel) Project header'da toplam: `"Bu proje: 1.2M tokens · ~$14.50"`

---

## 4. Task silme

**Maliyet:** ~birkaç saat · **Değer:** orta (eksik temel fonksiyon — kullanıcı yanlış task açtığında silebilmeli)

- TaskCard / TaskDetailDrawer'a delete butonu — `ConfirmDialog` ile teyit (window.confirm değil)
- `DELETE /api/tasks/:id` route'u (varsa kontrol, yoksa ekle), comments cascade SQLite ON DELETE
- Active executor halt: branch checkout halinde olan bir task silinmek isteniyorsa abort sinyali (commentRunner için de aynı)
- Optimistic UI update + WS event: `task_deleted` payload `{ taskId }`
- Mevcut PR'ları bozma — sadece kanban DB'den siler, git branch / GitHub PR'lara dokunma. Kullanıcı isterse manuel kapatır.

---

## Bilerek atlananlar

- **Multi-runtime / daemon mimarisi** → tek makine + tek kullanıcı senaryonda gereksiz; mevcut `recoverOrphanedTasks` ve auto-stash zaten %90 çözüyor
- **Agent-as-teammate (Assignee dropdown)** → sen tek kullanıcısın, dropdown'da bir seçenek olur, anlamsız
- **Skills sistemi** → Claude Code'un native skill mekanizması (`~/.claude/skills/`) zaten var; ayrı UI yapma, kullanıcılar oraya yazsın
- **Backlog kolonu** → 4 kolon zaten yetiyor; istemezsen gerek yok

---

## Yapma kuralı

Yukarıdaki işlerden sadece **biri** o anda aktif olsun. Bitir, kullan, sevdiysen sıradakine geç. Hepsini birden başlatma.
