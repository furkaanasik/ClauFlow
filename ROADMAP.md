# ROADMAP

## 1. Modern diff görünümü (PR detay)

**Maliyet:** ~1-2 gün · **Değer:** yüksek (PR review ana iş akışı, mevcut diff oldukça ilkel)

Hedef: GitHub / Graphite / Linear hissinde, file-tree + side-by-side panel.

- **Layout**: Solda collapse edilebilir file tree (ikon + path + +/- delta), sağda diff panel
  - File tree resizable (drag handle), localStorage'a genişlik kaydı
  - Klavye: `j/k` dosyalar arası, `[/]` collapse-expand all
- **Diff panel**:
  - Üstte segmented control: `Unified` ↔ `Split` (side-by-side) — kullanıcı tercihi localStorage'da
  - Whitespace ignore toggle (`?w=1`)
  - Wrap / no-wrap toggle
  - Her hunk collapsible (header tıkla); büyük dosyalarda otomatik collapse
- **Renk paleti** (Tailwind v4 variable'lar üzerinden, tema-bilinçli):
  - Add: `--color-emerald-500/15` bg, `--color-emerald-400` text marker
  - Remove: `--color-rose-500/15` bg, `--color-rose-400` text marker
  - Word-level diff highlight (yoğun yeşil/kırmızı satır içi span — `diff-match-patch` veya `diff` paketi)
  - Hunk gutter / satır numarası ayrı sütun, sticky
- **Tek dosya bazında** "view file" / "view raw" link (GitHub'a yönlendir)
- Mevcut `PRDetailDrawer` zaten tam ekran modal — diff render'ını kendi component'ine ayır (`<DiffView />`), Split/Unified iki layout aynı veriyi tüketsin

---

## Tamamlananlar

- ✅ Issue ID konvansiyonu (`KPI-3` gibi displayId)
- ✅ Yapılandırılmış tool call streaming (stream-json + collapsible tool log)
- ✅ Token + cost observability
- ✅ Task silme
- ✅ Frontend ölçek / yoğunluk (#12)

---

## Yapma kuralı

Yukarıdaki işlerden sadece **biri** o anda aktif olsun. Bitir, kullan, sevdiysen sıradakine geç. Hepsini birden başlatma.
