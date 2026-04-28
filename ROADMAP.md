# ROADMAP

## 1. Frontend ölçek / yoğunluk

**Maliyet:** ~yarım gün · **Değer:** yüksek (her şey 13–14px, "minik tool" hissi veriyor — tek başına ciddiyet algısını değiştiriyor)

- Tailwind v4 token'larında base font 14px → 15-16px; `text-xs` çoğu yerde `text-sm`'e çıkar
- Header / Sidebar / Board kolon genişlikleri: kolon min-width ~280px → ~320px, padding `p-3` → `p-4`
- TaskCard: title `text-sm` → `text-base`, satır yüksekliği `leading-snug`, agent badge boyutu büyüt
- TaskDetailDrawer: drawer genişliği ~480px → ~560px, log bloğu `text-xs` → `text-[13px]`, monospace font tek tip
- Sidebar item yüksekliği: ~28px → ~36px, ikon 14 → 16
- Buton hit-area minimum 32x32 (a11y) — şu an 24-26 civarı
- Tema variable'larından bağımsız olarak; light/dark her ikisinde de aynı ölçek geçerli
- Tek seferde değil component-component dön: önce Board, sonra Drawer, sonra Sidebar/Header

---

## 2. Modern diff görünümü (PR detay)

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

## Yapma kuralı

Yukarıdaki işlerden sadece **biri** o anda aktif olsun. Bitir, kullan, sevdiysen sıradakine geç. Hepsini birden başlatma.
