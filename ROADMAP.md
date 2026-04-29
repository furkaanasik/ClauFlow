# ROADMAP

## 1. Project Claude Config + Agent Studio

**Maliyet:** ~6-8 gün · **Değer:** çok yüksek (ClauFlow'u "task runner"dan "Claude proje kontrol paneli"ne dönüştürür)

Proje detay ekranına Claude'un proje-yerel sürface alanını yöneten bir kontrol paneli. Kullanıcı IDE açmadan veya CLI komutu yazmadan agent / skill / talimatlarını tamamen GUI üzerinden kurar.

### Kapsam (MVP)

- **CLAUDE.md editor** — markdown editor + preview, projenin global talimatlarını yaz/güncelle
- **Agents CRUD** — `.claude/agents/*.md` listele, ekle, düzenle, sil; frontmatter form + body editor
- **Skill Manager (proje içi marketplace)** — Claude marketplace'inden skill keşfet, **tek tık install**, enable/disable, uninstall. Backend kendi mini installer'ı çalıştırır: `git clone` → `.claude/plugins/<slug>` → `settings.json` enable. CLI'nin interactive `/plugin install` akışına bağımlı **değil**.
- **Agent Studio (AI-assisted)** — kullanıcı raw markdown yazmaz: "Şöyle bir ajan istiyorum…" prompt'u verir → Claude agent markdown'unu üretir → kullanıcı onaylar / iter eder → diske yazılır. Sürükle-bırak ile skill atama, takım kurma.
- **Prereq onboarding** — `claude` / `git` / `gh` yüklü mü kontrolü; eksikse yönergeli ekran (komut kopyala butonuyla)

### Skill ↔ Agent atama modu

İki seçenek desteklenir, default soft:
- **Soft**: Agent markdown body'sine "Kullanılabilir Skill'ler" tablosuna satır eklenir (Claude'a ipucu)
- **Hard**: Agent frontmatter'ında `tools:` whitelist'i (agent o skill'in dışına çıkamaz)

### Kapsam dışı (sonra düşünülür)

- `settings.json` visual editor
- Hooks editor
- MCP server config
- User-level (`~/.claude`) skill/agent yönetimi
- Custom marketplace ekleme (default sadece verified kaynaklar)

### Mimari notlar

- Backend: `pluginRegistry`, `pluginInstaller`, `pluginManager`, `prereqCheck` servisleri
- WS event: `skill_install_progress` (clone yüzdesi, status)
- Agent Studio için Claude API/CLI ile generate, kullanıcı onaylamadan disk dokunulmaz
- UI: `ProjectDetailDrawer` içinde yeni "Claude Config" tab'ı, alt segmentli (Instructions / Agents / Skills / Studio)

---

## Tamamlananlar

- ✅ Issue ID konvansiyonu (`KPI-3` gibi displayId)
- ✅ Yapılandırılmış tool call streaming (stream-json + collapsible tool log)
- ✅ Token + cost observability
- ✅ Task silme
- ✅ Frontend ölçek / yoğunluk (#12)
- ✅ Tüm UI yenilemesi — Fraunces tipografi, modern landing (canlı mini-kanban demo), tüm iç sayfaların sadeleştirilmesi
- ✅ Modern diff görünümü (PR detay) — per-file collapsible blok, sticky header, **Mark viewed** toggle + auto-scroll, sidebar tick mirror, lime/coral palet, hunk header `↳ line N + context` olarak insancıllaştı

---

## Yapma kuralı

Yukarıdaki işlerden sadece **biri** o anda aktif olsun. Bitir, kullan, sevdiysen sıradakine geç. Hepsini birden başlatma.
