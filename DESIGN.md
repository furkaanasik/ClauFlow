# Atölye Tasarım Sistemi

ClauFlow arayüzünün ("Atölye") taşınabilir tasarım dokümanı. Başka bir projeye, Next.js olmasa bile, bu dosyayı bir AI kodlama ajanına vererek aynı görünümü kurmak için yazıldı.

**Doğruluk kaynağı:** Buradaki her değer koddan kopyalandı. Kaynaklar şunlar: `gui/src/app/globals.css`, `gui/src/components/ui/*`, `gui/src/components/Shell/*`, `gui/src/components/Board/*`, `gui/src/components/Card/TaskCard.tsx`, `gui/src/components/three/*`, `gui/src/hooks/useTheme.ts`, `gui/src/lib/theme.ts` ve `gui/src/app/layout.tsx`. Eski tasarım planıyla (repo dışında, `atolye-lab/plans/` altında tutuluyor) kod ayrıştığında kod esas alındı. Kodda olmayan bir şey için "tanımlı değil" yazıldı.

> **Önce şunu okuyun: kök font 14px.** `globals.css` içinde `html, body { font-size: 14px; }` tanımlı. Bu yüzden **1rem = 14px**. Kaynaktaki tüm `rem` değerleri, Tailwind'in `rem` tabanlı yardımcıları da dahil (`h-16`, `text-xs`, `gap-3` …), 14px üzerinden hesaplanır. Tablolarda kaynak değer yazıldı, gerektiğinde parantez içinde px karşılığı da verildi (ör. `2.5rem` (35px)). Başka bir projede aynı ölçüleri istiyorsanız kökü 14px yapın ya da rem değerlerini px'e çevirin. Media query'lerdeki rem değerleri ise tarayıcı varsayılanına (16px) göre çözülür, kök fonttan etkilenmez.

---

## İçindekiler

1. [Ruh ve ilkeler](#1-ruh-ve-ilkeler)
2. [Renk tokenları ve tema](#2-renk-tokenları-ve-tema)
3. [Tipografi](#3-tipografi)
4. [Kenarlık, köşe, gölge](#4-kenarlık-köşe-gölge)
5. [Bileşenler](#5-bileşenler)
6. [Yerleşim](#6-yerleşim)
7. [Hareket](#7-hareket)
8. [3D (Three.js / R3F)](#8-3d-threejs--r3f)
9. [Erişilebilirlik](#9-erişilebilirlik)
10. [Başka projeye taşıma](#10-başka-projeye-taşıma)
11. [Bilinen boşluklar ve uyarılar](#11-bilinen-boşluklar-ve-uyarılar)

---

## 1. Ruh ve ilkeler

`globals.css` dosyasının başlığındaki kendi tarifi şöyle: *"Printed-workshop language: cream paper, 2px ink rules, hard offset shadows, mustard actions, cobalt section pills. Night shift = same press, dark stock."*

- **Basılı atölye ve oyun arayüzü.** Krem kâğıt zemin, her yüzeyde 2px mürekkep çizgi ve bulanıklığı olmayan sert ofset gölge. Arayüz basılmış karton plakalardan oluşuyormuş gibi görünür.
- **Hardal (`--mustard`) eylem ve "aktif" rengidir.** Birincil buton, seçili segment, raydaki aktif öğe, işaretli checkbox ve sekme şapkası hardaldır.
- **Kobalt (`--cobalt`) etiket rengidir.** Bölüm pilleri ("Upgrades" stili), bilgi, açık PR durumu ve odak halkası kobalttır.
- **Jira/Trello yoğunluğu.** 14px gövde metni, sıkı satır aralıkları, sayaçlar, mono anahtarlar (`CLF-87`), Trello tarzı sütunlar ve Jira tarzı liste tablosu.
- **Gece vardiyası.** Aynı baskı, koyu kâğıt üzerinde. Tokenların adları aynı kalır, yalnızca değerleri değişir.
- **Kâğıt dokusu.** `body::before` üzerinde çok hafif bir SVG gürültüsü var (kremde `0.045`, gecede `0.05` opaklık).
- **Elle tutulur geri bildirim.** Hover'da öğe kalkar (sola-yukarı kayar, gölge büyür). Basınca gömülür (sağa-aşağı kayar, gölge küçülür).

### Yap / Yapma

| Yap | Yapma |
|---|---|
| Her yüzeye `2px solid var(--line)` kenar ver (panel, buton, girdi, pil, kart). | Bulanık `box-shadow` ya da `backdrop-blur` kullanma. 2D kodda bulanık gölge **yok**. Tüm gölgeler `Xpx Ypx 0` biçiminde. |
| Gölgeyi `var(--shadow-ink)` renginde, blur 0 ile ver (`3px 3px 0`). | Yumuşak gradient dolgu kullanma. Kodda gradient yalnızca **sert duraklı desen** olarak var: tarama (`repeating-linear-gradient`), nokta ızgara, fosforlu kalem bandı. Tek yumuşak istisna ajan çekirdeğinin halesi (`radial-gradient`). |
| Küçük renkli metin için `--*-text` varyantlarını kullan (`--cobalt-text` …). | Parlak dolgu rengini (`--mustard`, `--orange` …) küçük metin rengi olarak kullanma. Kontrastı yetmez. |
| Dolgu üstündeki metin için `--on-*` tokenını kullan (`--on-mustard` …). | Bileşenlerde ham hex ya da hazır palet rengi (`rose-500`, `text-[#..]`) kullanma. Plan §4 bunu yasaklıyor, 3D bile renkleri CSS tokenlarından okuyor. |
| ID, sayaç, maliyet, zaman, etiket ve log için mono font (JetBrains Mono) kullan. | Butonu devre dışı bırakırken yarı saydam yapma. Devre dışı buton "mürekkepsiz plaka"dır: sunken zemin, soluk çizgi, gölge yok. |
| Boş ve yer tutucu durumlar için tarama desenini (`.ui-hatch`) kullan. | Odak halkasını `box-shadow` ile yapma. Sert gölgeyle çakışır. Odak halkası her zaman `outline` (2.5px kobalt). |
| Seçili filtre çipini mürekkep plaka ve hardal ofset gölgeyle göster. | Gecede gölgeyi `--line` ile verme. Krem gölge parlıyor, bu yüzden ayrı `--shadow-ink` tokenı var. |
| Onay için `ConfirmDialog` kullan. | `window.confirm` kullanma (plan §7). |

---

## 2. Renk tokenları ve tema

Tokenlar `:root` (krem, varsayılan) ve `html.night` (gece) üzerinde CSS custom property olarak tanımlı. `.theme-cream` ve `.theme-night` sınıfları bir alt ağaçta temayı zorlar (styleguide iki temayı yan yana bu yolla gösteriyor). Tokenların hepsi küçük harfli hex olarak kopyalandı.

### 2.1 Krem (varsayılan): `:root, .theme-cream`

`color-scheme: light;`

| Token | Hex | Rol / kullanım |
|---|---|---|
| `--paper` | `#f4ecda` | Sayfa zemini |
| `--panel` | `#fbf6ea` | Kartlar, paneller, butonlar (secondary) |
| `--sunken` | `#eadfc6` | Girdi alanları, boş slotlar, gösterge yuvaları, tablo başlığı, modal alt şeridi |
| `--ink` | `#1b1712` | Ana metin |
| `--ink-2` | `#4a4237` | İkincil metin |
| `--ink-3` | `#6b6152` | Soluk metin, pasif noktalar, `t-label` (spec `#7D7364` idi, 4.5:1 için koyulaştırıldı) |
| `--line` | `#1b1712` | 2px kalın kenarlık |
| `--hair` | `#1b171226` | İnce ayraçlar, ghost hover zemini, tarama deseni |
| `--mustard` | `#f2c33d` | Birincil eylem, aktif segment, aktif ray öğesi |
| `--mustard-press` | `#d9a923` | Birincil buton basılı, segment alt çizgisi |
| `--cobalt` | `#2d5be3` | Bölüm pilleri, bilgi, açık PR, odak (`--focus`) |
| `--orange` | `#ee7b2c` | Çalışan ajan (doing), uyarı, yürüyen kenar |
| `--red` | `#c8372d` | Tehlikeli eylem, hata |
| `--green` | `#3e9b5a` | Done, başarı, switch açık |

**Metin için güvenli varyantlar** (kod yorumu: *"≥4.5:1 on paper and sunken. Fills keep the bright hue; small text uses these."*)

| Token | Hex |
|---|---|
| `--mustard-text` | `#7f5b00` |
| `--orange-text` | `#a3460f` |
| `--green-text` | `#276e3d` |
| `--red-text` | `#b3302a` |
| `--cobalt-text` | `#2850c8` |

**Dolgu üstü mürekkep** (*"Ink to put on top of a filled hue"*)

| Token | Hex |
|---|---|
| `--on-ink` | `#f4ecda` |
| `--on-mustard` | `#1b1712` |
| `--on-orange` | `#1b1712` |
| `--on-green` | `#1b1712` |
| `--on-cobalt` | `#fbf6ea` |
| `--on-red` | `#fbf6ea` |

**Efekt tokenları**

| Token | Değer | Rol |
|---|---|---|
| `--shadow-ink` | `var(--line)` | Sert gölge rengi |
| `--scrim` | `rgb(27 23 18 / 0.34)` | Modal/drawer arka perdesi |
| `--grain-opacity` | `0.045` | Kâğıt dokusu opaklığı |
| `--grain-blend` | `multiply` | Kâğıt dokusu karışım modu |

### 2.2 Gece vardiyası: `html.night, .theme-night`

`color-scheme: dark;`

| Token | Hex | Not |
|---|---|---|
| `--paper` | `#17140f` | |
| `--panel` | `#221e17` | |
| `--sunken` | `#100e0a` | |
| `--ink` | `#f4ecda` | |
| `--ink-2` | `#cfc4ae` | |
| `--ink-3` | `#9d937f` | Spec `#8E8471` idi. Panelde ve turuncuya boyanmış çalışan kartta 4.5:1 için açıldı. |
| `--line` | `#e9dfc9` | |
| `--hair` | `#f4ecda22` | |
| `--mustard` | `#f2c33d` | Kremle aynı |
| `--mustard-press` | `#d9a923` | Kremle aynı |
| `--cobalt` | `#5b82f0` | |
| `--orange` | `#f08a42` | |
| `--red` | `#e2574c` | |
| `--green` | `#5bb877` | |
| `--mustard-text` | `#f2c33d` | Gecede baz renkle aynı |
| `--orange-text` | `#f08a42` | Baz renkle aynı |
| `--green-text` | `#5bb877` | Baz renkle aynı |
| `--red-text` | `#ee766b` | Bazdan **farklı** (daha açık); hata banner'ında 5,1:1 (bkz. §2.5) |
| `--cobalt-text` | `#7b9af3` | Bazdan **farklı** (daha açık) |
| `--on-ink` | `#17140f` | |
| `--on-mustard` | `#1b1712` | |
| `--on-orange` | `#1b1712` | |
| `--on-green` | `#1b1712` | |
| `--on-cobalt` | `#17140f` | Kremde açık, gecede koyu |
| `--on-red` | `#17140f` | Kremde açık, gecede koyu |
| `--shadow-ink` | `#b9ae97` | *"Chalk-on-slate: the offset shadow is the paper colour, slightly dimmed so it reads as a printed plate rather than a glow."* |
| `--scrim` | `rgb(5 4 3 / 0.62)` | |
| `--grain-opacity` | `0.05` | |
| `--grain-blend` | `screen` | |

### 2.3 Ortak geometri tokenları

`:root, .theme-cream, .theme-night` üzerinde tanımlı. Her tema kökünde yeniden tanımlanır ki bir `.theme-*` alt ağacı türetilmiş değerleri (gölgeler, `--border`) kendi paletine göre çözsün.

| Token | Değer |
|---|---|
| `--r-panel` | `14px` |
| `--r-btn` | `10px` |
| `--r-pill` | `999px` |
| `--r-sm` | `6px` |
| `--shadow` | `3px 3px 0 var(--shadow-ink)` |
| `--shadow-hover` | `4px 4px 0 var(--shadow-ink)` |
| `--shadow-press` | `1px 1px 0 var(--shadow-ink)` |
| `--shadow-lg` | `6px 6px 0 var(--shadow-ink)` |
| `--focus` | `var(--cobalt)` |
| `--ease-press` | `cubic-bezier(0.3, 0.7, 0.4, 1)` |
| `--border` | `color-mix(in srgb, var(--line) 24%, var(--paper))` (prose tabloları, markdown ve kod çipleri için yumuşak 1px çizgi) |

### 2.4 Anlamsal eşlemeler

**Durum renkleri** (`STATUS_COLOR`, `components/ui/Pills.tsx`). `fill` dolgu ve nokta, `on` dolgu üstü metin, `text` küçük renkli metin için.

| Durum | `fill` | `on` | `text` |
|---|---|---|---|
| `todo` | `var(--ink-3)` | `var(--on-ink)` | `var(--ink-2)` |
| `doing` | `var(--orange)` | `var(--on-orange)` | `var(--orange-text)` |
| `review` | `var(--mustard)` | `var(--on-mustard)` | `var(--mustard-text)` |
| `done` | `var(--green)` | `var(--on-green)` | `var(--green-text)` |
| `nothing` | `var(--ink-3)` (nokta taralı) | `var(--on-ink)` | `var(--ink-3)` |

`StatusKind` görev durumundan (`TaskStatus` = `todo` \| `doing` \| `review` \| `done`) ayrıdır: `nothing` görev durumu değil, TopBar'ın "Çevrimdışı" hapı ve proje çekmecesinin nötr hapları (boşta, "yalnızca yerel") için kalır. Açık PR'lar `info` (kobalt) ile boyanır (`lib/githubConstants.ts`).
| `error` | `var(--red)` | `var(--on-red)` | `var(--red-text)` |
| `info` | `var(--cobalt)` | `var(--on-cobalt)` | `var(--cobalt-text)` |

**Öncelik** (`PriorityMark` ve kart şeridi): `low` = 1 çentik, `var(--ink-3)`. `medium` = 2 çentik, `var(--cobalt)`. `high` = 3 çentik, `var(--orange)`. `critical` = 4 çentik, `var(--red)`. Anlamı şekil taşır, renk destekler.

**Etiket noktaları** (`tagDot`, `lib/boardView.ts`): etiket adının hash'i şu listeden bir renk seçer: `var(--cobalt)`, `var(--orange)`, `var(--green)`, `var(--mustard)`, `var(--red)`, `var(--ink-3)`.

**Avatar dolguları** (iki temada da kontrastı geçen çiftler): mustard/on-mustard, cobalt/on-cobalt, orange/on-orange, green/on-green, sunken/ink.

**Toast:** success `--green`, error `--red`, info `--cobalt` (metin `--on-*`).

**Legacy `Badge` tonları:** `neutral` → ink-3 nokta / ink-2 metin. `blue` → cobalt / cobalt-text. `yellow` ve `purple` → mustard / mustard-text (`purple` eskiden review rengiydi). `orange`, `green` ve `red` kendi tokenlarına gider.

### 2.5 Kontrast kararları (koddan ve plan §11'den)

- `--ink-3` krem: `#7D7364` → `#6b6152` (plana göre kâğıtta 3.96 → 5.17:1).
- `--ink-3` gece: koddaki değer `#9d937f`. Plan §11'e göre çalışan kartın turuncu zemininde 4.88:1, panelde 5.46:1. Plandaki ara değer `#968C78` eskidi, kod esas.
- Birincil buton: hardal üstünde mürekkep metin, **10.7:1** (`Button.tsx` yorumu).
- Styleguide metni: kâğıt üstünde mürekkep **15:1**.
- `--*-text` varyantları kremde kâğıt ve sunken üzerinde ≥4.5:1. Gecede baz renklerle aynı (`--cobalt-text` ve `--red-text` hariç).
- `--red-text` gece: `#e2574c` → `#ee766b` (bakım F1). Baz kırmızıyla aynıyken hata banner'ının zemininde (`color-mix(red 12%, panel)`) 3,91:1, çalışan kartta 4,02, diff'te silinen satır numarasında (`red 22%, sunken`) 4,06 ve silinen satırın `-` işaretinde 3,88 kalıyordu. Yeni değerle sırasıyla 5,11 / 5,25 / 5,30 / 5,06; panelde 4,50 → 5,88. `--red` (dolgu, kenar, `inset` şerit) değişmedi. Matris: `atolye-lab/ekran-goruntuleri/scripts/kontrast-bakim.mjs`.
- Diff numara hücreleri (bakım F1): kremde `--red-text` `red 22% sunken` üstünde 3,51:1, `--green-text` `green 24% sunken` üstünde 3,78:1 kalıyordu (axe tek haneli sayıları `shortTextContent` diye "incomplete" bırakır, yalnız matris yakaladı). Numara metni iki temada `--ink-2`: krem 5,56 / 6,02, gece 8,66 / 7,41. Zemin tonları değişmedi.
- Gecede `--on-cobalt` ve `--on-red` koyu. Plan §11: gece kobaltı üstünde krem metin 3.0:1 kalıyordu.
- Gecede gölge `--line` değil `--shadow-ink` (`#b9ae97`). Tam krem gölge parlıyordu.
- Landing fosforlu kalemi (`.landing-mark`) gecede x-yüksekliğinin altına iner (`82%`–`97%` bandı). Krem yazı hardal üstünde fazla soluk kalıyordu.
- 3D'de nesne konturu gecede `--sunken` (neredeyse siyah). Işıklı formlarda krem kontur parlıyordu (bkz. §8).

### 2.6 Tema mekanizması

- Krem varsayılandır: `<html>` üzerinde sınıf yoktur. Gece için `<html>`'e `night` sınıfı eklenir.
- Değer `localStorage.theme` içinde `"cream"` ya da `"night"` olarak saklanır (`THEME_STORAGE_KEY = "theme"`, `NIGHT_CLASS = "night"`).
- Sistem temasına (`prefers-color-scheme`) göre otomatik seçim **yok**. Kayıt yoksa krem.
- **Boot script** `<head>` içinde, ilk boyamadan önce çalışır. Eski değerleri taşır (`light` → `cream`, `dark` → `night`), eski `light` sınıfını siler ve gerekirse `night` ekler. Sabitler yerine konmuş hali şöyle (`lib/theme.ts`):

```html
<script>(function(){try{var d=document.documentElement,k='theme',t=localStorage.getItem(k);if(t==='light')t='cream';else if(t==='dark')t='night';if(t==='cream'||t==='night'){localStorage.setItem(k,t)}else{t=null}d.classList.remove('light');if(t==='night')d.classList.add('night');}catch(e){}})()</script>
```

- `<html>` üzerinde `suppressHydrationWarning` var (sınıf sunucu çıktısından farklı olabilir).
- `useTheme()` (`hooks/useTheme.ts`) `useSyncExternalStore` ile sınıfı okur, sunucu anlık görüntüsü `"cream"`. `applyTheme(t)` sınıfı değiştirir ve `localStorage`'a yazar (gizli modda `try/catch`). Başka sekmedeki değişiklik `storage` olayıyla senkronlanır. Dönüş değeri: `{ theme, isNight, setTheme, toggleTheme }`.
- Tema düğmesi üst barda: gece ise `IconSun`, krem ise `IconMoon` gösteren ghost `IconButton`.

---

## 3. Tipografi

### 3.1 Fontlar ve yükleme

| Rol | Font | Yükleme (`app/layout.tsx`, `next/font/google`) |
|---|---|---|
| Arayüz ve başlıklar | **Jost** | `subsets: ["latin", "latin-ext"]`, `weight: ["400","500","600","700","800"]`, `style: ["normal","italic"]`, `variable: "--font-jost"`, `display: "swap"` |
| ID, log, sayı, etiket | **JetBrains Mono** | `subsets: ["latin", "latin-ext"]`, `variable: "--font-jetbrains-mono"`, `display: "swap"` (ağırlık belirtilmemiş, değişken font) |

Her iki değişken sınıfı `<html>`'e eklenir: ``className={`${jost.variable} ${jetbrainsMono.variable}`}``.

Font yığınları (`@theme inline`):

```css
--font-display: var(--font-jost), "Futura", "Century Gothic", ui-sans-serif, system-ui, sans-serif;
--font-sans:    var(--font-jost), "Futura", "Century Gothic", ui-sans-serif, system-ui, sans-serif;
--font-mono:    var(--font-jetbrains-mono), ui-monospace, "SFMono-Regular", Menlo, monospace;
```

`code, pre, kbd, samp` mono fonttur ve `font-feature-settings: "calt", "liga";` alır. `input, textarea, select, button` fontu miras alır (`:where(...) { font-family: inherit; }`).

### 3.2 Taban

```css
html, body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
::selection { background: var(--mustard); color: var(--on-mustard); }
```

### 3.3 Tipografi yardımcıları (`globals.css`)

| Sınıf | Tanım | px (kök 14px) |
|---|---|---|
| `.t-display` | `font-family: var(--font-display); font-style: normal; font-weight: 700; letter-spacing: -0.025em; line-height: 1.05;` (boyut ayrıca verilir) | – |
| `.t-h1` | `font-size: 1.75rem; font-weight: 700; line-height: 1.15; letter-spacing: -0.025em; color: var(--ink);` | 24.5px |
| `.t-h2` | `font-size: 1.125rem; font-weight: 700; line-height: 1.3; letter-spacing: -0.012em; color: var(--ink);` | 15.75px |
| `.t-body` | `font-size: 0.875rem; line-height: 1.55; color: var(--ink);` | 12.25px |
| `.t-label` | `font-family: var(--font-mono); font-size: 0.6875rem; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; color: var(--ink-3);` | 9.625px |

`.t-label`, mono fontlu, aralıklı büyük harf etikettir. Rayda bölüm başlığı (`t-label !text-[10px]`), istatistik başlığı (`!text-[10px] !tracking-[0.12em]`), Tile etiketi (`!text-ink-2`) ve drawer yan sütun başlıkları için kullanılır.

### 3.4 Sık kullanılan boyutlar (gerçek kullanımdan)

Font-size için token **tanımlı değil**. Boyutlar `t-*` sınıfları, Tailwind boyut yardımcıları ve keyfi px değerleriyle (`text-[13px]`) verilir.

| Yer | Değer |
|---|---|
| Board sayfa başlığı | `t-display text-[32px]` |
| Drawer başlığı / ConfirmDialog başlığı | `t-display text-[22px]` |
| Modal başlığı | `t-display text-xl` (Tailwind `1.25rem` = 17.5px) |
| Styleguide sergi başlığı | `t-display text-[44px]` |
| Logo kelimesi | `text-[18px] font-extrabold tracking-[-0.03em]` |
| Kart başlığı | `text-[15px] font-semibold leading-[1.3] tracking-[-0.01em]`, `line-clamp-2` |
| Sütun başlığı | `text-[14px] font-bold tracking-[-0.01em]` |
| Breadcrumb | `text-[14px]`: son öğe `font-bold text-ink`, diğerleri `font-medium text-ink-3` |
| Kart açıklaması | `text-[13px] leading-[1.45] text-ink-3`, `line-clamp-2` |
| Field label | `text-[13px] font-semibold text-ink` |
| Toast etiketi | `font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3` |
| Badge | `font-mono text-[10px] font-semibold uppercase tracking-[0.1em]` |
| Tile değeri | `font-mono text-[28px] font-semibold leading-none tracking-tight` |
| İstatistik değeri | `font-mono text-[20px] font-bold leading-none tabular-nums` |

### 3.5 Ağırlıklar ve aralık

- Jost: 400 gövde, 500 çip/tag/menü, 600 buton/pil/sekme/rail öğesi, 700 başlık/panel başlığı, 800 logo (`font-extrabold`).
- Negatif aralık başlıklarda: `-0.025em` (display, h1), `-0.012em` (h2), `-0.01em` (panel başlığı, kart başlığı), `-0.005em` (buton).
- Pozitif aralık mono etiketlerde: `0.14em` (`t-label`), `0.1em` (badge, `agent-node__kind`), `0.04em` (`ui-keyplate`), `0.02em` (`task-card__key`).

### 3.6 Mono ne zaman kullanılır

Kodda mono fontun kullanıldığı yerler: görev anahtarı (`task-card__key`, `ui-keyplate`), sayaçlar (`ui-chip__count`, `ui-tab__count`, `ui-seg__count`, `lane__count`), maliyet ve meta (`task-card__meta`), `t-label`, `Kbd`, zamanlar ve süreler (`tl__time`, `tl__dur`, `tabular-nums`), log satırları (`logpane`), diff kodu, `RingGauge` merkez değeri, `Tile` değeri, TR/EN düğmesi, Field `aside` sayacı ve logo monogramı ("cf"). Kural: **makinenin ürettiği ya da sayılabilen her şey mono, insan dili Jost.**

---

## 4. Kenarlık, köşe, gölge

### 4.1 Kenarlık kalınlıkları

| Kalınlık | Nerede |
|---|---|
| `2px solid var(--line)` | Varsayılan kural: panel, buton, girdi, pil, çip, segment, sekme, kart, sütun, modal, drawer kenarı, ray, üst bar alt çizgisi |
| `2.5px` | Odak outline'ı. |
| `1.5px` | İkincil küçük öğeler: `ui-dot`, `ui-kbd` (alt kenar `3px`), `lane__count`, `task-card__btn`, `ui-keyplate`, `Tag`, `Badge`, `ui-seg__count` (`currentColor`) |
| `1.5px solid var(--hair)` | Tablo satır ayracı, kart alt bilgi üst çizgisi (`border-t-[1.5px] border-hair`) |
| `2px dashed var(--hair)` | Bölüm ayracı (`ui-meta + .ui-meta`, `tl__body`, `agent-node__foot`) |
| `1px solid var(--border)` | Markdown tabloları ve satır içi kod |
| `border-style: dashed` | Sürüklemede izinli hedef sütun, sürüklenen kartın yeri, boş durum kutuları, yeni proje butonu |

### 4.2 Köşe yarıçapları

| Token / değer | Nerede |
|---|---|
| `--r-panel` `14px` | Panel, sütun (`.lane`), modal, KPI tile, PR satırı, Ekip editörü paneli |
| `12px` (sabit) | Görev kartı, menü (`ui-menu`), log paneli, flow düğümü, diff dosyası, toast, sütun başlığının üst köşeleri |
| `--r-btn` `10px` | Buton (md/lg), girdi (md), segment, rail öğesi, linkrow, option, banner, logo monogramı, modal ikon plakası |
| `8px` (sabit) | Küçük buton ve girdi (`--sm`), panel ikon plakası, tooltip, menü öğesi |
| `--r-sm` `6px` | `ui-kbd`. Ayrıca `task-card__meta` ve `ui-keyplate` için sabit `6px`. |
| `--r-pill` `999px` | Pil, çip, tag, badge, sayaçlar, ray kenar tutamağı |
| `10px 10px 0 0` | Klasör sekmesi |

### 4.3 Sert gölgeler

| Token | Değer | Kullanım |
|---|---|---|
| `--shadow` | `3px 3px 0 var(--shadow-ink)` | Dinlenme hali: buton, segment, raised panel, kart |
| `--shadow-hover` | `4px 4px 0 var(--shadow-ink)` | Buton hover |
| `--shadow-press` | `1px 1px 0 var(--shadow-ink)` | Basılı buton, yükleniyor hali |
| `--shadow-lg` | `6px 6px 0 var(--shadow-ink)` | Modal, menü |
| `5px 5px 0 var(--shadow-ink)` | sabit | Etkileşimli panel, kart ve flow düğümü hover |
| `2px 2px 0 var(--shadow-ink)` | sabit | Küçük plakalar: aktif rail öğesi, SectionPill, logo, ikon plakaları, checkbox işaretli |
| `8px 10px 0 var(--shadow-ink)` | sabit | Sürüklenen kart (overlay) |
| `-4px 0 0 var(--shadow-ink)` | sabit | Drawer'ın sol kenarı |
| Renkli ofset | `2px 2px 0 var(--mustard)` (seçili çip), `3px 3px 0 var(--mustard)` (tooltip), `3px 3px 0 var(--orange)` (çalışan yorum), `3px 3px 0 var(--green)` (görüldü diff) | Durum vurgusu |
| İç şerit | `inset 4px 0 0 var(--red)`, `inset 5px 0 0 <accent>`, `inset 6px 0 0 var(--pr)` | Sol kenar vurgusu (banner, tile, PR satırı) |
| İç çizgi | `inset 0 5px 0 var(--lane)` | Sütun başlığının üst renk şeridi |
| Girdi iç gölgesi | `inset 2px 2px 0 color-mix(in srgb, var(--ink) 9%, transparent)` | Gömük girdi |

### 4.4 Hover ve basma davranışı (tam değerler)

| Öğe | Dinlenme | Hover | Basılı (`:active`) | Geçiş |
|---|---|---|---|---|
| `.ui-btn` | `--shadow` (3px) | `translate(-1px, -1px)` + `--shadow-hover` (4px) | `translate(2px, 2px)` + `--shadow-press` (1px), `transition-duration: 40ms` | `transform 110ms var(--ease-press), box-shadow 110ms var(--ease-press), background-color 140ms ease, color 140ms ease` |
| `.ui-btn--ghost` | gölge yok, kenar şeffaf | `background: var(--hair)`, kalkmaz | `translate(1px, 1px)`, zemin `color-mix(in srgb, var(--ink) 18%, transparent)` | aynı |
| `.ui-panel--interactive` | `--shadow` | `translate(-2px, -2px)` + `5px 5px 0` | `translate(1px, 1px)` + `--shadow-press` | `140ms var(--ease-press)` |
| `.task-card` | `--shadow` | `translate(-2px, -2px)` + `5px 5px 0` | – | `transform 170ms`, `box-shadow 170ms var(--ease-press)`, `opacity 160ms ease` |
| `.ui-chip` | gölge yok | zemin `color-mix(in srgb, var(--mustard) 22%, var(--panel))` | `translate(1px, 1px)` | `transform 90ms`, `background-color 120ms`, `box-shadow 90ms` |
| `.task-card__btn` | gölge yok | `translate(-1px, -1px)` + `2px 2px 0` | `translate(1px, 1px)`, gölge yok | `90ms var(--ease-press)` |
| `.ui-linkrow` | gölge yok | `translate(-1px, -1px)` + `--shadow` + hardal %12 zemin | `translate(1px, 1px)`, gölge yok | `110ms` |
| `.rail-item` | şeffaf | `background: var(--hair)` | `translate(1px, 1px)` | `120ms` / `110ms` |
| `.ui-tab` | – | `background: var(--hair)` | `translateY(1px)` | `120ms ease` |
| `.ui-check` | – | – | `scale(0.92)` | `100ms` |

İlke: **hover'da öğe sola-yukarı kayar ve gölge büyür, basınca sağa-aşağı kayar ve gölge küçülür.** Böylece plaka gölgesinin üstüne basılıyormuş gibi görünür.

---

## 5. Bileşenler

Primitive'ler `gui/src/components/ui/` altında ve `components/ui/index.ts` üzerinden dışa açılıyor. Hepsi React + `clsx`. Görünüm `globals.css` içindeki `ui-*` sınıflarından ya da Tailwind token yardımcılarından (`bg-panel`, `border-line`, `rounded-pill` …) geliyor. Aşağıdaki "tarif" bloklarında CSS doğrudan kaynaktan kopyalandı.

```ts
import {
  Button, IconButton, SectionPill, StatusPill, PriorityMark, STATUS_COLOR,
  Chip, Tag, Segmented, Panel, Tile, DotMeter, RingGauge, Tabs,
  Input, Textarea, Select, Field, Kbd, Checkbox, Switch, Tooltip,
  Avatar, Drawer, Modal, ConfirmDialog, ToastContainer, Badge,
} from "@/components/ui"; // + tüm Icon* bileşenleri
```

### 5.1 Button ve IconButton (`Button.tsx`)

**Amaç:** eylem butonu. 2px mürekkep kenar ve sert gölgesi var, basınca gömülür.

| Prop | Değerler | Varsayılan |
|---|---|---|
| `variant` | `primary` \| `secondary` \| `ghost` \| `danger` | `secondary` |
| `size` | `sm` \| `md` \| `lg` | `md` |
| `icon` / `iconRight` | ReactNode (baştaki ikon `loading` iken spinner'a döner) | – |
| `loading` | `disabled` ve `aria-busy="true"` yapar, spinner gösterir | `false` |
| `block` | tam genişlik (`ui-btn--block`) | `false` |

Sınıflar: `ui-btn ui-focus ui-btn--{variant} ui-btn--{size}`. `IconButton` ayrıca `ui-btn--icon` alır, `label` prop'u zorunludur ve hem `aria-label` hem `title` olarak basılır. Spinner boyutu: sm 14, md 16, lg 18 px. `type` varsayılan olarak `"button"`.

| Boyut | Yükseklik | Padding | Font | Köşe | IconButton genişliği |
|---|---|---|---|---|---|
| `sm` | `2rem` (28px) | `0 0.8rem` | `0.8125rem` | `8px` | `2rem` |
| `md` | `2.5rem` (35px) | `0 1.1rem` | `0.875rem` | `var(--r-btn)` | `2.5rem` |
| `lg` | `3rem` (42px) | `0 1.5rem` | `1rem` | `var(--r-btn)` | `3rem` |

| Varyant | Zemin / metin | Basılı / hover |
|---|---|---|
| `primary` | `var(--mustard)` / `var(--on-mustard)` | `:active` zemin `var(--mustard-press)` |
| `secondary` | `var(--panel)` / `var(--ink)` | `:active` zemin `var(--sunken)` |
| `danger` | `var(--panel)` / `var(--red-text)` | `:hover` zemin `var(--red)`, metin `var(--on-red)` |
| `ghost` | şeffaf / `var(--ink-2)`, kenar şeffaf, gölge yok | `:hover` zemin `var(--hair)`, metin `var(--ink)` |

```css
.ui-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  gap: 0.5em; border: 2px solid var(--line); border-radius: var(--r-btn);
  font-family: var(--font-sans); font-weight: 600; letter-spacing: -0.005em; line-height: 1;
  white-space: nowrap; user-select: none; cursor: pointer; box-shadow: var(--shadow);
  transition: transform 110ms var(--ease-press), box-shadow 110ms var(--ease-press),
    background-color 140ms ease, color 140ms ease;
}
.ui-btn:hover { transform: translate(-1px, -1px); box-shadow: var(--shadow-hover); }
.ui-btn:active, .ui-btn[data-pressed="true"] {
  transform: translate(2px, 2px); box-shadow: var(--shadow-press); transition-duration: 40ms;
}
/* Disabled: an un-inked plate — sunken stock, faded rule, no shadow */
.ui-btn:disabled:not([aria-busy="true"]), .ui-btn[aria-disabled="true"] {
  cursor: not-allowed; background: var(--sunken); color: var(--ink-3);
  border-color: color-mix(in srgb, var(--line) 35%, var(--paper)); transform: none; box-shadow: none;
}
.ui-btn--ghost:disabled:not([aria-busy="true"]) { background: transparent; border-color: transparent; }
.ui-btn[aria-busy="true"] { cursor: progress; opacity: 1; box-shadow: var(--shadow-press); transform: translate(2px, 2px); }
```

```tsx
<Button variant="primary" icon={<IconPlus size={16} />}>New task</Button>
<Button iconRight={<IconChevronDown size={14} />}>Priority</Button>
<Button variant="primary" loading>Opening PR…</Button>
<IconButton label="Close" size="sm"><IconClose size={13} /></IconButton>
```

### 5.2 SectionPill, StatusPill, PriorityMark (`Pills.tsx`)

Temel sınıf `.ui-pill`:

```css
.ui-pill { display: inline-flex; align-items: center; gap: 0.45em; border: 2px solid var(--line);
  border-radius: var(--r-pill); font-weight: 600; line-height: 1; white-space: nowrap; }
.ui-pill--sm { height: 1.5rem; padding: 0 0.6rem; font-size: 0.75rem; }      /* 21px */
.ui-pill--md { height: 1.875rem; padding: 0 0.8rem; font-size: 0.8125rem; } /* 26.25px */
```

**SectionPill:** bir panel grubunun başlığındaki kobalt etiket ("Upgrades"). Props: `tone` = `cobalt` (varsayılan) \| `ink` \| `mustard`, `size` = `md` (varsayılan) \| `sm`, `icon`, `count`. Tarifi: `ui-pill ui-pill--{size} font-bold tracking-[0.01em]` + inline `background`/`color` (ton) + `boxShadow: "2px 2px 0 var(--shadow-ink)"`. `count` şöyle basılır: `font-mono text-[0.85em] font-semibold opacity-80`.

**StatusPill:** noktalı durum satırı ("● Waiting for review"). Props: `status` (§2.4'teki yedi durum), `variant` = `soft` (varsayılan: panel zemin, ink metin, renkli nokta) \| `solid` (durum rengiyle dolu, nokta `on` renginde), `size` = `sm` (varsayılan) \| `md`, `live` (noktada atan halka), `icon` (noktanın yerine geçer). `nothing` durumu (çevrimdışı) taralı nokta (`ui-dot--hatched`) kullanır.

Nokta (`.ui-dot`):

```css
.ui-dot { display: inline-block; flex: none; width: 0.6rem; height: 0.6rem; border-radius: 999px;
  border: 1.5px solid var(--line); background: var(--dot, var(--ink-3)); }
.ui-dot--hatched { background: repeating-linear-gradient(135deg, var(--ink-3) 0 1.5px, transparent 1.5px 3.5px); }
.ui-dot--live { position: relative; }
.ui-dot--live::after { content: ""; position: absolute; inset: -4px; border-radius: 999px;
  border: 2px solid var(--dot); animation: ui-ping 1.4s var(--ease-press) infinite; }
```

**PriorityMark:** dört üçgen çentik. Her biri `<svg width="8" height="9" viewBox="0 0 8 9">` içinde `d="M4 1L7.2 8H0.8z"` yolu, `strokeWidth="1.4"`, `strokeLinejoin="round"`. Dolu çentik: `stroke="var(--line)"`, dolgu öncelik rengi. Boş çentik: `stroke="var(--ink-3)"`, `strokeOpacity 0.45`, dolgu şeffaf. Çentikler arası `gap-[2px]`. `showLabel` açıkken etiket `font-mono text-[11px] font-semibold tracking-[0.02em] text-ink-2` olur, kapalıyken `role="img"` ve `aria-label` alır.

```tsx
<SectionPill icon={<IconBolt size={13} />} count={3}>Agents</SectionPill>
<StatusPill status="doing" live>Running</StatusPill>
<StatusPill status="done" variant="solid" icon={<IconCheck size={12} />}>done</StatusPill>
<PriorityMark level="high" showLabel />
```

### 5.3 Chip ve Tag (`Chip.tsx`)

**Chip:** seçilebilir filtre çipi (`<button aria-pressed>`). Props: `selected`, `onSelectedChange`, `dot` (renk), `icon`, `count`. Seçiliyken önde `IconCheck size={13}` görünür, değilse `dot`, o da yoksa `icon`. Seçili hali **mürekkep plaka ve hardal ofset gölgedir**. Hardal dolgu aktif segment için ayrılmış.

```css
.ui-chip { display: inline-flex; align-items: center; gap: 0.45em; height: 1.875rem; padding: 0 0.75rem;
  border: 2px solid var(--line); border-radius: var(--r-pill); background: var(--panel); color: var(--ink);
  font-size: 0.8125rem; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: transform 90ms var(--ease-press), background-color 120ms ease, box-shadow 90ms var(--ease-press); }
.ui-chip:hover { background: color-mix(in srgb, var(--mustard) 22%, var(--panel)); }
.ui-chip:active { transform: translate(1px, 1px); }
.ui-chip[aria-pressed="true"], .ui-chip[data-active="true"] {
  background: var(--ink); color: var(--on-ink); box-shadow: 2px 2px 0 var(--mustard); }
.ui-chip:disabled { opacity: 0.5; cursor: not-allowed; }
.ui-chip__count { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 600;
  padding: 0.15rem 0.35rem; border-radius: 999px; background: var(--sunken); color: var(--ink-2); }
.ui-chip[aria-pressed="true"] .ui-chip__count,
.ui-chip[data-active="true"] .ui-chip__count { background: var(--mustard); color: var(--on-mustard); }
```

**Tag:** statik, istenirse kaldırılabilir etiket. Tarifi: `inline-flex h-6 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-panel pl-2 text-xs font-medium text-ink` (kaldırma butonu varsa `pr-0.5`, yoksa `pr-2`). Nokta `ui-dot !h-2 !w-2 !border`. Kaldırma butonu: `ui-focus inline-grid h-[18px] w-[18px] place-items-center rounded-pill text-ink-3 hover:bg-ink hover:text-paper`, içinde `IconClose size={10}`.

Açılır menülü çip (board hızlı filtreleri): `ui-chip ui-focus` sınıflı buton, `ui-chip__count` ve dönen `IconChevronDown`. Menü `ui-menu left-0 top-[calc(100%+8px)] w-60 p-1.5` (bkz. §5.16).

```tsx
<Chip selected={on} onSelectedChange={setOn} dot="var(--orange)" count={3}>High priority</Chip>
<Tag dot="var(--cobalt)" onRemove={() => remove("api")} removeLabel="Remove api">api</Tag>
```

### 5.4 Badge (legacy, `Badge.tsx`)

Eski API korunarak yeniden giydirildi. Tarifi: `inline-flex h-5 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-panel px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]`. Metin rengi tondan gelir. Nokta `ui-dot !h-1.5 !w-1.5 !border-0`, `pulse` açıksa `ui-dot--live` eklenir. Tonlar §2.4'te. Yeni kodda `StatusPill` tercih edilir.

### 5.5 Segmented (`Segmented.tsx`)

**Amaç:** n seçenekten biri. `role="radiogroup"` ve roving tabindex kullanır, aktif segment hardaldır. Props: `options` (`value`, `label`, `icon?`, `count?`, `disabled?`), `value`, `onChange`, `size` = `md` (varsayılan) \| `sm`, `label` (zorunlu, erişilebilir ad). ←/→/Home/End devre dışı seçenekleri atlar.

```css
.ui-seg { display: inline-flex; align-items: stretch; border: 2px solid var(--line); border-radius: var(--r-btn);
  background: var(--panel); box-shadow: var(--shadow); overflow: hidden; }
.ui-seg__item { display: inline-flex; align-items: center; gap: 0.5em; padding: 0 0.95rem; font-weight: 600;
  color: var(--ink-2); white-space: nowrap; cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }
.ui-seg__item + .ui-seg__item { border-left: 2px solid var(--line); }
.ui-seg__item:hover { background: var(--hair); color: var(--ink); }
.ui-seg__item[aria-checked="true"] { background: var(--mustard); color: var(--on-mustard);
  box-shadow: inset 0 -3px 0 var(--mustard-press); }
.ui-seg__item:focus-visible { outline: 2.5px solid var(--focus); outline-offset: -5px; border-radius: 6px; }
.ui-seg--sm .ui-seg__item { height: 1.875rem; font-size: 0.8125rem; padding: 0 0.75rem; }
.ui-seg--md .ui-seg__item { height: 2.375rem; font-size: 0.875rem; }
.ui-seg__count { min-width: 1.35rem; padding: 0.15rem 0.35rem; border-radius: 999px; border: 1.5px solid currentColor;
  font-family: var(--font-mono); font-size: 0.6875rem; text-align: center; }
.ui-seg__item[aria-checked="true"] .ui-seg__count { background: var(--on-mustard); color: var(--mustard); border-color: var(--on-mustard); }
```

Devre dışı segment: `disabled:cursor-not-allowed disabled:opacity-40`.

```tsx
<Segmented label="Direction" value={dir} onChange={setDir}
  options={[{ value: "out", label: "Outgoing", count: 1 }, { value: "in", label: "Incoming", count: 2 }]} />
```

### 5.6 Panel ve Tile (`Panel.tsx`)

**Panel:** kenarlı kart (`<section>`). İsteğe bağlı başlığında hardal ikon plakası, başlık, sağ üstte ölçer ve eylemler olur. Props: `title`, `icon`, `meter`, `actions`, `tone` = `panel` (varsayılan) \| `sunken`, `raised` (varsayılan: `panel` için açık, `sunken` için kapalı), `interactive` (hover'da kalkar, basınca gömülür), `padding` = `none` \| `sm` (`p-3`) \| `md` (`p-4`, varsayılan).

```css
.ui-panel { position: relative; border: 2px solid var(--line); border-radius: var(--r-panel);
  background: var(--panel); color: var(--ink); }
.ui-panel--raised { box-shadow: var(--shadow); }
.ui-panel--sunken { background: var(--sunken); }
.ui-panel--interactive { cursor: pointer; transition: transform 140ms var(--ease-press), box-shadow 140ms var(--ease-press); }
.ui-panel--interactive:hover { transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--shadow-ink); }
.ui-panel--interactive:active { transform: translate(1px, 1px); box-shadow: var(--shadow-press); }
.ui-panel__head { display: flex; align-items: center; gap: 0.65rem; padding: 0.85rem 1rem 0; }
.ui-panel__icon { display: inline-grid; place-items: center; width: 1.875rem; height: 1.875rem; flex: none;
  border: 2px solid var(--line); border-radius: 8px; background: var(--mustard); color: var(--on-mustard); }
.ui-panel__title { font-size: 0.9375rem; font-weight: 700; letter-spacing: -0.01em; }
```

**Tile:** kompakt istatistik kartı (etiket, büyük mono değer, isteğe bağlı ölçer ve ipucu). Tarifi: `ui-panel ui-panel--raised flex min-w-0 flex-col gap-2 overflow-hidden p-3.5`. Etiket `t-label min-w-0 flex-1 truncate !text-ink-2`. Değer `font-mono text-[28px] font-semibold leading-none tracking-tight text-ink`. İpucu `text-xs text-ink-3`. `accent` verilirse `boxShadow: inset 5px 0 0 ${accent}, var(--shadow)` olur ve içerik `pl-1.5` alır.

```tsx
<Panel title="Agent budget" icon={<IconBolt size={15} />} meter={<DotMeter value={3} max={5} label="Budget used" />}>
  <p className="text-[13px] text-ink-2">3 of 5 runs used.</p>
</Panel>
<Tile label="Done" value="2" icon={<IconCheck size={14} />} accent="var(--green)" />
```

### 5.7 Tabs (`Tabs.tsx`)

**Amaç:** 2px çizgi üstünde klasör sekmeleri. Aktif sekme panel rengindedir, üstünde hardal bir şapka olur ve altındaki çizgiyi örter. Props: `items` (`value`, `label`, `icon?`, `count?`), `value`, `onChange`, `label` (tablist adı), `idBase` (`aria-controls` bağlantısı için `${idBase}-panel-${value}`), `trailing` (sağ uçta ekler). Klavye: ←/→/Home/End, roving tabindex.

```css
.ui-tabs { display: flex; align-items: flex-end; gap: 0.25rem; padding: 0 0.5rem; border-bottom: 2px solid var(--line); }
.ui-tab { position: relative; display: inline-flex; align-items: center; gap: 0.45em; height: 2.375rem;
  padding: 0 0.95rem; margin-bottom: -2px; border: 2px solid transparent; border-bottom: 0;
  border-radius: 10px 10px 0 0; font-size: 0.875rem; font-weight: 600; color: var(--ink-3); cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease; }
.ui-tab:hover { color: var(--ink); background: var(--hair); }
.ui-tab[aria-selected="true"] { color: var(--ink); background: var(--panel); border-color: var(--line);
  box-shadow: 0 2px 0 var(--panel); /* covers the rule under the active tab */ }
.ui-tab[aria-selected="true"]::before { content: ""; position: absolute; left: 10px; right: 10px; top: -2px;
  height: 4px; border-radius: 0 0 4px 4px; background: var(--mustard); }
.ui-tab:focus-visible { outline: 2.5px solid var(--focus); outline-offset: -4px; }
.ui-tab__count { font-family: var(--font-mono); font-size: 0.6875rem; padding: 0.1rem 0.35rem;
  border-radius: 999px; background: var(--sunken); color: var(--ink-2); }
/* Tabs press like keys */
.ui-tab:active { transform: translateY(1px); }
.ui-tab svg { transition: transform 160ms var(--ease-press); }
.ui-tab[aria-selected="true"] svg { transform: rotate(-8deg) scale(1.08); }
.ui-tabpanel { animation: ui-panel-in 220ms var(--ease-press) both; }
```

```tsx
<Tabs label="Task" value={tab} onChange={setTab} idBase="task"
  items={[{ value: "detail", label: "Detail" }, { value: "log", label: "Log", count: 128 }]}
  trailing={<StatusPill status="review">review</StatusPill>} />
```

### 5.8 Input, Textarea, Select, Field (`Input.tsx`)

**Input:** gömük metin alanı. Zemin sunken, iç gölgeli, 2px kenarlı. Odakta panel rengine çıkar. Props: `size` = `md` (varsayılan) \| `sm`, `icon` (baştaki glif), `invalid` (`aria-invalid`). **Textarea:** `invalid`, `mono` (`font-mono text-[13px]`). **Select:** yerel `<select>` (klavye ve mobil davranışı korunur) ve sağda mürekkep renkli `IconChevronDown size={14}`. **Field:** label, kontrol ve ipucu/hata. Render prop olarak `{ id, describedBy, invalid }` verir. Label `text-[13px] font-semibold text-ink`, `aside` `font-mono text-[11px] text-ink-3`, ipucu `text-xs text-ink-3`, hata `text-xs font-medium text-[var(--red-text)]`. Düzen `flex flex-col gap-1.5`.

```css
.ui-field-wrap { position: relative; display: flex; align-items: center; }
.ui-input { width: 100%; border: 2px solid var(--line); border-radius: var(--r-btn); background: var(--sunken);
  color: var(--ink); font-size: 0.875rem;
  box-shadow: inset 2px 2px 0 color-mix(in srgb, var(--ink) 9%, transparent);
  transition: background-color 120ms ease, box-shadow 120ms ease, border-color 120ms ease; }
.ui-input::placeholder { color: var(--ink-3); opacity: 1; }
.ui-input:hover { background: color-mix(in srgb, var(--sunken) 60%, var(--panel)); }
.ui-input:focus { outline: none; background: var(--panel);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 40%, transparent), var(--shadow); }
.ui-input[aria-invalid="true"] { border-color: var(--red); box-shadow: inset 0 0 0 1px var(--red); }
.ui-input:disabled { opacity: 0.55; cursor: not-allowed; }
.ui-input--sm { height: 2rem; padding: 0 0.7rem; font-size: 0.8125rem; border-radius: 8px; }
.ui-input--md { height: 2.5rem; padding: 0 0.85rem; }
.ui-input--has-icon { padding-left: 2.25rem; }
.ui-input--select { appearance: none; padding-right: 2.25rem; cursor: pointer; }
textarea.ui-input { height: auto; min-height: 6rem; padding: 0.65rem 0.85rem; line-height: 1.55; resize: vertical; }
.ui-field-icon { position: absolute; left: 0.75rem; color: var(--ink-3); pointer-events: none; display: inline-flex; }
.ui-field-chevron { position: absolute; right: 0.75rem; color: var(--ink); pointer-events: none; display: inline-flex; }
```

```tsx
<Field label="Branch" error="Branch name can't contain spaces">
  {({ id, describedBy, invalid }) => (
    <Input id={id} aria-describedby={describedBy} invalid={invalid} icon={<IconSearch size={14} />} />
  )}
</Field>
```

### 5.9 Checkbox ve Switch (`Toggle.tsx`)

**Checkbox:** kenarlı kare. İşaretliyken hardal plaka ve mürekkep tik olur. `label` verilirse `inline-flex items-start gap-2.5 text-[13px] text-ink` sarmalayıcıya alınır, `hint` `text-xs leading-snug text-ink-3` olarak basılır. **Switch:** `role="switch"` ve `aria-checked` taşıyan bir `<button>`. Açıkken izi yeşildir, topuz press eğrisiyle kayar. `label` zorunlu (`aria-label` ve `title`).

```css
.ui-check { appearance: none; flex: none; display: inline-grid; place-items: center; width: 1.15rem; height: 1.15rem;
  margin: 0; border: 2px solid var(--line); border-radius: 5px; background: var(--sunken); cursor: pointer;
  transition: background-color 100ms ease, transform 100ms var(--ease-press); }
.ui-check::after { content: ""; width: 0.62rem; height: 0.36rem; border-left: 2.5px solid var(--on-mustard);
  border-bottom: 2.5px solid var(--on-mustard); transform: translateY(-1px) rotate(-45deg) scale(0);
  transition: transform 140ms var(--ease-press); }
.ui-check:checked { background: var(--mustard); box-shadow: 2px 2px 0 var(--shadow-ink); }
.ui-check:checked::after { transform: translateY(-1px) rotate(-45deg) scale(1); }
.ui-check:active { transform: scale(0.92); }
.ui-check:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 3px; }
.ui-check:disabled { opacity: 0.45; cursor: not-allowed; }

.ui-switch { position: relative; flex: none; width: 2.6rem; height: 1.5rem; border: 2px solid var(--line);
  border-radius: 999px; background: var(--sunken); cursor: pointer; transition: background-color 140ms ease; }
.ui-switch::after { content: ""; position: absolute; top: 1px; left: 1px; width: 1.05rem; height: 1.05rem;
  border: 2px solid var(--line); border-radius: 999px; background: var(--panel);
  box-shadow: 1px 1px 0 var(--shadow-ink); transition: transform 180ms var(--ease-press); }
.ui-switch[aria-checked="true"] { background: var(--green); }
.ui-switch[aria-checked="true"]::after { transform: translateX(1.1rem); }
.ui-switch:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 3px; }
.ui-switch:disabled { opacity: 0.45; cursor: not-allowed; }
```

### 5.10 Kbd (`Kbd.tsx`)

Tuş başlığı: 1.5px kenar, 3px alt taban, mono glif. `<kbd className="ui-kbd">`.

```css
.ui-kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5rem; height: 1.5rem;
  padding: 0 0.4rem; border: 1.5px solid var(--line); border-bottom-width: 3px; border-radius: var(--r-sm);
  background: var(--panel); color: var(--ink); font-family: var(--font-mono); font-size: 0.6875rem;
  font-weight: 600; line-height: 1; }
```

### 5.11 Tooltip (`Tooltip.tsx`)

Mürekkep zeminli, hardal ofset gölgeli tooltip. Hover'da `delay` (varsayılan **300ms**) sonra açılır. Klavye odağında (`:focus-visible`) hemen açılır. Esc kapatır. Açıkken çocuğa `aria-describedby` bağlanır. Props: `content`, `shortcut` (sonda `Kbd`), `side` = `top` (varsayılan) \| `bottom` \| `left` \| `right`, `children` (tek bir odaklanabilir öğe).

```css
.ui-tooltip { position: absolute; z-index: 60; pointer-events: none; display: inline-flex; align-items: center;
  gap: 0.5rem; width: max-content; max-width: 18rem; padding: 0.4rem 0.6rem; border-radius: 8px;
  background: var(--ink); color: var(--on-ink); font-size: 0.75rem; font-weight: 500; line-height: 1.35;
  box-shadow: 3px 3px 0 var(--mustard); animation: ui-pop 120ms var(--ease-press) both; }
.ui-tooltip .ui-kbd { background: transparent; color: var(--on-ink);
  border-color: color-mix(in srgb, var(--on-ink) 60%, transparent); height: 1.25rem; min-width: 1.25rem; }
.ui-tooltip--top { bottom: calc(100% + 10px); left: 50%; translate: -50% 0; }
.ui-tooltip--bottom { top: calc(100% + 10px); left: 50%; translate: -50% 0; }
.ui-tooltip--left { right: calc(100% + 10px); top: 50%; translate: 0 -50%; }
.ui-tooltip--right { left: calc(100% + 10px); top: 50%; translate: 0 -50%; }
```

```tsx
<Tooltip content="New task" shortcut="N"><IconButton label="New task" variant="primary"><IconPlus /></IconButton></Tooltip>
```

### 5.12 Modal (`Modal.tsx`)

Props: `open`, `onClose`, `title`, `size` = `md` (`max-w-xl`, varsayılan) \| `lg` (`max-w-2xl`) \| `xl` (`max-w-4xl`), `icon`, `description`, `footer`, `footerStart`. `document.body`'ye portallanır: transform taşıyan bir drawer ya da sekme paneli içinden açılınca o kutuya hapsolmasın diye.

Anatomi:
- Kap: `fixed inset-0 z-50 flex items-center justify-center p-4`, içinde `.ui-scrim` (tıklayınca kapanır).
- Panel: `role="dialog" aria-modal="true"`, `ui-modal relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-panel border-2 border-line bg-panel outline-none`.
- Başlık: `flex items-center gap-3 border-b-2 border-line px-5 py-3.5`. İkon plakası `h-9 w-9 rounded-[10px] border-2 border-line bg-mustard text-[var(--on-mustard)]`, gölgesi `2px 2px 0 var(--shadow-ink)`. Başlık `t-display text-xl leading-tight`. Açıklama `mt-0.5 text-[13px] leading-snug text-ink-3`. Kapat `IconButton size="sm"`.
- Gövde: `min-h-0 flex-1 overflow-auto p-5`.
- Alt şerit: `flex items-center gap-2.5 border-t-2 border-line bg-sunken px-5 py-3`, `footerStart` `text-[12px] text-ink-3`.

```css
.ui-scrim { position: fixed; inset: 0; background: var(--scrim); animation: ui-fade 160ms ease both; }
.ui-scrim[data-state="closing"] { animation: ui-fade-out 160ms ease both; }
.ui-modal { animation: ui-pop 180ms var(--ease-press) both; box-shadow: var(--shadow-lg); }
.ui-modal[data-state="closing"] { animation: ui-pop-out 140ms ease-in both; }
```

Çıkış için `usePresence(open, 140)` kullanılır. Odak `useFocusTrap` ile hapsedilir, Esc `useEscapeLayer` ile yönetilir (bkz. §5.19).

### 5.13 Drawer (`Drawer.tsx`)

Sağdan açılan sayfa. Board arkada görünür kalır. Props: `open`, `onClose`, `title`, `eyebrow`, `headerActions`, `tabs`, `aside` (sağ bölünmüş sütun), `footer`, `width` = `md` \| `lg` (varsayılan) \| `xl` \| `full`, `ariaLabel`, `meta`, `bodyClassName`, `bodyKey` (değişince gövde giriş animasyonunu yeniden oynatır).

| `width` | Sınıflar |
|---|---|
| `md` | `w-[min(560px,100vw)] md:w-[40vw] md:min-w-[480px]` |
| `lg` | `w-[min(720px,100vw)] md:w-[55vw] md:min-w-[620px]` |
| `xl` | `w-full md:w-[72vw] md:min-w-[760px]` |
| `full` | `w-full md:w-[94vw] md:min-w-[760px]` |

Anatomi:
- Kap: `fixed inset-0 z-40` ve `.ui-scrim`. Modal'ın aksine portallanmaz.
- Panel: `ui-drawer absolute inset-y-0 right-0 flex max-w-full flex-col border-l-2 border-line bg-paper outline-none transition-[width] duration-300 ease-out`.
- Başlık: `flex items-start gap-3 border-b-2 border-line bg-panel px-5 pb-4 pt-4`. Eyebrow `mb-1.5 flex items-center gap-2 font-mono text-xs text-ink-3`. Başlık `t-display text-[22px] leading-tight`. Meta `mt-3 flex flex-wrap items-center gap-2`.
- Sekmeler: `bg-panel pt-2`.
- Gövde: `min-w-0 flex-1 overflow-y-auto px-5 py-5` (`bodyKey` verilmişse ayrıca `ui-tabpanel`).
- Aside: `hidden w-[280px] shrink-0 overflow-y-auto border-l-2 border-line bg-panel px-4 py-5 lg:block`.
- Alt şerit: `flex items-center justify-end gap-2 border-t-2 border-line bg-panel px-5 py-3`.

```css
.ui-drawer { animation: ui-drawer-in 240ms var(--ease-press) both; box-shadow: -4px 0 0 var(--shadow-ink); }
.ui-drawer[data-state="closing"] { animation: ui-drawer-out 180ms ease-in both; }
```

Çıkış süresi `usePresence(open, 180)`.

### 5.14 ConfirmDialog (`ConfirmDialog.tsx`)

`role="alertdialog"`. Portallanır, kabı `z-[9999]`. Props: `open`, `title`, `description`, `confirmLabel` (varsayılan `"Confirm"`), `cancelLabel` (varsayılan `"Cancel"`), `variant` = `danger` \| `warning` \| `default` (varsayılan), `onConfirm`, `onCancel`.
- Panel: `ui-modal relative w-full max-w-md rounded-panel border-2 border-line bg-panel`.
- Rozet: `h-10 w-10 rounded-[10px] border-2 border-line`. Dolgusu `danger` → red/on-red, `warning` → orange/on-orange, `default` → cobalt/on-cobalt. Gölgesi `2px 2px 0 var(--shadow-ink)`. İkon `default` için `IconInfo size={18}`, diğerleri için `IconAlert size={18}`.
- Başlık `t-display text-[22px] leading-tight`, açıklama `mt-2 text-sm leading-relaxed text-ink-2`.
- Alt şerit: `flex justify-end gap-2.5 border-t-2 border-line bg-sunken px-5 py-3.5`, `borderRadius: "0 0 12px 12px"`. İptal `secondary`. Onay `danger` varyantında `danger`, diğerlerinde `primary`.
- Odak bir butonda değilken Enter onaylar. Odak butondaysa Enter butonun kendisine kalır (çift onay olmasın diye). Esc iptal eder.

### 5.15 Toast (`Toast.tsx`)

`ToastContainer` sağ altta durur: `fixed bottom-5 right-5 z-[9999] flex flex-col gap-3`, `role="region" aria-live="polite"`. Her toast `role="alert"` (error) ya da `role="status"` alır.
- Kart: `ui-modal relative flex min-w-[280px] max-w-[420px] items-center gap-3 overflow-hidden rounded-[12px] border-2 border-line bg-panel py-2.5 pl-2.5 pr-2`. Inline `boxShadow: "var(--shadow)"`, `ui-modal`'ın `--shadow-lg` değerini ezer.
- İkon plakası: `h-8 w-8 rounded-[8px] border-2 border-line`, dolgu türe göre (success `IconCheck`, error `IconAlert`, info `IconInfo`, `size={15}`).
- Etiket: `font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3`. Mesaj: `text-[13px] font-medium leading-snug text-ink`.
- Kapat: `ui-focus grid h-7 w-7 place-items-center rounded-[8px] text-ink-3 hover:bg-hair hover:text-ink`.
- Boşalan şerit: store varsayılan 3 saniyede otomatik kapatır, şerit de aynı sürede boşalır. Süre çağrı başına verilebilir (`toast.error(msg, 10000)`, ör. birleştirme çakışması); `Toast` bunu `--toast-ms` değişkeniyle şeride geçirir.

```css
.ui-toast__bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--toast, var(--ink));
  transform-origin: left center; animation: toast-drain var(--toast-ms, 3000ms) linear both; }
```

Kullanım: `const toast = useToast(); toast.success("PR #42 opened"); toast.error(msg, ms?); toast.info(...)`.

### 5.16 Menü, banner, seçenek kartı ve diğer yardımcı sınıflar

Bunların React bileşeni yok, doğrudan sınıf olarak kullanılırlar.

```css
/* Popover menu (project switcher, filter menus) */
.ui-menu { position: absolute; z-index: 55; border: 2px solid var(--line); border-radius: 12px; background: var(--panel);
  color: var(--ink); box-shadow: var(--shadow-lg); animation: ui-pop 140ms var(--ease-press) both; }
.ui-menu__item { display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 2.25rem;
  padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.8125rem; text-align: left; cursor: pointer;
  transition: background-color 100ms ease; }
.ui-menu__item:hover, .ui-menu__item:focus-visible { background: color-mix(in srgb, var(--mustard) 26%, var(--panel));
  outline: none; box-shadow: inset 0 0 0 2px var(--focus); }
.ui-menu__item[aria-checked="true"], .ui-menu__item[aria-current="true"] { background: var(--sunken); }

/* Banner (inline error / warning) */
.ui-banner { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.6rem 0.75rem; border: 2px solid var(--line);
  border-radius: var(--r-btn); font-size: 0.8125rem; line-height: 1.45; }
.ui-banner--error { background: color-mix(in srgb, var(--red) 12%, var(--panel)); color: var(--red-text); box-shadow: inset 4px 0 0 var(--red); }
.ui-banner--warn { background: color-mix(in srgb, var(--orange) 12%, var(--panel)); color: var(--orange-text); box-shadow: inset 4px 0 0 var(--orange); }
.ui-banner--info { background: color-mix(in srgb, var(--cobalt) 10%, var(--panel)); color: var(--ink); box-shadow: inset 4px 0 0 var(--cobalt); }

/* Selectable option card */
.ui-option { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.6rem 0.8rem;
  border: 2px solid var(--line); border-radius: var(--r-btn); background: var(--panel); text-align: left; cursor: pointer;
  transition: background-color 120ms ease, box-shadow 110ms var(--ease-press), transform 110ms var(--ease-press); }
.ui-option:hover { background: color-mix(in srgb, var(--mustard) 12%, var(--panel)); }
.ui-option[data-checked="true"], .ui-option[aria-checked="true"], .ui-option:has(> input:checked) {
  background: color-mix(in srgb, var(--mustard) 20%, var(--panel)); box-shadow: 3px 3px 0 var(--shadow-ink);
  transform: translate(-1px, -1px); }
.ui-option:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 3px; }

/* Hatched slot (empty states, offline dot) */
.ui-hatch { background-image: repeating-linear-gradient(135deg, var(--hair) 0 2px, transparent 2px 9px); }

/* Drawer header key plate */
.ui-keyplate { display: inline-flex; align-items: center; height: 1.375rem; padding: 0 0.5rem;
  border: 1.5px solid var(--line); border-radius: 6px; background: var(--ink); color: var(--on-ink);
  font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.04em;
  box-shadow: 2px 2px 0 var(--mustard); }

/* Section heading inside panels: "§01 Açıklama ─────" */
.ui-sechead { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.65rem; }
.ui-sechead__n { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; color: var(--ink-3); }
.ui-sechead__t { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.01em; color: var(--ink); }
.ui-sechead::after { content: ""; flex: 1; height: 2px; border-radius: 2px; background: var(--hair); }
```

Ekranlara özel diğer sınıflar da `globals.css` içinde tanımlı. Aynı dili izlerler (2px çizgi, sert gölge, mono sayılar), gerekirse oradan kopyalayın:

| Sınıf ailesi | Ne için |
|---|---|
| `.ui-linkrow`, `.ui-meta`, `.ui-row` | Bağlı görev satırı, yan sütun meta grupları, statik satır kartı |
| `.task-table` | Jira tarzı liste görünümü: yapışkan `sunken` başlık, `height: 3rem` satırlar, hover'da hardal %14, çalışan satırda `inset 5px 0 0 var(--orange)` |
| `.tl`, `.tl__*` | Araç çağrısı zaman çizelgesi: saat oluğu, kesik ray, renkli düğüm, açılır kart, konuşma balonu |
| `.logpane`, `.logpane__*` | Mono log paneli: satır no oluğu ve tonlar (`error`/`ok`/`cmd`/`warn` → `--*-text`), canlıyken yanıp sönen `▍` imleç |
| `.cmt` | Yorum balonu (`14px 14px 14px 4px` köşe) |
| `.team-bubble`, `.team-chip` | Ekip zaman çizelgesi balonu (`4px 14px 14px 14px` köşe, solda `--role` renk şeridi; `data-tone` = `stuck` kırmızı taralı, `live` kesik çizgili, `summary` sunken) ve mono meta çipi |
| `.ui-banner--approval` | Şartname onay kapısı: hardal zeminli banner ("sıra sende") |
| Ekip editörü (`components/Team/TeamEditor.tsx`) | Yeni sınıf yok: ekip kartları `.ui-option` (seçili `data-checked`), rol satırları solda `inset 4px 0 0` rol rengi şeridi (seçiliyken `+ 3px 3px 0` gölge), salt okunur rol `dl` satırları `1.5px` `--hair` ayraçlı, proje ayarları `Segmented` + `Switch`. |
| `.diff-*` | Split diff: PR çekmecesi ve görev çekmecesinin "Değişiklikler" sekmesi aynı parçaları kullanır (`components/Github/DiffView.tsx`). Silinen/eklenen satırın numara hücresi kırmızı/yeşil tonlu zeminde `--ink-2` metin (bkz. §2.5); renk tondan ve `-`/`+` işaretinden (`--red-text`/`--green-text`) gelir. Proje çekmecesinin stash panelinde (`.stash-diff` sarmalayıcı) uzun satırlar hücre içinde kaymak yerine kırılır (dar çekmece, axe `scrollable-region-focusable`); `FileBlock` orada `hideViewed` ile "görüldü" kutusu olmadan basılır |
| `.kpi-tile` | Üstünde 6px renk şeridi (`--kpi`) olan KPI kartı |
| `.factory-*` | 3D fabrika sahnesinin DOM katmanı (nokta ızgaralı sahne, lejant, tooltip) |
| `.prose-claude`, `.comment-markdown` | Markdown önizleme. `ReactMarkdown` her yerde `remark-gfm` ile çalışır: tablolar `1px solid var(--border)` hücreli, `.comment-markdown` tablosu taşınca yatay kayar. |

### 5.17 Ölçerler: DotMeter ve RingGauge (`Meters.tsx`)

**DotMeter** (`●●●○○`): `role="meter"`, `aria-valuemin/max/now`. Props: `value`, `max` = 5, `color` = `var(--mustard)`, `size` = `sm` (8px) \| `md` (11px, varsayılan) \| `lg` (14px), `label`. Kesirli değer en yakın tama yuvarlanır. Noktalar arası boşluk `Math.max(3, px * 0.4)`. Kenar `sm` için `1.5px`, diğerleri için `2px` `var(--line)`. Yanan nokta `color` alır. Sönük nokta `var(--sunken)` ve `inset 1px 1px 0 color-mix(in srgb, var(--ink) 12%, transparent)` alır.

**RingGauge:** basılı görünümlü dairesel ilerleme. Props: `value`, `max` = 100, `size` = 88 (px çap), `thickness` = 10, `color` = `var(--mustard)`, `children` (merkez, varsayılan yüzde), `label`, `sublabel`, `ariaLabel`. SVG geometrisi:
- `stroke = 2`, `c = size/2`, `outer = c - stroke/2 - 3` (gölge ofsetine yer), `mid = outer - stroke/2 - thickness/2`, `inner = outer - stroke/2 - thickness`.
- Sert gölge diski: `(c+3, c+3)` merkezli, `r=outer`, `fill="var(--shadow-ink)"`.
- İz: `fill="var(--sunken)" stroke="var(--line)" strokeWidth={2}`.
- Yay: `stroke={color} strokeWidth={thickness}`, `rotate(-90)`. Geçiş `stroke-dashoffset 600ms cubic-bezier(.3,.7,.4,1)`.
- Yay ucunda bir mürekkep çentiği (yalnızca 0 < pct < 1 iken), iç yüz `fill="var(--panel)"` ve mürekkep kenar.
- Merkez yazı: `font-mono font-semibold`, `fontSize: Math.max(11, size * 0.2)`, `paddingRight: 3, paddingBottom: 3`.
- Altyazı: label `text-[13px] font-semibold`, sublabel `font-mono text-[11px] text-ink-3`.

```tsx
<RingGauge value={72} color="var(--orange)" label="Budget" sublabel="$7.20 / $10" ariaLabel="Budget" />
```

### 5.18 Avatar (`Avatar.tsx`)

Props: `name`, `kind` = `user` (daire ve baş harfler, varsayılan) \| `agent` (yuvarlak kare ve robot glifi), `src`, `size` = `xs` 20 \| `sm` 28 \| `md` 36 (varsayılan) \| `lg` 48 px, `state` = `idle` \| `online` (green) \| `running` (orange, canlı) \| `error` (red).
- Köşe: ajan `Math.round(px * 0.28)`, kullanıcı `999`. Kenar: `xs` için `1.5`, diğerleri için `2` (`border-line`). Font `Math.round(px * 0.38)`, `font-bold`.
- Dolgu: ajan her zaman hardal. Kullanıcı rengi adın hash'iyle §2.4'teki beş çiftten seçilir.
- Durum noktası: `ui-dot`, `right: -3, bottom: -3`, boyutu `Math.max(8, px * 0.3)`, `boxShadow: "0 0 0 2px var(--panel)"`.
- `role="img"`, `aria-label` = ad (idle değilse `"ad · durum"`).

### 5.19 Overlay yardımcıları (`overlay.ts`)

| Hook | Ne yapar |
|---|---|
| `usePresence(open, exitMs = 180)` | `open` false olduktan sonra çıkış animasyonu için `exitMs` boyunca mount'u tutar. `{ mounted, state: "open" \| "closing" }` döner, `state` `data-state` özniteliğine yazılır. |
| `useFocusTrap(ref, active)` | Açılınca odağı içeri taşır (`[data-autofocus]` varsa ona, yoksa panele). Tab'ı içeride tutar. Kapanınca önceki odaklı öğeye geri döner. |
| `useDismiss(ref, open, onClose)` | Popover için: dışarıda `pointerdown` ya da Esc (capture, `stopPropagation`) kapatır. |
| `useEscapeLayer(active, onEscape)` | Katman yığını. Esc yalnızca en üstteki katmanı kapatır (drawer → modal → confirm). Tek bir capture dinleyicisi olayı durdurur. Hiç katman yoksa Esc board kısayoluna geçer. |

### 5.20 İkonlar (`icons.tsx`)

Elle ayarlanmış küçük stroke ikon seti: *"16px grid, 2px stroke, round caps — matches the 2px ink rules."*

```tsx
<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
  strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" />
```

Varsayılan `size` 16. Mevcut ikonlar: `IconPlus`, `IconClose`, `IconCheck`, `IconChevronDown/Right/Left/Up`, `IconSearch`, `IconBolt`, `IconPlay`, `IconStop`, `IconRetry`, `IconTrash`, `IconGear`, `IconBranch`, `IconPR`, `IconEye`, `IconSun`, `IconMoon`, `IconAlert`, `IconInfo`, `IconCoin`, `IconClock`, `IconBoard`, `IconList`, `IconFactory`, `IconChart`, `IconBell`, `IconRobot`, `IconSpinner`, `IconRail`, `IconFolder`, `IconSubtask`, `IconTag`, `IconFilter`, `IconDownload`, `IconArrowUpRight`, `IconSort`, `IconChain` (iki halka; bağımlılık zinciri), `IconMerge` (base'in görev dalına alınması; çekmecenin Çakışma bölümü), `IconLock`, `IconGithub`, `IconTerminal`, `IconChat`, `IconCopy`, `IconFile`, `IconPencil`. Ekip rolleri: `IconBriefcase` (CEO), `IconClipboard` (Analist), `IconCode` (Yazılımcı), `IconShieldCheck` (QA), `IconTeam` (ekip). Ekip editörü: `IconStar` (varsayılan yap), `IconUpload` (şablon olarak kaydet).

`IconSpinner`: `r=6` daire, `strokeOpacity 0.25`, `strokeWidth 2.5`, üstünde `M8 2a6 6 0 0 1 6 6` yayı. `ui-spin` sınıfıyla döner (`0.8s linear infinite`).

Tipik ikon boyutları: buton içinde 14–16, rail öğesinde 17, kart meta ve çiplerde 12–13, kapat düğmesinde 12–14.

### 5.21 Board sütunu (`Board/BoardColumn.tsx`)

**Sütun sırası** (`COLUMN_STATUSES`): `todo`, `doing`, `review`, `done`. Sütun adları dile göre tek set: TR "Yapılacak · Yapılıyor · İncelemede · Bitti", EN "To do · Doing · Review · Done" (`board.columns`). Hepsi açık başlar; daraltılanlar `localStorage["board-collapsed-cols"]` içinde saklanır (bilinmeyen eski değerler süzülür).

```
┌─ .lane ──────────────────────────────── 2px line, r-panel, --lane rengi ─┐
│▀▀▀▀▀▀▀▀▀▀▀▀ inset 0 5px 0 var(--lane)  (+ .lane__scan, ajan çalışırken) │
│ ● Başlık  [3]                       [onay etiketi] [+] [‹]  .lane__head │
│ ┌ TaskCard ┐                                                            │
│ ┌ TaskCard ┐   gap-3, px-2.5 pb-3 pt-1, overflow-y-auto                │
│ + Görev ekle   (yalnızca todo; h-9, ghost görünümlü)                   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Açık sütun: `lane min-w-[272px] max-w-[380px] flex-1 basis-0`, inline `--lane` = durumun `fill` rengi.
- Başlık: `ui-dot` (durum rengi, `doing` sütununda çalışan ajan varsa `ui-dot--live`), `h2` `text-[14px] font-bold tracking-[-0.01em]`, `.lane__count`, ghost `IconButton sm` ile "+" ve daraltma (`aria-expanded`).
- Daraltılmış sütun: `lane lane--strip` (`width: 3rem`). İçinde dikey başlık (`writingMode: "vertical-rl"`, `rotate(180deg)`, `text-[13px] font-bold tracking-[0.02em]`), sayaç ve `IconChevronRight`. Tıklayınca açılır.
- Boş durum: `ui-hatch` + `rounded-[12px] border-2 border-dashed` (kenar `color-mix(in srgb, var(--line) 35%, transparent)`), başlık `text-[14px] font-bold text-ink-2`, ipucu `text-[12px] text-ink-3`. İlk yükleme iskeleti `h-[96px]`, aynı tarama ve `animate-pulse`.
- Sürükleme: izinli hedef sütun kesik kenarlı olur (`data-target="allowed"`). Üstüne gelince hardal zemin ve hardal halka alır (`data-over="allowed"`). Onay gerektiren sütun turuncu taralı olur (`data-over="confirm"`) ve `font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--orange-text)]` etiketi çıkar.

```css
.lane { --lane: var(--ink-3); position: relative; display: flex; flex-direction: column; min-height: 0;
  border: 2px solid var(--line); border-radius: var(--r-panel);
  background: color-mix(in srgb, var(--sunken) 85%, var(--paper));
  transition: background-color 140ms ease, box-shadow 140ms ease; }
.lane__head { display: flex; align-items: center; gap: 0.5rem; padding: 0.85rem 0.6rem 0.65rem 0.85rem;
  border-radius: 12px 12px 0 0; box-shadow: inset 0 5px 0 var(--lane); }
.lane__count { min-width: 1.6rem; height: 1.35rem; padding: 0 0.4rem; border: 1.5px solid var(--line);
  border-radius: 999px; background: var(--panel); font-family: var(--font-mono); font-size: 0.6875rem;
  font-weight: 700; line-height: calc(1.35rem - 3px); text-align: center; color: var(--ink); }
.lane[data-over="allowed"] { background: color-mix(in srgb, var(--mustard) 22%, var(--paper));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mustard) 70%, transparent); }
.lane[data-over="confirm"] { background-color: color-mix(in srgb, var(--orange) 10%, var(--paper));
  background-image: repeating-linear-gradient(135deg, color-mix(in srgb, var(--orange) 18%, transparent) 0 6px, transparent 6px 14px); }
.lane[data-target="allowed"]:not([data-over]) { border-style: dashed; }
.lane--strip { width: 3rem; flex: none; cursor: pointer; box-shadow: inset 0 5px 0 var(--lane); }
.lane--strip:hover { background: color-mix(in srgb, var(--sunken) 30%, var(--panel)); }
.lane__scan { position: absolute; left: 10px; right: 10px; top: 0; height: 5px; overflow: hidden; border-radius: 0 0 3px 3px; }
.lane__scan::after { content: ""; position: absolute; inset: 0; width: 40%; background: var(--panel); opacity: 0.7;
  animation: scan-line 1.6s ease-in-out infinite; }
```

### 5.22 Görev kartı (`Card/TaskCard.tsx`)

`TaskCard` sürüklenebilir sarmalayıcı (dnd-kit `useSortable`, işaretçi listener'ları tüm kartta). `TaskCardView` sunum katmanı: sürüklenen kart, drag overlay ve styleguide aynı görünümü paylaşır.

**Yapı: "gerilmiş açma düğmesi"** (erişilebilirlik, `nested-interactive` yok). Kart kökü etkileşimsiz bir `div`'dir: `role`, `tabIndex`, `aria-label`, `onKeyDown` yok; dnd-kit `attributes` yayılmaz (kökü `role="button"` yapıyordu; `KeyboardSensor` yok, sürükleme yalnızca işaretçiyle). Kartı açan, başlığın içindeki `<button class="task-card__open">`dur: erişilebilir adı `CLF-87 Başlık`, kilitliyken `title` = "Ajan çalışırken taşınamaz", Enter/Space doğal olarak açar. `::after`'ı tüm kartı kaplar, yani karta fareyle tıklamak bu düğmeye tıklamaktır. Eylem düğmeleri, bağlantılar ve `title` ipuçlu meta öğeler bu düğmenin **kardeşidir** ve `position: relative; z-index: 1` ile üstünde durur: ipuçları hover'da çalışır, meta haplarına tık köke kabarcıklanıp kartı açar. Odak halkası tüm kartta (`.task-card:has(.task-card__open:focus-visible)`). Tab sırası: başlık düğmesi → kartın iç düğmeleri → sonraki kart. Drag overlay ve `onOpen`'sız görünüm (styleguide) düz başlık basar (çift odak noktası olmasın).

```
┌─ .task-card (div, etkileşimsiz) ──────────── 12px köşe, 2px line, --shadow ─┐
▌ .task-card__prio (4px öncelik şeridi)  ya da  .task-card__edge (çalışırken) │
│ CLF-87  ⤷CLF-80                                              ▲▲▲          │  anahtar · üst görev · PriorityMark (data-card-action)
│ <h3><button.task-card__open> Başlık (15px semibold, 2 satır)               │  ::after → tüm kart
│ Açıklama (13px ink-3, 2 satır)                                             │
│ Açıklama (13px ink-3, 2 satır)                                             │
│ (●backend) (●api) +2                                                       │  en fazla 3 etiket
│ [◉ running ▪▪▪▫]                    (yalnızca ajan çalışırken, tam satır)  │
│ ─────────────────────────── 1.5px hair ──────────────────────────────────  │
│ [⤷ 0/2] [¤ $0.42] [⑂ Yerel dal]               [queued ×] [#42] [#42 merged↗]│  alt bilgi
└────────────────────────────────────────────────────────────────────────────┘
```

- İç dolgu `py-3 pr-3`. Sol dolgu `pl-4`, ajan çalışırken `pl-[1.35rem]` (yürüyen kenara yer).
- Anahtar: `.task-card__key`. Üst görev: `font-mono text-[11px] text-ink-3` ve `IconSubtask size={12}`.
- Etiket: `inline-flex h-5 items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-paper px-2 text-[11px] font-medium text-ink-2`, nokta `h-1.5 w-1.5 rounded-full` (`tagDot`). Fazlası `+n` olarak `font-mono text-[11px] text-ink-3`.
- Alt bilgi: `mt-3 flex flex-wrap items-center gap-1.5 border-t-[1.5px] border-hair pt-2.5`. Alt görev sayacı, maliyet (görevin gerçek ömür boyu harcaması `task.costUsd`, `formatUsd`) ve Review'daki PR'sız dallı görev için "Yerel dal" (`IconBranch`, `title` dal adı) `.task-card__meta` olarak basılır (bütçe aşıldıysa maliyet zemini `var(--red)`, metni `var(--on-red)`). Açık PR butonu kobalt dolgulu, merged PR butonu yeşil dolgulu `.task-card__btn`. Kuyrukta bekleyen için `StatusPill status="todo"` ve kare iptal butonu (`!w-6`, hover'da kırmızı).
- **Zincir rozeti** (`Card/ChainBadge.tsx`): alt bilginin ilk öğesi, `.task-card__meta` + `IconChain size={12}`. Yalnızca `todo` ya da bağımlılık bekleyen (`waiting_deps`) kartta, karşılanmamış bağımlılık varsa çıkar. Metin "CLF-2'yi bekliyor" / "2 görev bekliyor"; engelleyicilerden biri sorunluysa (`review`/`todo` + `error`) "CLF-2 sorunlu" ve zemin `var(--red)`, metin `var(--on-red)` (`data-chain="problem"`, aksi `"waiting"`). Etkileşimsiz `span`; tam liste `title`'da (`CLF-2 · İncelemede` ya da `CLF-2 · <errorText>`). Liste görünümü (`TaskList`) `compact` sürümü kullanır: yalnızca sayı ya da `CLF-2 !`, metin `sr-only`. Bekleyen kartta kuyruk hapının yerinde `StatusPill status="todo"` "Bağımlılık bekliyor" (hepsi bitmişse "Başlatılmayı bekliyor") ve aynı kare iptal butonu; kart sürüklenemez ama kilit/kenar animasyonu almaz. Board'da hazır bekleyenler için `ui-banner--info` şeridi (`IconChain` + "Başlat"), çekmecede "Bekliyor" / "Bunu bekleyenler" bölümleri (bağımlı satırlarında `IconChain size={13}` `text-ink-3`).
- **Çakışma durumları:** çözücü koşarken (`agent.status: "resolving_conflict"`) kart çalışan kart görünümünü alır (`data-running`, kenar animasyonu, kilit) ve tam satırda canlı `AgentBadge` "Çakışma çözülüyor" (executor'ın dört çentiği olmadan). Çözülmüş görevde (`currentStep === "conflict_resolved"`) alt bilgide `StatusPill status="review"` "Çakışma çözüldü — tekrar onayla" (`data-conflict-resolved`); başarısızlıkta mevcut hata hapı (`title` = `errorText`, `conflict_unresolved:<neden>`). Çekmecenin Detay sekmesinde yalnızca gerektiğinde "Çakışma" bölümü (`data-conflict-section`): çözülürken canlı dolu `StatusPill status="doing"` aşama metni + tehlike "Durdur"; başarısızlıkta `ui-banner--error` + birincil "AI ile çöz" (`IconRobot`); çözülmüşken aynı `review` hapı (`IconCheck`) ve not; ana dal ilerlemişse `ui-banner--info` + `IconMerge size={15}` "Ana dal (main) dallanmadan bu yana N commit ilerledi" ve ikincil "Dalı güncelle" (`IconMerge size={14}`, `ConfirmDialog` ile). Emoji kullanılmaz.
- İç butonlar (iptal, `AgentBadge`, PR, GitHub bağlantısı) başlık düğmesinin kardeşidir, asla içinde değil. `pointerdown` ve `click` olaylarında `stopPropagation` yapar, böylece sürükleme ve kart açma tetiklenmez. Kendi sınıfı olmayan sarmalayıcılar (`AgentBadge` kabı, iptal kapları, "Çakışma çözüldü" hapı, üst görev anahtarı, öncelik işareti) `data-card-action` alır; `.task-card__btn` ve `.task-card__meta` zaten yükseltilmiştir. Yeni bir etkileşimli ya da `title`'lı öğe eklerken aynısını yap, yoksa `::after` onu örter.
- Erişilebilirlik: axe `nested-interactive` 0 (bakım F4, iki tema; board, liste, çekmeceler, 390, EN).
- Durum öznitelikleri: `data-running`, `data-locked` (ajan çalışırken sürükleme kapalı), `data-dragging`, `data-burst`.
- Yeni gelen kart `opacity: 0; translate: 0 -8px` durumundan `500ms ease-out` ile girer.

```css
.task-card { position: relative; border: 2px solid var(--line); border-radius: 12px; background: var(--panel);
  color: var(--ink); box-shadow: var(--shadow); cursor: grab; touch-action: manipulation;
  transition: transform 170ms var(--ease-press), box-shadow 170ms var(--ease-press), opacity 160ms ease; }
.task-card:hover { transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--shadow-ink); }
/* gerilmiş açma düğmesi: kök etkileşimsiz, halka tüm kartta */
.task-card__open { all: unset; cursor: inherit; }
.task-card__open::after { content: ""; position: absolute; inset: 0; border-radius: 10px; }
.task-card__open:focus-visible { outline: none; }
.task-card:has(.task-card__open:focus-visible) { outline: 2.5px solid var(--focus); outline-offset: 3px; }
.task-card .task-card__btn, .task-card .task-card__meta, .task-card [data-card-action] { position: relative; z-index: 1; }
.task-card[data-locked="true"] { cursor: default; }
.task-card[data-dragging="true"] { transform: none; box-shadow: none; border-style: dashed; background: transparent;
  background-image: repeating-linear-gradient(135deg, var(--hair) 0 2px, transparent 2px 9px); }
.task-card[data-dragging="true"] > * { visibility: hidden; }
.task-card--overlay, .task-card--overlay:hover { cursor: grabbing; transform: rotate(2.5deg) scale(1.02);
  box-shadow: 8px 10px 0 var(--shadow-ink); animation: card-pickup 160ms var(--ease-press) both; }
.task-card__prio { position: absolute; left: 0; top: 10px; bottom: 10px; width: 4px; border-radius: 0 3px 3px 0; background: var(--prio); }
.task-card__edge { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; border-right: 2px solid var(--line);
  border-radius: 10px 0 0 10px;
  background: repeating-linear-gradient(-45deg, var(--orange) 0 4px, color-mix(in srgb, var(--orange) 62%, var(--panel)) 4px 8px);
  background-size: 11.3px 11.3px; animation: edge-march 700ms linear infinite; }
.task-card[data-running="true"] { background: color-mix(in srgb, var(--orange) 7%, var(--panel)); }
.task-card__key { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.02em; color: var(--ink-2); }
.task-card__meta { display: inline-flex; align-items: center; gap: 0.3rem; height: 1.375rem; padding: 0 0.45rem;
  border-radius: 6px; background: var(--sunken); font-family: var(--font-mono); font-size: 0.6875rem;
  font-weight: 600; color: var(--ink-2); white-space: nowrap; }
.task-card__btn { display: inline-flex; align-items: center; gap: 0.3rem; height: 1.5rem; padding: 0 0.5rem;
  border: 1.5px solid var(--line); border-radius: 999px; background: var(--panel); font-size: 0.75rem;
  font-weight: 600; color: var(--ink); white-space: nowrap; cursor: pointer;
  transition: transform 90ms var(--ease-press), box-shadow 90ms var(--ease-press), background-color 120ms ease; }
.task-card__btn:hover { box-shadow: 2px 2px 0 var(--shadow-ink); transform: translate(-1px, -1px); }
.task-card__btn:active { box-shadow: none; transform: translate(1px, 1px); }
.task-card__btn:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 2px; }
.task-card__btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

### 5.23 Board istatistik paneli (`Board/BoardStats.tsx`)

Kap: `ui-panel ui-panel--raised flex items-center gap-4 py-2 pl-2.5 pr-5`. İçinde `RingGauge` (`size={60} thickness={8} color="var(--green)"`, merkezde `text-[13px]` yüzde) ve dört `<dl>` öğesi: Toplam, Bitti (`--green-text`), Çalışan (çalışan varsa `--orange-text` ve canlı turuncu nokta) ve Maliyet. Başlıklar `t-label !text-[10px] !tracking-[0.12em] !text-ink-3`, değerler `font-mono text-[20px] font-bold leading-none tabular-nums`.

### 5.24 Yerel değişiklikler (`Card/LocalChangesTab.tsx`)

Görev çekmecesinin "Değişiklikler" sekmesi. Görevin dalı varsa ve PR'ı yoksa (`review` ya da `done`) görünür; remote'suz repolarda incelemenin yeridir. Veri `GET /api/tasks/:id/diff` (`<base>...<dal>`).

- Üst satır `flex flex-wrap items-center gap-x-3 gap-y-2`: dal → base kodu (`rounded-[8px] border-2 border-line bg-sunken px-2 py-1 font-mono text-[11.5px]`, `IconBranch size={13}`), dosya sayısı ve `+n` (`--green-text`) / `−n` (`--red-text`) mono sayaçlar, `ChangeBar`.
- Review'da `ui-banner ui-banner--info` ("Bitti'ye taşıyınca ana dala birleştirilir"); diff kırpıldıysa `ui-banner ui-banner--warn`.
- `--stat` özeti `t-label` başlıklı mono blokta, altında dosya başına `.diff-*` blokları (görüldü işareti, daraltma) PR çekmecesiyle aynı.
- Yüklenirken `ui-hatch` + kesik kenarlı iskelet satırları, hata `ui-banner--error`.

### 5.25 Yeni proje modalı (`Modals/NewProjectModal.tsx`)

Üstte `Segmented` ("Yeni proje" `IconPlus` \| "GitHub'dan klonla" `IconGithub`, `mb-5`). Modal açıklaması ve altbilgi düğmesi moda göre değişir ("Oluştur" / "Klonla", repo seçilmeden kapalı).

- **Klon sekmesi** (`Modals/CloneRepoForm.tsx`): arama `Input`, `GET /github/repos` listesi `flex max-h-[15rem] flex-col gap-1.5 overflow-y-auto` içinde `ui-option` radyo satırları (mürekkep zeminli `IconGithub` plakası, ad, sahip/ad, açıklama, gizliyse kilit). Projeye zaten eklenmiş repolar listede yok. Altında hedef dizin alanı.
- GitHub bağlı değilse liste yerine `ui-hatch` kesik kenarlı boş durum ve birincil "GitHub'a bağlan" (`GithubConnectModal`). Yüklenirken `h-[3.25rem]` taralı iskelet satırları.

---

## 6. Yerleşim

### 6.1 Uygulama kabuğu

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ AppRail      │ TopBar  (h-16, border-b-2, bg-paper, px-3 sm:px-5)      │
│ 260px ↔ 76px ├──────────────────────────────────────────────────────────┤
│ bg-panel     │ main  (min-h-0 flex-1, kendi içinde kayar)               │
│ border-r-2  ●│ ← kenar tutamağı (top 50px, right -15px)                │
│              │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

`AppShell.tsx` board ve İstatistikler sayfalarının ortak kabuğudur (`section: "board" | "insights"`). WebSocket (`useAgentSocket`) yalnızca burada bağlanır; canlı durum ve görev güncellemeleri her görünüme ulaşır. Rayın mobil katmanının açık/kapalı durumu da burada tutulur.

```tsx
<div className="flex h-dvh overflow-hidden bg-paper">
  <AppRail mobileOpen={railOpen} onMobileClose={closeRail} />
  <div className="flex min-w-0 flex-1 flex-col">
    <TopBar section={…} menuOpen={railOpen} onOpenMenu={() => setRailOpen(true)} />
    <main className={section === "board"
      ? "min-h-0 flex-1 flex flex-col overflow-hidden px-3 pb-3 pt-4 sm:px-6 sm:pt-5"
      : "min-h-0 flex-1 overflow-y-auto"}>{children}</main>
  </div>
  <ToastContainer />
</div>
```

Board'un ana alanı sabit yükseklikli (sütunlar kendi içinde kayar), İstatistikler sayfası kayar.

### 6.2 Sol ray (`Shell/AppRail.tsx`)

- `<aside id="app-rail" aria-label="ClauFlow">`: `h-full shrink-0 flex-col border-r-2 border-line bg-panel`. Masaüstünde (`md` ve üstü) `relative z-20 hidden md:flex transition-[width] duration-200 ease-out`; açıkken `w-[260px]`, daraltılmışken `w-[76px] items-center`.
- **Mobil katman (`md` altı):** ray gizlidir, TopBar'daki menü düğmesiyle soldan kayan katman olarak açılır: `rail-sheet fixed inset-y-0 left-0 z-50 flex w-[min(280px,86vw)]` (`ui-rail-in` 220ms, `box-shadow: 4px 0 0 var(--shadow-ink)`), arkasında `ui-scrim z-40`. `role="dialog"`, `aria-modal`, odak tuzağı; Esc, scrim, gezinme ve logo satırındaki kapat düğmesi kapatır, `md` eşiği geçilince kendiliğinden kapanır. Katmandaki ray her zaman açık (daraltılmamış) haldedir.
- Durum `localStorage["rail-collapsed"]` içinde `"1"` ya da `"0"` olarak saklanır (`viewStore`).
- **Logo satırı:** `flex h-16 w-full shrink-0 items-center border-b-2 border-line` (açıkken `gap-2 px-4`, daraltılmışken `justify-center`). Monogram şöyle: `h-9 w-9 rounded-[10px] border-2 border-line bg-mustard font-mono text-[14px] font-extrabold text-[var(--on-mustard)] shadow-[2px_2px_0_var(--shadow-ink)]`, içinde "cf". Sağ üst köşede `-right-[3px] -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-line bg-orange` noktası var. Logo kelimesi `text-[18px] font-extrabold tracking-[-0.03em]`.
- **Kenar tutamağı (yuvarlak):** başlık çizgisinin üstünde durur, iki durumda da görünür. Sarmalayıcı `absolute -right-[15px] top-[50px] z-30`. Buton `ui-focus grid h-7 w-7 place-items-center rounded-full border-2 border-ink bg-panel text-ink shadow-hard transition-colors hover:bg-mustard`, içinde `IconChevronLeft`/`IconChevronRight` (`size={14}`). `aria-label` ve tooltip duruma göre "daralt"/"genişlet" der, `aria-expanded={!collapsed}`, tooltip `side="right"`.
- **Proje değiştirici:** kaydırma alanının dışında durur, böylece popover'ı kırpılmaz (`relative z-10 w-full shrink-0 pt-4`, açıkken `px-3`).
- **Gezinti:** `flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden pb-4 pt-5`. Bölüm başlığı `t-label mb-2 px-2 !text-[10px]`. Liste `flex flex-col gap-1`. Öğe ikonları `size={17}`, `grid w-5 place-items-center` içinde. Daraltılmış rayda her öğe `Tooltip side="right"` ile sarılır ve etiket metni düştüğü için `aria-label` taşır. GitHub reposu klonlamak raydan değil, Yeni proje modalının klon sekmesinden yapılır (§5.25).
- **Alt bilgi:** `flex w-full shrink-0 flex-col gap-2 border-t-2 border-line p-3`. Açıkken kesik kenarlı "+ Yeni proje" butonu: `h-10 w-full rounded-[10px] border-2 border-dashed border-line px-3 text-[14px] font-semibold text-ink-2`, hover'da `border-solid bg-mustard text-[var(--on-mustard)] shadow-[2px_2px_0_var(--shadow-ink)]`. Daraltılmışken `IconButton`.

**Rail öğesi:**

```css
.rail-item { position: relative; display: flex; align-items: center; gap: 0.7rem; width: 100%; height: 2.5rem;
  padding: 0 0.7rem; border: 2px solid transparent; border-radius: var(--r-btn); color: var(--ink-2);
  font-size: 0.875rem; font-weight: 600; text-align: left; white-space: nowrap; cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, transform 110ms var(--ease-press), box-shadow 110ms var(--ease-press); }
.rail-item:hover { background: var(--hair); color: var(--ink); }
.rail-item:active { transform: translate(1px, 1px); }
.rail-item[aria-current="page"] { background: var(--mustard); color: var(--on-mustard); border-color: var(--line);
  box-shadow: 2px 2px 0 var(--shadow-ink); }
.rail-item:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 2px; }
.rail-item--compact { justify-content: center; padding: 0; width: 2.75rem; }
```

### 6.3 Üst bar (`Shell/TopBar.tsx`)

`<header className="relative z-10 flex h-16 shrink-0 items-center gap-1.5 border-b-2 border-line bg-paper px-3 sm:gap-3 sm:px-5">`. Soldan sağa:

0. **Menü düğmesi** (yalnızca `md` altı): ghost `IconButton sm`, `IconRail size={17}`, `aria-expanded`, `aria-controls="app-rail"`; rayın mobil katmanını açar.
1. **Breadcrumb** (`nav aria-label="Breadcrumb"`, `ol`): proje › görünüm › görev anahtarı. Ayırıcı `IconChevronRight size={13}`, `text-ink-3`. Son öğe `aria-current="page"`. Seçili görevin başlığı yalnızca `xl` ve üstünde görünür.
2. **Arama** (yalnızca board görünümlerinde): `sm` ve üstünde `relative w-[300px] flex-none`, `Input size="sm"`, `IconSearch size={14}`, `id="board-search"`. Sağda boşken `Kbd` "/" (`!h-5 !min-w-5`), doluyken temizleme düğmesi (ghost `IconButton`, `!h-6 !w-6`) durur. Esc metni temizler. `sm` altında ikon düğmesine döner; tıklanınca alan başlık genişliğinde (`absolute inset-x-3`) açılır ve odaklanır, boşken odak kaybında ya da Esc ile kapanır.
3. **Canlı/çevrimdışı** `StatusPill` (`done` + `live` ya da `nothing`). `hidden md:inline-flex`.
4. **AgentCore** (36px CSS 3D küp, bkz. §7.4).
5. Bildirimler ve ön koşul göstergesi (`Layout/PrereqIndicator.tsx`). Göstergenin popover'ında `claude` / `git` / `gh` satırlarının altında, `border-t-2 border-hair` ayraçla **GitHub satırı** durur: `h-6 w-6 rounded-[7px] border-2` durum plakası (bağlıysa `--green` + `IconCheck`, değilse `--sunken` + `IconGithub`), mono "GitHub" etiketi, `@kullanıcı` ya da "bağlı değil (isteğe bağlı)"; bağlı değilse birincil `Button size="sm"` "Bağlan" (`GithubConnectModal`). GitHub isteğe bağlıdır, eksik sayısına girmez. Auth durumu tek store diliminden (`store/githubAuthStore.ts`) gelir ve ilk yanıt gelene kadar satır hiç çizilmez (yanlış durum yanıp sönmez).
6. Dikey ayraç: `h-6 w-[2px] flex-none rounded bg-hair`.
7. TR/EN düğmesi: `ui-focus grid h-8 min-w-8 place-items-center rounded-[8px] px-1.5 font-mono text-[12px] font-bold text-ink-2 hover:bg-hair hover:text-ink`.
8. Tema düğmesi: ghost `IconButton sm`.
9. GitHub: yalnızca bağlıysa ve durum yüklendiyse `Avatar size="sm" state="online"` ve kullanıcı adı (`hidden lg:inline`, `max-w-[120px] truncate text-[13px] font-semibold`). Bağlı değilken TopBar'da düğme yoktur; bağlantı ön koşul göstergesinden yapılır.

### 6.4 Board sayfası (`Board/Board.tsx`)

`flex h-full min-h-0 flex-col gap-5` içinde:

- **Sayfa başlığı:** `flex flex-wrap items-end justify-between gap-x-6 gap-y-4`. Solda `SectionPill size="sm"` (görünüm adı ve ikonu), proje slug'ı (`font-mono text-[12px] font-semibold uppercase text-ink-3`), dal adı ve kirli/temiz noktası (turuncu/yeşil) durur. Altında `h1.t-display mt-2 truncate text-[32px]` ve ipucu `mt-1 text-[13px] text-ink-3` (remote'u olmayan projede yerel akışı anlatan ayrı metin: `board.hintLocal`; Review sütununun boş durumu da aynı ayrımı yapar). Sağda `BoardStats`.
- **Araç çubuğu:** `flex flex-wrap items-center gap-3`. Sırasıyla: `Segmented size="sm"` (Board/Liste/Fabrika, ikonlar `size={14}`), ayraç, hızlı filtre çipleri (`role="group"`, `flex flex-wrap items-center gap-2`), `flex-1` boşluk ve `Tooltip shortcut="N"` ile sarılı birincil "Yeni görev".
- **Sütunlar:** `-mx-1 flex min-h-0 flex-1 gap-3.5 overflow-x-auto px-1 pb-3`. Yatay kayar.
- **Filtre sonucu boş:** `ui-panel ui-hatch flex max-w-sm flex-col items-center gap-3 px-8 py-8 text-center`.
- **Proje yok:** `ui-panel ui-panel--raised flex max-w-md flex-col items-center gap-4 px-10 py-10 text-center`, ikon `ui-panel__icon !h-12 !w-12 !rounded-[12px]`.
- dnd-kit ayarları: `PointerSensor` `distance: 6`. `DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.3,.7,.4,1)" }}`.

### 6.5 Boşluk ölçeği ve ızgara

- **Boşluk tokenı tanımlı değil.** Tailwind v4'ün varsayılan ölçeği kullanılıyor (`--spacing: 0.25rem`). Kök 14px olduğu için **1 adım = 3.5px** (`gap-3` = 10.5px, `p-4` = 14px, `h-16` = 56px).
- Primitive'lerin içi `rem` ve `em` ile verilmiş (ör. `.ui-panel__head` `padding: 0.85rem 1rem 0`).
- Kodda tekrar eden değerler:

| Bağlam | Değer |
|---|---|
| Board ana alanı | `px-3 pb-3 pt-4`, `sm` ve üstü `px-6 pt-5` |
| Üst bar | `h-16 px-3 gap-1.5`, `sm` ve üstü `px-5 gap-3` |
| Board bölümleri arası | `gap-5` |
| Araç çubuğu | `gap-3` (filtre çipleri arası `gap-2`) |
| Sütunlar arası / kartlar arası | `gap-3.5` / `gap-3` |
| Panel gövdesi | `p-3` (sm) / `p-4` (md) |
| Modal ve drawer kenar dolgusu | `px-5` (başlık `py-3.5`, gövde `p-5`) |
| Kart içi | `py-3 pr-3 pl-4` |

- **Izgara tokenı tanımlı değil.** Izgaralar yerinde `grid-cols-*` ile kuruluyor (styleguide: `grid-cols-3 sm:grid-cols-4`, `grid-cols-6`, `xl:grid-cols-2` …). Board flex tabanlı.

### 6.6 Katman (z-index) sırası

| z | Öğe |
|---|---|
| `-1` | Kâğıt dokusu (`body::before`, `body { isolation: isolate }` içinde) |
| `10` | Üst bar. Proje değiştirici sarmalayıcısı. |
| `20` | Sol ray |
| `30` | Ray kenar tutamağı |
| `40` | Drawer. Fabrika tooltip'i (`.factory-tip`). Mobil ray katmanının scrim'i. |
| `50` | Modal. Mobil ray katmanı (`.rail-sheet`). |
| `55` | Menü (`.ui-menu`) |
| `60` | Tooltip |
| `9999` | ConfirmDialog, Toast |

### 6.7 Duyarlı davranış

- **Özel breakpoint tanımlı değil.** Tailwind v4 varsayılanları geçerli: `sm` 40rem, `md` 48rem, `lg` 64rem, `xl` 80rem. Media query'lerde rem tarayıcı varsayılanına göre çözülür (16px, yani `md` = 768px).
- Kodda var olanlar:
  - `md` altında ray gizlenir ve TopBar menü düğmesiyle açılan katmana döner (§6.2). `md` ve üstünde daraltma yalnızca kullanıcı tutamağa basınca olur.
  - Üst bar: menü düğmesi `md:hidden`, arama `sm` altında ikon, canlı pil `hidden md:inline-flex`, kullanıcı adı `hidden lg:inline`, görev başlığı `hidden xl:inline`.
  - Drawer: dar ekranda `min(…px, 100vw)` ya da `w-full`, `md` ve üstünde vw yüzdesi ve `min-w`. Aside sütunu `hidden lg:block`.
  - Modal: `p-4` kenar boşluğu, `max-h-[85vh]`, `w-full` ve `max-w-*`.
  - Board sütunları `min-w-[272px]` olduğu için dar ekranda yatay kayar (sayfa değil, sütun şeridi; 390px'te `scrollWidth` 390).
  - Kabuk `h-dvh` (mobil tarayıcı çubuğu yüksekliği düşer).
  - Styleguide iki tema sütununu `xl` ve üstünde yan yana koyar. Styleguide yalnızca geliştirmede açılır, üretimde 404.

---

## 7. Hareket

### 7.1 Eğriler

| Ad | Değer | Nerede |
|---|---|---|
| `--ease-press` | `cubic-bezier(0.3, 0.7, 0.4, 1)` | Basma ve kalkma, pop girişleri, drawer girişi, segment ve checkbox geçişleri |
| `ease` | CSS varsayılanı | Renk ve zemin geçişleri, scrim |
| `ease-in` | CSS | Çıkışlar (`ui-pop-out`, `ui-drawer-out`) |
| `linear` | CSS | Spinner, yürüyen kenar, toast şeridi |
| `cubic-bezier(0.2, 0.8, 0.3, 1)` | | DONE konfeti parçaları |
| `cubic-bezier(0, 0, 0.2, 1)` | | Zaman çizelgesi düğümü ping'i |
| `ease-out` (Tailwind) | | Ray genişliği (`duration-200`), drawer genişliği (`duration-300`), yeni kart girişi (500ms) |

### 7.2 Süreler (koddan)

| Süre | Ne |
|---|---|
| `40ms` | Buton basılı geçişi |
| `90ms` | Çip ve kart içi buton transform/gölge |
| `100ms` | Menü öğesi zemini, checkbox |
| `110ms` | Buton, rail öğesi, linkrow transform/gölge |
| `120ms` | Renk/zemin geçişleri (sekme, segment, çip zemini, girdi). Tooltip pop. |
| `140ms` | Buton renkleri, etkileşimli panel, sütun zemini, switch izi. Modal çıkışı. Menü pop. |
| `160ms` | Scrim giriş/çıkış, sekme ikonu dönüşü, sürüklenen kartın kalkışı (`card-pickup`) |
| `170ms` | Kart hover kalkışı |
| `180ms` | Modal girişi, drawer çıkışı, switch topuzu, drag overlay bırakma |
| `220ms` | Sekme paneli girişi (`ui-panel-in`) |
| `240ms` | Drawer girişi |
| `300ms` | Tooltip hover gecikmesi |
| `480ms` | DONE'a inen kart (`done-land`) |
| `500ms` | Yeni kart girişi, fabrika yedeği ile sahne arasında çapraz geçiş, ajan çekirdeği halesi |
| `600ms` | RingGauge yayı |
| `700ms` | Çalışan kartın yürüyen kenarı (sonsuz) |
| `760ms` | DONE konfeti parçaları |
| `0.8s` | Spinner (sonsuz) |
| `1.4s` | Canlı nokta ping'i (sonsuz) |
| `1.6s` | Sütun tarama çizgisi (sonsuz) |
| `3000ms` | Toast boşalan şeridi |

### 7.3 Keyframe'ler (tam liste)

```css
@keyframes ui-spin { to { transform: rotate(360deg); } }
@keyframes ui-ping { 0% { transform: scale(0.6); opacity: 0.9; } 80%, 100% { transform: scale(1.35); opacity: 0; } }
@keyframes ui-pop { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes ui-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ui-pop-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(4px) scale(0.985); } }
@keyframes ui-panel-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes tl-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toast-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes ui-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ui-drawer-in { from { transform: translateX(104%); } to { transform: translateX(0); } }
@keyframes ui-drawer-out { from { transform: translateX(0); } to { transform: translateX(104%); } }
@keyframes ui-rail-in { from { transform: translateX(-104%); } to { transform: translateX(0); } }
@keyframes fade-up { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes dot-bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
@keyframes scan-line { from { transform: translateX(-100%); } to { transform: translateX(200%); } }
@keyframes edge-march { from { background-position: 0 0; } to { background-position: 0 11.3px; } }
@keyframes card-pickup {
  from { transform: rotate(0deg) scale(1); box-shadow: var(--shadow); }
  to { transform: rotate(2.5deg) scale(1.02); box-shadow: 8px 10px 0 var(--shadow-ink); }
}
@keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
```

Yardımcılar: `.animate-dot-1/2/3` (`dot-bounce 1.4s infinite ease-in-out`, gecikmeler 0s / 0.2s / 0.4s) ve `.animate-fade-up` (`fade-up 0.22s ease-out both`).

### 7.4 Mikro etkileşimler

- **Buton gömülmesi:** §4.4.
- **Kart:** hover'da kalkar (`translate(-2px,-2px)`, `5px 5px 0`). Sürüklenen kart overlay'de `rotate(2.5deg) scale(1.02)` olur ve gölgesi `8px 10px 0` olur. Kartın asıl yeri kesik kenarlı ve taralı bir boşluk olarak kalır.
- **Çalışan ajan:** kartın sol kenarında turuncu, çapraz çizgili, yürüyen bir şerit (`edge-march 700ms`). Kart zemini %7 turuncuya boyanır. Sütun başlığının üstünde tarama çizgisi gezer (`.lane__scan`). Canlı noktalar atar (`ui-ping`).
- **DONE patlaması** (`TaskCard.tsx` içindeki `DoneBurst`): kart DONE sütununa düşüp yeniden mount olunca 14 mürekkep kenarlı konfeti karesi saçılır ve kart yeşil gölgeyle iner.
  - Parça `i` (0–13): açı `--a = i * (360/14) + (i % 2 ? 9 : -6)` derece, mesafe `--d = 46 + (i % 3) * 18` px, renk `--c` sırayla `var(--green)`, `var(--mustard)`, `var(--cobalt)`, `var(--orange)`, boyut `--s` = `i % 3 === 0` ise 11px, değilse 8px, gecikme `(i % 4) * 18` ms.
  - `burst` durumu 900ms sonra temizlenir.

```css
.done-burst { position: absolute; left: 50%; top: 40%; width: 0; height: 0; pointer-events: none; z-index: 3; }
.done-burst i { position: absolute; left: 0; top: 0; width: var(--s); height: var(--s); margin: calc(var(--s) / -2);
  border: 2px solid var(--line); border-radius: 2px; background: var(--c); opacity: 0;
  animation: done-burst 760ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }
@keyframes done-burst {
  0% { opacity: 1; transform: rotate(var(--a)) translateX(6px) scale(0.3); }
  70% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--a)) translateX(var(--d)) rotate(170deg) scale(1); }
}
.task-card[data-burst] { animation: done-land 480ms var(--ease-press) both; }
@keyframes done-land {
  0% { transform: translateY(-7px) scale(1.03); box-shadow: 6px 9px 0 var(--green); }
  55% { transform: translateY(1px) scale(0.995); box-shadow: 2px 2px 0 var(--green); }
  100% { transform: none; box-shadow: var(--shadow); }
}
```

- **Ajan çekirdeği** (`Shell/AgentCore.tsx`, üst bar, 36×36px): WebGL değil, CSS 3D ve Web Animations API ile yapılmış. Her sayfaya three.js ve ikinci bir GL bağlamı yüklemek yerine bu yol seçildi. 16px'lik toon küpün yüzleri mürekkep kenarlı (`2px solid var(--core-ink)`). Yan yüzler `color-mix(... 74%, var(--ink))`, üst yüz `62%, var(--panel)`, alt yüz `58%, var(--ink)` ile gölge adımları verir. Küpün etrafında kesik çizgili bir yörünge halkası (`33px`) var.
  - Dönüş: küp `5200ms`, yörünge `2600ms`, sonsuz.
  - Hız `updatePlaybackRate` ile değişir, faz atlamaz. Boştayken küp `0.32`, yörünge `0.25`. Çalışan ajan varken küp `Math.min(4, 1 + running * 0.75)`, yörünge bunun `0.8` katı.
  - Boştayken hardaldır ve `core-breathe 3.8s` ile nefes alır (`scale(0.86)` ↔ `scale(1)`). Çalışırken `--core-c: var(--orange)` olur, hale `core-glow 1.1s` ile atar (opaklık `--core-heat = min(1, 0.45 + running * 0.2)`), yörüngede ajan başına bir kıvılcım (en çok 4) ve turuncu sayaç rozeti belirir.
  - Gecede `--core-ink: var(--sunken)`.
- **Yeni kart girişi:** `opacity 500ms ease-out, translate 500ms ease-out` (`0 -8px` konumundan).
- **Sekmeler:** basınca `translateY(1px)`. Aktif sekmenin ikonu `rotate(-8deg) scale(1.08)` olur. Panel girişinde `ui-panel-in`.

### 7.5 Azaltılmış hareket

`globals.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
  .done-burst { display: none; }
}
```

- Sonsuz animasyonlar (ping, tarama, yürüyen kenar) tek bir 1ms çalışmaya iner. DONE patlaması tamamen gizlenir.
- `AgentCore`: Web Animations hiç başlatılmaz. Küp `rotateX(-26deg) rotateY(38deg)`, yörünge `rotateX(70deg)` konumunda sabit kalır.
- 3D: `frameloop="demand"` ve sahne saati poster karesinde donar (§8.6).
- `usePrefersReducedMotion()` (`three/activity.ts`) canlı bir `matchMedia` aboneliğidir, sunucu anlık görüntüsü `false`.

---

## 8. 3D (Three.js / R3F)

Uygulamada iki 3D sahne var: landing'deki "Ajan Fabrikası" ve board'daki "Fabrika" görünümü. Ortak kit `gui/src/components/three/` altında. Görünüm, 2D dilin oyuncak fabrikası karşılığı: toon gölgeleme, kalın mürekkep kontur, token renkleri, sert ofset gölgeli kâğıt tabla.

### 8.1 Paketler (`gui/package.json` ve kurulu sürümler)

| Paket | package.json | Kurulu |
|---|---|---|
| `three` | `^0.187.0` | 0.187.0 |
| `@react-three/fiber` | `^9.8.2` | 9.8.2 |
| `@react-three/drei` | `^10.7.9` | 10.7.9 |
| `@types/three` (dev) | `^0.187.0` | – |
| `react` / `react-dom` | `^19.0.0` | react 19.2.5 |
| `next` | `^15.1.6` | 15.5.15 |
| `tailwindcss` / `@tailwindcss/postcss` (dev) | `^4.0.0` | 4.2.4 |
| `clsx` | `^2.1.1` | 2.1.1 |

Postprocessing paketi **yok**. Dış model dosyası yok, bütün geometri prosedürel.

### 8.2 Modül ayrımı (performans için)

- `activity.ts`, `webgl.ts` ve `colors.ts` three.js **import etmez**. DOM tarafı bunları kullanarak yedek kararını renderer chunk'ı istenmeden önce verir.
- `index.ts` barrel'ı three'yi çeker. Yalnızca `next/dynamic({ ssr: false })` ile yüklenen modüllerden import edilir:

```tsx
const BoardFactoryScene = dynamic(() => import("./scene/BoardFactoryScene"), { ssr: false, loading: () => null });
```

### 8.3 Palet: CSS tokenlarından

`colors.ts`, `getComputedStyle` ile canlı tokenları okur (`SCENE_TOKENS`: `--paper`, `--panel`, `--sunken`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--hair`, `--shadow-ink`, `--mustard`, `--mustard-press`, `--cobalt`, `--orange`, `--red`, `--green`, `--on-*`). `#rrggbbaa` biçimindeki değerlerin alfası atılır (`three.Color` yalnızca opak renk alır). Token okunamazsa krem değerler yedek olarak kullanılır. `useSceneColors()`, `useTheme` değişince yeniden hesaplanır. Ek alanlar şunlar: `night`, `stock` (gecede `ink`, kremde `panel`), `fontSans` ve `fontMono` (canvas etiketleri için next/font değişkenleri).

`palette.ts` → `buildPalette(c)`. Tokenlar aynen kopyalanır, ayrıca türetilmiş "stoklar" eklenir (`mix(a, b, t)` = `THREE.Color.lerp`):

| Anahtar | Krem | Gece |
|---|---|---|
| `outline` | `line` | `sunken` |
| `print` | `ink` | `paper` |
| `kraft` | `mix(stock, mustard, 0.42)` | aynı |
| `kraftDark` | `mix(stock, mustardPress, 0.62)` | aynı |
| `steel` | `mix(ink3, stock, 0.55)` | `mix(ink3, stock, 0.35)` |
| `steelDark` | `mix(ink2, ink3, 0.5)` | `mix(ink3, panel, 0.2)` |
| `belt` | `ink2` | `mix(panel, ink3, 0.3)` |
| `slab` | `panel` | `mix(panel, ink3, 0.12)` |
| `floor` | `mix(panel, sunken, 0.35)` | `panel` |
| `tape` | `mustard` | `mustard` |
| `rubber` | `ink` | `sunken` |

İstasyon vurguları: landing'de `STATION_ACCENT` = todo `cobalt`, doing `orange`, review `mustard`, done `green`. Board fabrikasında (`factoryLayout.ts`) todo `ink3`, doing `orange`, review `mustard`, done `green`; dört istasyon eşit aralıklı (x = −12, −4.6, 2.8, 10.2). Board fabrikasının tabelaları sütun adlarını dile göre büyük harfle yazar (`toLocaleUpperCase(lang)`); landing tabelaları marka öğesi olarak TODO/DOING/REVIEW/DONE kalır.

### 8.4 Toon malzeme, ışık ve kontur (`scene.tsx`)

- **Gradyan haritası (3 sert adım):** `new THREE.DataTexture(new Uint8Array([105, 175, 255]), 3, 1, THREE.RedFormat)`, `minFilter` ve `magFilter` `NearestFilter`, `generateMipmaps = false`. Adımlar: karanlık taraf 0.41, orta 0.69, aydınlık 1.0.
- **Malzeme bankası:** her palet anahtarı için tek bir paylaşılan `MeshToonMaterial({ color, gradientMap })` ve `MeshBasicMaterial({ toneMapped: false, … })` var. Tema değişince renkler **yerinde** güncellenir (`m.color.set(...)`), shader yeniden derlenmez.
- **Işıklar** (`ToonLights`). `flat` (NoToneMapping) ile ayarlı, aydınlık yüz token hex'ine denk gelir:

```tsx
<ambientLight intensity={1.41} />
<directionalLight position={[-6, 10, 2]} intensity={1.73} />
```

- **Mürekkep kontur** (`Ink`): drei `<Outlines thickness={width * dpr} color={palette[color]} />`. Genişlik CSS pikseliyle verilir, böylece her DPR'da 2D'deki 2px çizgilere denk düşer. Varsayılan `width = 2.25`, `color = "outline"`. Kapalı bir mesh'in içine konur. Parçalarda `1.25`–`1.75` arası incelikler de kullanılıyor. Tabla konturu `2.5` ve `"line"` (gecede krem kalır ki tabla sayfadan ayrılsın).
- **Primitive'ler** (`parts/basics.tsx`): `Block` (keskin kutu), `RBlock` (drei `RoundedBox`, `radius` 0.08, `smoothness` 2), `Cyl` (varsayılan 20 segment), `Ball` (18×12 küre). Hepsi `color: PaletteKey` ve `ink` (varsayılan `2.25`, `false` = yok) alır. Geometriler önbellekte tutulur.
- **Kâğıt tabla** (`DioramaBase`, `parts/site.tsx`): kalın `RoundedBox` (`radius` 0.28, `toon("slab")`, `Ink width={2.5} color="line"`). Altında 2D'deki `3px 3px 0` plakaların karşılığı olan **sert ofset gölge** var: `[0.32, -thickness + 0.02, 0.16]` ofsetli ince `RoundedBox`, `MeshBasicMaterial`, renk `palette.shadowInk`. Üst yüz, birim başına 80px çözünürlüklü bir canvas "zemin baskısı"dır ve üstünde basılı bir nokta ızgarası vardır (kremde `rgba(27,23,18,0.13)`, gecede `rgba(244,236,218,0.10)`).
- **Gölgeler:** drei `ContactShadows` `frames={1}` ile tek seferde pişirilir (tema değişince yeniden). Değerler: blur `2.2` (fabrika) / `2.4` (landing), `far` 5, opaklık gecede `0.7`, kremde `0.36` (fabrika) / `0.38` (landing), renk gecede `#000000`, kremde `palette.ink`. Hareketli öğeler ucuz `Blob` gölge alır (radyal canvas dokusu, varsayılan opaklık `0.32`). Bu yumuşak gölgeler, 2D'deki "bulanıklık yok" kuralının **3D'deki tek istisnası**.
- **Canvas yazıları** (`textures.ts`): etiketler ve tabelalar uygulamanın kendi Jost/JetBrains Mono fontlarıyla 2D canvas'a çizilir (font dosyası ya da CDN isteği yok). `document.fonts.ready` sonrasında yeniden çizilir. `colorSpace = SRGBColorSpace`, `anisotropy = 4`.

### 8.5 Canvas ve kamera (`SceneCanvas.tsx`)

```tsx
<Canvas
  role="img" aria-label={label}
  dpr={dpr}                       // varsayılan [1, 1.75]
  flat                            // tone mapping yok: token hex'leri olduğu gibi
  frameloop={frameloop}
  camera={{ fov: 30, near: 0.5, far: 120, position: [0, 8, 18], ...camera }}
  gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
  onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); /* + webglcontextlost → fallback */ }}
>
```

- Zemin şeffaf: arkadaki kâğıt (`--paper`) görünür.
- `PerformanceMonitor flipflops={2}` sürekli fps düşüşü görürse DPR'ı 1'e indirir (`onDecline` ve `onFallback`). Azaltılmış hareket varsa ya da `adaptive={false}` ise devreye girmez.
- `onReady`, iki kare çizildikten sonra tetiklenir (tek seferlik pişirmeler bitsin diye).
- Sahneye özel kameralar: landing `{ fov: 28, position: [6, 16, 32] }`. Board fabrikası `{ fov: 30, position: [2, 22, 30], near: 1, far: 160 }`, ayrıca `dpr={[1, 1.5]}` ve `adaptive={false}`. Fabrikada drei `MapControls` kullanılıyor.

### 8.6 Performans kuralları ve frameloop

`activity.ts`:

```ts
export function frameloopFor({ active, reducedMotion }) {
  if (reducedMotion) return "demand";
  return active ? "always" : "never";
}
// active = inView (IntersectionObserver, rootMargin "0px") && pageVisible (visibilitychange)
```

- Ekran dışındaki sahne ya da gizli sekme: `"never"` (0 kare).
- Azaltılmış hareket: `"demand"`. Sahne saati `posterTime`'da donar (`clock.t = posterTime`, `dt = 0`), tek bir poster karesi kalır.
- Board fabrikası `"always"` yerine `"demand"` kullanır. Yalnızca bir şey hareket ederken `invalidate()` çağrılır, boştaki fabrika 0 kare/sn çizer.
- Sahne saati: `dt = Math.min(delta, 1 / 20)`. Mount ya da tema değişiminden sonra 6 karelik `settle()` çalışır, böylece demand modunda da tek seferlik işler biter.
- Tema değişiminde shader derlenmez, yalnızca renkler güncellenir.

### 8.7 Yedek (fallback)

- **WebGL2 tespiti** (`webgl.ts`): three r163 ve sonrası WebGL1'i desteklemiyor. `canvas.getContext("webgl2")` denenir, ardından `WEBGL_lose_context` ile bağlam bırakılır. URL'de `?webgl=0` yedeği zorlar. `useWebGLSupport()` SSR ve hydration sırasında `null`, sonra `true` ya da `false` döner.
- **Akış** (`FactoryView.tsx`):
  - `webgl === false` ise yalnızca basılı 2D yedek (`FactoryFallback`) gösterilir.
  - Aksi halde yedek `opacity-60` ile altta durur, sahne `opacity-0` ile üstte başlar. `onReady` gelince ikisi `transition-opacity duration-500` ile çapraz geçiş yapar.
  - Renderer hata fırlatırsa (error boundary) ya da `webglcontextlost` gelirse `fallback` prop'u gösterilir.
- `FactoryFallback` aynı üretim hattının tokenlı SVG/DOM baskısıdır. Yedek olarak gösterildiğinde nedenini açıklar ve 2D görünümlere geçiş butonları sunar.

### 8.8 Başka projede kurmak için kısa tarif

1. `three`, `@react-three/fiber`, `@react-three/drei` paketlerini kurun. Sahneyi istemci tarafında, tembel yükleyin (SSR yok).
2. Renkleri `getComputedStyle(document.documentElement).getPropertyValue("--…")` ile tokenlardan okuyun. Tema sınıfı değişince yeniden okuyun.
3. `MeshToonMaterial` ve 3 adımlı `[105, 175, 255]` `NearestFilter` gradyanını kullanın. `<Canvas flat>` açın. Ambient `1.41` ve directional `[-6, 10, 2]` / `1.73` ışık koyun.
4. Her mesh'e `<Outlines thickness={2.25 * dpr} />` ekleyin. Gecede kontur rengi `--sunken`, kremde `--line` olsun.
5. Tablanın altına, `--shadow-ink` renginde, unlit ve ofsetli bir plaka koyarak sert gölge verin.
6. DPR'ı `[1, 1.75]` ile sınırlayın. Ekran dışı ya da gizli sekmede `frameloop="never"`, azaltılmış harekette `"demand"` kullanın ve poster karesini gösterin. WebGL2 yoksa 2D bir yedek gösterin.

---

## 9. Erişilebilirlik

### 9.1 Odak halkası

| Kural | Değer |
|---|---|
| Güvenlik ağı (`@layer base`, sıfır özgüllük `:where(...)`) | `a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [tabindex]:not([tabindex="-1"])` → `:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 2px; }` |
| `.ui-focus` | `outline: 2.5px solid var(--focus); outline-offset: 3px;` (sert gölgenin dışında kalır) |
| `.task-card`, `.ui-check`, `.ui-switch`, `.ui-option`, `.ui-linkrow` | `outline-offset: 3px` |
| `.rail-item`, `.task-card__btn`, `button.tl__head` | `outline-offset: 2px` |
| `.ui-seg__item` | `outline-offset: -5px; border-radius: 6px;` (içe) |
| `.ui-tab` | `outline-offset: -4px` |
| Tablo satırı | `outline-offset: -3px` |
| `.ui-menu__item` | Outline yok. Hardal %26 zemin ve `box-shadow: inset 0 0 0 2px var(--focus)`. |
| `.ui-input:focus` | `outline: none`, `background: var(--panel)`, `box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 40%, transparent), var(--shadow)` |

Halka her zaman kobalt (`--focus: var(--cobalt)`) ve `outline` olarak verilir. `box-shadow` ile verilmez ki sert gölgeyle çakışmasın.

### 9.2 Klavye

- **Board kısayolları** (`hooks/useKeyboardShortcuts.ts`): `N` yeni görev, `/` aramaya odaklan, `?` kısayol yardımı, `Esc` kapat. Odak girdi, textarea, select ya da contenteditable içindeyken yalnızca Esc çalışır.
- **Tabs ve Segmented:** roving tabindex (aktif öğe `tabIndex=0`, diğerleri `-1`). ←/→ döngüsel gezinir, Home/End uçlara gider. Segmented devre dışı seçenekleri atlar.
- **Tooltip:** klavye odağında (`:focus-visible`) gecikmesiz açılır, Esc kapatır.
- **Overlay'ler:** odak içeri taşınır (`[data-autofocus]` varsa ona). Tab içeride döner. Kapanınca odak eski öğeye döner. Esc yalnızca en üstteki katmanı kapatır (`useEscapeLayer`).
- **ConfirmDialog:** odak bir butonda değilken Enter onaylar.
- **Popover menüler:** dışarıda `pointerdown` ya da Esc kapatır (`useDismiss`).
- **Görev kartı:** odaktayken Enter ya da Space detayı açar. Sürükleme ajan çalışırken kilitlidir (`data-locked`) ve `title` nedenini söyler.
- **Hover'da beliren kontroller** (raydaki indirme ikonu) `group-focus-visible:opacity-100` ile klavye odağında da görünür.

### 9.3 ARIA kalıpları (kodda kullanılanlar)

| Bileşen | ARIA |
|---|---|
| Tabs | `role="tablist"` + `aria-label`. Sekmeler `role="tab"`, `aria-selected`, `aria-controls` ve `id` (`idBase` ile). |
| Segmented | `role="radiogroup"` + `aria-label`. Öğeler `role="radio"`, `aria-checked`. |
| Chip | `aria-pressed` |
| Switch | `role="switch"`, `aria-checked`, `aria-label` |
| Menü öğesi | `role="menu"`, `role="menuitemcheckbox"`, `aria-checked` |
| Tooltip | `role="tooltip"`, tetikleyiciye `aria-describedby` |
| Modal / Drawer | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (ya da `aria-label`), `tabIndex={-1}` |
| ConfirmDialog | `role="alertdialog"`, `aria-labelledby`, `aria-describedby` |
| Toast | Kap `role="region" aria-live="polite"`. Öğe `role="alert"` (hata) ya da `role="status"`. |
| DotMeter / RingGauge | `role="meter"`, `aria-valuemin/max/now`, `aria-label` |
| PriorityMark (etiketsiz) | `role="img"` + `aria-label` |
| Avatar, AgentCore, 3D Canvas | `role="img"` + `aria-label` |
| Rail / breadcrumb | Aktif öğe `aria-current="page"`. Kenar tutamağı `aria-expanded`. Daraltılmış rayda öğeler `aria-label`. Mobil katman `role="dialog"` + `aria-modal`, menü düğmesi `aria-expanded` + `aria-controls="app-rail"`. |
| Board sütunu | `<section aria-label="Başlık · n">`. Daralt/aç butonları `aria-expanded`. |
| IconButton | `aria-label` ve `title` zorunlu (`label` prop'u) |
| Dekoratif noktalar ve ikonlar | `aria-hidden` (ikon SVG'leri ayrıca `focusable="false"`) |

### 9.4 Diğer

- Kontrast kararları için §2.5'e bakın: küçük metinde `--*-text`, dolgu üstünde `--on-*`.
- Azaltılmış hareket için §7.5'e bakın.
- `<html lang>` store'daki dille eşitlenir (`LangHydrator`). Yoksa CSS `uppercase`, İngilizce metinde "HIGH"ı "HİGH" yapıyordu (plan §11).

---

## 10. Başka projeye taşıma

### 10a. Düz CSS başlangıç dosyası (Tailwind'siz)

Bu blok `globals.css`'ten sadeleştirilmeden kopyalandı. Tek fark font değişkenleri: Next.js'te `--font-jost` ve `--font-jetbrains-mono` değişkenlerini `next/font` tanımlıyor, burada elle tanımlandılar ve böyle işaretlendiler. Tailwind'de `@theme` ile üretilen `--font-sans/--font-mono/--font-display` da burada `:root`'a yazıldı. `atolye.css` olarak kaydedin ve §10c'deki font bağlantısıyla birlikte yükleyin.

```css
/* ════════════════════════════════════════════════════════════════════════
   Atölye starter — ClauFlow globals.css'ten taşındı (Tailwind'siz)
   Varsayılan krem; <html class="night"> gece vardiyası.
   .theme-cream / .theme-night bir alt ağaçta temayı zorlar.
   ════════════════════════════════════════════════════════════════════════ */

/* Fontlar. UYARLAMA: Next.js'te bu iki değişkeni next/font üretir. */
:root {
  --font-jost: "Jost";
  --font-jetbrains-mono: "JetBrains Mono";
  --font-display: var(--font-jost), "Futura", "Century Gothic", ui-sans-serif, system-ui, sans-serif;
  --font-sans: var(--font-jost), "Futura", "Century Gothic", ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, "SFMono-Regular", Menlo, monospace;
}

/* ─── Cream (default) ─── */
:root,
.theme-cream {
  color-scheme: light;

  --paper: #f4ecda;
  --panel: #fbf6ea;
  --sunken: #eadfc6;
  --ink: #1b1712;
  --ink-2: #4a4237;
  --ink-3: #6b6152;
  --line: #1b1712;
  --hair: #1b171226;

  --mustard: #f2c33d;
  --mustard-press: #d9a923;
  --cobalt: #2d5be3;
  --orange: #ee7b2c;
  --red: #c8372d;
  --green: #3e9b5a;

  /* Text-safe variants (≥4.5:1 on paper and sunken) */
  --mustard-text: #7f5b00;
  --orange-text: #a3460f;
  --green-text: #276e3d;
  --red-text: #b3302a;
  --cobalt-text: #2850c8;

  /* Ink to put on top of a filled hue */
  --on-ink: #f4ecda;
  --on-mustard: #1b1712;
  --on-orange: #1b1712;
  --on-green: #1b1712;
  --on-cobalt: #fbf6ea;
  --on-red: #fbf6ea;

  --shadow-ink: var(--line);
  --scrim: rgb(27 23 18 / 0.34);
  --grain-opacity: 0.045;
  --grain-blend: multiply;
}

/* ─── Night shift ─── */
html.night,
.theme-night {
  color-scheme: dark;

  --paper: #17140f;
  --panel: #221e17;
  --sunken: #100e0a;
  --ink: #f4ecda;
  --ink-2: #cfc4ae;
  --ink-3: #9d937f;
  --line: #e9dfc9;
  --hair: #f4ecda22;

  --mustard: #f2c33d;
  --mustard-press: #d9a923;
  --cobalt: #5b82f0;
  --orange: #f08a42;
  --red: #e2574c;
  --green: #5bb877;

  --mustard-text: #f2c33d;
  --orange-text: #f08a42;
  --green-text: #5bb877;
  --red-text: #e2574c;
  --cobalt-text: #7b9af3;

  --on-ink: #17140f;
  --on-mustard: #1b1712;
  --on-orange: #1b1712;
  --on-green: #1b1712;
  --on-cobalt: #17140f;
  --on-red: #17140f;

  --shadow-ink: #b9ae97;
  --scrim: rgb(5 4 3 / 0.62);
  --grain-opacity: 0.05;
  --grain-blend: screen;
}

/* ─── Shared geometry (her tema kökünde, türetilmiş değerler alt ağaçta doğru çözülsün diye) ─── */
:root,
.theme-cream,
.theme-night {
  --r-panel: 14px;
  --r-btn: 10px;
  --r-pill: 999px;
  --r-sm: 6px;

  --shadow: 3px 3px 0 var(--shadow-ink);
  --shadow-hover: 4px 4px 0 var(--shadow-ink);
  --shadow-press: 1px 1px 0 var(--shadow-ink);
  --shadow-lg: 6px 6px 0 var(--shadow-ink);
  --focus: var(--cobalt);
  --ease-press: cubic-bezier(0.3, 0.7, 0.4, 1);

  --border: color-mix(in srgb, var(--line) 24%, var(--paper));
}

.theme-cream,
.theme-night {
  background-color: var(--paper);
  color: var(--ink);
}

/* ─── Base ─── */
html,
body {
  background-color: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14px;            /* 1rem = 14px — tüm rem değerleri buna göre */
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  position: relative;
  isolation: isolate;
}

code, pre, kbd, samp {
  font-family: var(--font-mono);
  font-feature-settings: "calt", "liga";
}

::selection { background: var(--mustard); color: var(--on-mustard); }

/* Paper grain: fixed, non-interactive, behind content */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: var(--grain-opacity);
  mix-blend-mode: var(--grain-blend);
  background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 220 220' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 1 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
}

:where(input, textarea, select, button) { font-family: inherit; }

/* Keyboard focus safety net (layer'lı → bileşen kuralları kazanır) */
@layer base {
  :where(a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="radio"],
    [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [tabindex]:not([tabindex="-1"])):focus-visible {
    outline: 2.5px solid var(--focus);
    outline-offset: 2px;
  }
}

/* ─── Scrollbar ─── */
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink) 28%, transparent);
  border: 3px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
*::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--ink) 50%, transparent);
  background-clip: padding-box;
}
*::-webkit-scrollbar-track { background: transparent; }

/* ─── Typography ─── */
.t-display { font-family: var(--font-display); font-style: normal; font-weight: 700; letter-spacing: -0.025em; line-height: 1.05; }
.t-label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--ink-3);
}
.t-body { font-size: 0.875rem; line-height: 1.55; color: var(--ink); }
.t-h1 { font-size: 1.75rem; font-weight: 700; line-height: 1.15; letter-spacing: -0.025em; color: var(--ink); }
.t-h2 { font-size: 1.125rem; font-weight: 700; line-height: 1.3; letter-spacing: -0.012em; color: var(--ink); }

/* ─── Focus ring (outside the hard shadow) ─── */
.ui-focus:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 3px; }

/* ─── Button ─── */
.ui-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 0.5em;
  border: 2px solid var(--line); border-radius: var(--r-btn);
  font-family: var(--font-sans); font-weight: 600; letter-spacing: -0.005em; line-height: 1;
  white-space: nowrap; user-select: none; cursor: pointer; box-shadow: var(--shadow);
  transition: transform 110ms var(--ease-press), box-shadow 110ms var(--ease-press), background-color 140ms ease, color 140ms ease;
}
.ui-btn:hover { transform: translate(-1px, -1px); box-shadow: var(--shadow-hover); }
.ui-btn:active,
.ui-btn[data-pressed="true"] { transform: translate(2px, 2px); box-shadow: var(--shadow-press); transition-duration: 40ms; }
.ui-btn:disabled:not([aria-busy="true"]),
.ui-btn[aria-disabled="true"] {
  cursor: not-allowed; background: var(--sunken); color: var(--ink-3);
  border-color: color-mix(in srgb, var(--line) 35%, var(--paper)); transform: none; box-shadow: none;
}
.ui-btn--ghost:disabled:not([aria-busy="true"]) { background: transparent; border-color: transparent; }
.ui-btn[aria-busy="true"] { cursor: progress; opacity: 1; box-shadow: var(--shadow-press); transform: translate(2px, 2px); }
.ui-btn--sm { height: 2rem; padding: 0 0.8rem; font-size: 0.8125rem; border-radius: 8px; }
.ui-btn--md { height: 2.5rem; padding: 0 1.1rem; font-size: 0.875rem; }
.ui-btn--lg { height: 3rem; padding: 0 1.5rem; font-size: 1rem; }
.ui-btn--block { display: flex; width: 100%; }
.ui-btn--primary { background: var(--mustard); color: var(--on-mustard); }
.ui-btn--primary:active { background: var(--mustard-press); }
.ui-btn--secondary { background: var(--panel); color: var(--ink); }
.ui-btn--secondary:active { background: var(--sunken); }
.ui-btn--danger { background: var(--panel); color: var(--red-text); }
.ui-btn--danger:hover { background: var(--red); color: var(--on-red); }
.ui-btn--ghost { background: transparent; color: var(--ink-2); border-color: transparent; box-shadow: none; }
.ui-btn--ghost:hover { background: var(--hair); color: var(--ink); transform: none; box-shadow: none; }
.ui-btn--ghost:active { transform: translate(1px, 1px); box-shadow: none; background: color-mix(in srgb, var(--ink) 18%, transparent); }
/* Icon button */
.ui-btn--icon { padding: 0; aspect-ratio: 1 / 1; }
.ui-btn--icon.ui-btn--sm { width: 2rem; }
.ui-btn--icon.ui-btn--md { width: 2.5rem; }
.ui-btn--icon.ui-btn--lg { width: 3rem; }
.ui-spin { animation: ui-spin 0.8s linear infinite; }

/* ─── Pill + dot ─── */
.ui-pill { display: inline-flex; align-items: center; gap: 0.45em; border: 2px solid var(--line); border-radius: var(--r-pill); font-weight: 600; line-height: 1; white-space: nowrap; }
.ui-pill--sm { height: 1.5rem; padding: 0 0.6rem; font-size: 0.75rem; }
.ui-pill--md { height: 1.875rem; padding: 0 0.8rem; font-size: 0.8125rem; }
.ui-dot { display: inline-block; flex: none; width: 0.6rem; height: 0.6rem; border-radius: 999px; border: 1.5px solid var(--line); background: var(--dot, var(--ink-3)); }
.ui-dot--hatched { background: repeating-linear-gradient(135deg, var(--ink-3) 0 1.5px, transparent 1.5px 3.5px); }
.ui-dot--live { position: relative; }
.ui-dot--live::after { content: ""; position: absolute; inset: -4px; border-radius: 999px; border: 2px solid var(--dot); animation: ui-ping 1.4s var(--ease-press) infinite; }

/* ─── Chip ─── */
.ui-chip {
  display: inline-flex; align-items: center; gap: 0.45em; height: 1.875rem; padding: 0 0.75rem;
  border: 2px solid var(--line); border-radius: var(--r-pill); background: var(--panel); color: var(--ink);
  font-size: 0.8125rem; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer;
  transition: transform 90ms var(--ease-press), background-color 120ms ease, box-shadow 90ms var(--ease-press);
}
.ui-chip:hover { background: color-mix(in srgb, var(--mustard) 22%, var(--panel)); }
.ui-chip:active { transform: translate(1px, 1px); }
.ui-chip[aria-pressed="true"],
.ui-chip[data-active="true"] { background: var(--ink); color: var(--on-ink); box-shadow: 2px 2px 0 var(--mustard); }
.ui-chip:disabled { opacity: 0.5; cursor: not-allowed; }
.ui-chip__count { font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 600; padding: 0.15rem 0.35rem; border-radius: 999px; background: var(--sunken); color: var(--ink-2); }
.ui-chip[aria-pressed="true"] .ui-chip__count,
.ui-chip[data-active="true"] .ui-chip__count { background: var(--mustard); color: var(--on-mustard); }

/* ─── Segmented ─── */
.ui-seg { display: inline-flex; align-items: stretch; border: 2px solid var(--line); border-radius: var(--r-btn); background: var(--panel); box-shadow: var(--shadow); overflow: hidden; }
.ui-seg__item { display: inline-flex; align-items: center; gap: 0.5em; padding: 0 0.95rem; font-weight: 600; color: var(--ink-2); white-space: nowrap; cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }
.ui-seg__item + .ui-seg__item { border-left: 2px solid var(--line); }
.ui-seg__item:hover { background: var(--hair); color: var(--ink); }
.ui-seg__item[aria-checked="true"] { background: var(--mustard); color: var(--on-mustard); box-shadow: inset 0 -3px 0 var(--mustard-press); }
.ui-seg__item:focus-visible { outline: 2.5px solid var(--focus); outline-offset: -5px; border-radius: 6px; }
.ui-seg--sm .ui-seg__item { height: 1.875rem; font-size: 0.8125rem; padding: 0 0.75rem; }
.ui-seg--md .ui-seg__item { height: 2.375rem; font-size: 0.875rem; }
.ui-seg__count { min-width: 1.35rem; padding: 0.15rem 0.35rem; border-radius: 999px; border: 1.5px solid currentColor; font-family: var(--font-mono); font-size: 0.6875rem; text-align: center; }
.ui-seg__item[aria-checked="true"] .ui-seg__count { background: var(--on-mustard); color: var(--mustard); border-color: var(--on-mustard); }

/* ─── Panel ─── */
.ui-panel { position: relative; border: 2px solid var(--line); border-radius: var(--r-panel); background: var(--panel); color: var(--ink); }
.ui-panel--raised { box-shadow: var(--shadow); }
.ui-panel--sunken { background: var(--sunken); }
.ui-panel--interactive { cursor: pointer; transition: transform 140ms var(--ease-press), box-shadow 140ms var(--ease-press); }
.ui-panel--interactive:hover { transform: translate(-2px, -2px); box-shadow: 5px 5px 0 var(--shadow-ink); }
.ui-panel--interactive:active { transform: translate(1px, 1px); box-shadow: var(--shadow-press); }
.ui-panel__head { display: flex; align-items: center; gap: 0.65rem; padding: 0.85rem 1rem 0; }
.ui-panel__icon { display: inline-grid; place-items: center; width: 1.875rem; height: 1.875rem; flex: none; border: 2px solid var(--line); border-radius: 8px; background: var(--mustard); color: var(--on-mustard); }
.ui-panel__title { font-size: 0.9375rem; font-weight: 700; letter-spacing: -0.01em; }

/* ─── Tabs (folder) ─── */
.ui-tabs { display: flex; align-items: flex-end; gap: 0.25rem; padding: 0 0.5rem; border-bottom: 2px solid var(--line); }
.ui-tab { position: relative; display: inline-flex; align-items: center; gap: 0.45em; height: 2.375rem; padding: 0 0.95rem; margin-bottom: -2px; border: 2px solid transparent; border-bottom: 0; border-radius: 10px 10px 0 0; font-size: 0.875rem; font-weight: 600; color: var(--ink-3); cursor: pointer; transition: color 120ms ease, background-color 120ms ease; }
.ui-tab:hover { color: var(--ink); background: var(--hair); }
.ui-tab[aria-selected="true"] { color: var(--ink); background: var(--panel); border-color: var(--line); box-shadow: 0 2px 0 var(--panel); }
.ui-tab[aria-selected="true"]::before { content: ""; position: absolute; left: 10px; right: 10px; top: -2px; height: 4px; border-radius: 0 0 4px 4px; background: var(--mustard); }
.ui-tab:focus-visible { outline: 2.5px solid var(--focus); outline-offset: -4px; }
.ui-tab__count { font-family: var(--font-mono); font-size: 0.6875rem; padding: 0.1rem 0.35rem; border-radius: 999px; background: var(--sunken); color: var(--ink-2); }
.ui-tab:active { transform: translateY(1px); }
.ui-tab svg { transition: transform 160ms var(--ease-press); }
.ui-tab[aria-selected="true"] svg { transform: rotate(-8deg) scale(1.08); }
.ui-tabpanel { animation: ui-panel-in 220ms var(--ease-press) both; }

/* ─── Inputs ─── */
.ui-field-wrap { position: relative; display: flex; align-items: center; }
.ui-input { width: 100%; border: 2px solid var(--line); border-radius: var(--r-btn); background: var(--sunken); color: var(--ink); font-size: 0.875rem; box-shadow: inset 2px 2px 0 color-mix(in srgb, var(--ink) 9%, transparent); transition: background-color 120ms ease, box-shadow 120ms ease, border-color 120ms ease; }
.ui-input::placeholder { color: var(--ink-3); opacity: 1; }
.ui-input:hover { background: color-mix(in srgb, var(--sunken) 60%, var(--panel)); }
.ui-input:focus { outline: none; background: var(--panel); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 40%, transparent), var(--shadow); }
.ui-input[aria-invalid="true"] { border-color: var(--red); box-shadow: inset 0 0 0 1px var(--red); }
.ui-input:disabled { opacity: 0.55; cursor: not-allowed; }
.ui-input--sm { height: 2rem; padding: 0 0.7rem; font-size: 0.8125rem; border-radius: 8px; }
.ui-input--md { height: 2.5rem; padding: 0 0.85rem; }
.ui-input--has-icon { padding-left: 2.25rem; }
.ui-input--select { appearance: none; padding-right: 2.25rem; cursor: pointer; }
textarea.ui-input { height: auto; min-height: 6rem; padding: 0.65rem 0.85rem; line-height: 1.55; resize: vertical; }
.ui-field-icon { position: absolute; left: 0.75rem; color: var(--ink-3); pointer-events: none; display: inline-flex; }
.ui-field-chevron { position: absolute; right: 0.75rem; color: var(--ink); pointer-events: none; display: inline-flex; }

/* ─── Checkbox & switch ─── */
.ui-check { appearance: none; flex: none; display: inline-grid; place-items: center; width: 1.15rem; height: 1.15rem; margin: 0; border: 2px solid var(--line); border-radius: 5px; background: var(--sunken); cursor: pointer; transition: background-color 100ms ease, transform 100ms var(--ease-press); }
.ui-check::after { content: ""; width: 0.62rem; height: 0.36rem; border-left: 2.5px solid var(--on-mustard); border-bottom: 2.5px solid var(--on-mustard); transform: translateY(-1px) rotate(-45deg) scale(0); transition: transform 140ms var(--ease-press); }
.ui-check:checked { background: var(--mustard); box-shadow: 2px 2px 0 var(--shadow-ink); }
.ui-check:checked::after { transform: translateY(-1px) rotate(-45deg) scale(1); }
.ui-check:active { transform: scale(0.92); }
.ui-check:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 3px; }
.ui-check:disabled { opacity: 0.45; cursor: not-allowed; }
.ui-switch { position: relative; flex: none; width: 2.6rem; height: 1.5rem; border: 2px solid var(--line); border-radius: 999px; background: var(--sunken); cursor: pointer; transition: background-color 140ms ease; }
.ui-switch::after { content: ""; position: absolute; top: 1px; left: 1px; width: 1.05rem; height: 1.05rem; border: 2px solid var(--line); border-radius: 999px; background: var(--panel); box-shadow: 1px 1px 0 var(--shadow-ink); transition: transform 180ms var(--ease-press); }
.ui-switch[aria-checked="true"] { background: var(--green); }
.ui-switch[aria-checked="true"]::after { transform: translateX(1.1rem); }
.ui-switch:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 3px; }
.ui-switch:disabled { opacity: 0.45; cursor: not-allowed; }

/* ─── Kbd ─── */
.ui-kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5rem; height: 1.5rem; padding: 0 0.4rem; border: 1.5px solid var(--line); border-bottom-width: 3px; border-radius: var(--r-sm); background: var(--panel); color: var(--ink); font-family: var(--font-mono); font-size: 0.6875rem; font-weight: 600; line-height: 1; }

/* ─── Tooltip ─── */
.ui-tooltip { position: absolute; z-index: 60; pointer-events: none; display: inline-flex; align-items: center; gap: 0.5rem; width: max-content; max-width: 18rem; padding: 0.4rem 0.6rem; border-radius: 8px; background: var(--ink); color: var(--on-ink); font-size: 0.75rem; font-weight: 500; line-height: 1.35; box-shadow: 3px 3px 0 var(--mustard); animation: ui-pop 120ms var(--ease-press) both; }
.ui-tooltip .ui-kbd { background: transparent; color: var(--on-ink); border-color: color-mix(in srgb, var(--on-ink) 60%, transparent); height: 1.25rem; min-width: 1.25rem; }
.ui-tooltip--top { bottom: calc(100% + 10px); left: 50%; translate: -50% 0; }
.ui-tooltip--bottom { top: calc(100% + 10px); left: 50%; translate: -50% 0; }
.ui-tooltip--left { right: calc(100% + 10px); top: 50%; translate: 0 -50%; }
.ui-tooltip--right { left: calc(100% + 10px); top: 50%; translate: 0 -50%; }

/* ─── Overlays ─── */
.ui-scrim { position: fixed; inset: 0; background: var(--scrim); animation: ui-fade 160ms ease both; }
.ui-scrim[data-state="closing"] { animation: ui-fade-out 160ms ease both; }
.ui-modal { animation: ui-pop 180ms var(--ease-press) both; box-shadow: var(--shadow-lg); }
.ui-modal[data-state="closing"] { animation: ui-pop-out 140ms ease-in both; }
.ui-drawer { animation: ui-drawer-in 240ms var(--ease-press) both; box-shadow: -4px 0 0 var(--shadow-ink); }
.ui-drawer[data-state="closing"] { animation: ui-drawer-out 180ms ease-in both; }

/* ─── Menu, banner, hatch ─── */
.ui-menu { position: absolute; z-index: 55; border: 2px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--ink); box-shadow: var(--shadow-lg); animation: ui-pop 140ms var(--ease-press) both; }
.ui-menu__item { display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 2.25rem; padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.8125rem; text-align: left; cursor: pointer; transition: background-color 100ms ease; }
.ui-menu__item:hover,
.ui-menu__item:focus-visible { background: color-mix(in srgb, var(--mustard) 26%, var(--panel)); outline: none; box-shadow: inset 0 0 0 2px var(--focus); }
.ui-menu__item[aria-checked="true"],
.ui-menu__item[aria-current="true"] { background: var(--sunken); }
.ui-banner { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.6rem 0.75rem; border: 2px solid var(--line); border-radius: var(--r-btn); font-size: 0.8125rem; line-height: 1.45; }
.ui-banner--error { background: color-mix(in srgb, var(--red) 12%, var(--panel)); color: var(--red-text); box-shadow: inset 4px 0 0 var(--red); }
.ui-banner--warn { background: color-mix(in srgb, var(--orange) 12%, var(--panel)); color: var(--orange-text); box-shadow: inset 4px 0 0 var(--orange); }
.ui-banner--info { background: color-mix(in srgb, var(--cobalt) 10%, var(--panel)); color: var(--ink); box-shadow: inset 4px 0 0 var(--cobalt); }
.ui-hatch { background-image: repeating-linear-gradient(135deg, var(--hair) 0 2px, transparent 2px 9px); }

/* ─── Animations ─── */
@keyframes ui-spin { to { transform: rotate(360deg); } }
@keyframes ui-ping { 0% { transform: scale(0.6); opacity: 0.9; } 80%, 100% { transform: scale(1.35); opacity: 0; } }
@keyframes ui-pop { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes ui-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ui-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ui-pop-out { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(4px) scale(0.985); } }
@keyframes ui-panel-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ui-drawer-in { from { transform: translateX(104%); } to { transform: translateX(0); } }
@keyframes ui-drawer-out { from { transform: translateX(0); } to { transform: translateX(104%); } }
@keyframes toast-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

Bu sınıflarla düz HTML örneği:

```html
<html class=""> <!-- gece için class="night" -->
<body>
  <section class="ui-panel ui-panel--raised">
    <header class="ui-panel__head">
      <span class="ui-panel__icon" aria-hidden="true">⚡</span>
      <h3 class="ui-panel__title">Agent budget</h3>
    </header>
    <div style="padding: 1rem">
      <p class="t-label">Mono label · tracked caps</p>
      <span class="ui-pill ui-pill--md" style="background: var(--cobalt); color: var(--on-cobalt); box-shadow: 2px 2px 0 var(--shadow-ink); font-weight: 700">Upgrades</span>
      <span class="ui-pill ui-pill--sm" style="background: var(--panel)"><span class="ui-dot ui-dot--live" style="--dot: var(--orange)"></span>Running</span>
      <button type="button" class="ui-chip ui-focus" aria-pressed="true">High priority <span class="ui-chip__count">3</span></button>
      <span class="ui-field-wrap"><input class="ui-input ui-input--md" placeholder="Search tasks…"></span>
      <button type="button" class="ui-btn ui-focus ui-btn--primary ui-btn--md">New task</button>
      <button type="button" class="ui-btn ui-btn--icon ui-focus ui-btn--secondary ui-btn--md" aria-label="Close" title="Close">×</button>
    </div>
  </section>
</body>
</html>
```

### 10b. Tailwind v4 `@theme` eşlemesi (projede kullanıldığı haliyle)

`globals.css`'in en üstü. `inline` anahtar kelimesi `var()` referansını korur, böylece yardımcılar etkin temayı izler (`bg-paper`, `text-ink`, `border-line`, `rounded-panel`, `shadow-hard` …). Tokenların kendisi (`:root` / `html.night`) §10a'daki gibi ayrıca tanımlanmalıdır. PostCSS eklentisi `@tailwindcss/postcss`.

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--paper);
  --color-foreground: var(--ink);

  --color-paper: var(--paper);
  --color-panel: var(--panel);
  --color-sunken: var(--sunken);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-line: var(--line);
  --color-hair: var(--hair);
  --color-mustard: var(--mustard);
  --color-mustard-press: var(--mustard-press);
  --color-cobalt: var(--cobalt);
  --color-orange: var(--orange);
  --color-red: var(--red);
  --color-green: var(--green);

  --radius-panel: var(--r-panel);
  --radius-btn: var(--r-btn);
  --radius-pill: var(--r-pill);

  --shadow-hard: var(--shadow);
  --shadow-hard-hover: var(--shadow-hover);
  --shadow-hard-press: var(--shadow-press);
  --shadow-hard-lg: var(--shadow-lg);

  --font-display: var(--font-jost), "Futura", "Century Gothic", ui-sans-serif, system-ui, sans-serif;
  --font-sans: var(--font-jost), "Futura", "Century Gothic", ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains-mono), ui-monospace, "SFMono-Regular", Menlo, monospace;
}
```

```js
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

Notlar:
- `--on-*`, `--*-text`, `--shadow-ink`, `--scrim` ve `--r-sm` Tailwind temasına eşlenmemiş. Kodda keyfi değerle kullanılıyorlar: `text-[var(--on-mustard)]`, `text-[var(--cobalt-text)]`, `shadow-[2px_2px_0_var(--shadow-ink)]`.
- `@theme` içindeki `--font-*` yığınları `--font-jost` ve `--font-jetbrains-mono` değişkenlerine dayanır. Next.js dışında bu ikisini kendiniz tanımlayın (§10a'nın ilk bloğu).
- Bileşen sınıflarını `@layer components { … }` içine, odak güvenlik ağını `@layer base { … }` içine koyun (kaynaktaki gibi). Böylece Tailwind yardımcıları onları ezebilir.

### 10c. Fontlar

**Next.js** (projedeki hali, `app/layout.tsx`):

```tsx
import { Jost, JetBrains_Mono } from "next/font/google";

const jost = Jost({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-jost",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// <html className={`${jost.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
```

**Next.js dışı** (uyarlama, aynı aileler ve ağırlıklar). Jost için 400–800 normal ve italik. JetBrains Mono Next'te ağırlık belirtilmeden (değişken font) yükleniyor. CSS'te kullanılan en yüksek mono ağırlık 800, bu yüzden 400..800 aralığı yeter.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,400..800;1,400..800&family=JetBrains+Mono:wght@400..800&display=swap" rel="stylesheet">
```

Ardından §10a'daki `--font-jost: "Jost"; --font-jetbrains-mono: "JetBrains Mono";` tanımları gerekir.

### 10d. AI ajanı için uygulama kontrol listesi

1. **Tokenları kopyala.** §10a'daki `:root`, `html.night` ve ortak geometri bloklarını hiçbir hex'i değiştirmeden ekle. Tailwind v4 kullanılıyorsa §10b'deki `@theme inline` bloğunu da ekle.
2. **Kök fontu 14px yap** (`html, body { font-size: 14px; line-height: 1.55 }`). Ya da bütün rem ölçülerini 14 ile çarpıp px'e çevir. İkisini karıştırma.
3. **Fontları yükle** (§10c). Arayüz Jost. ID, sayı, maliyet, zaman, log ve `t-label` JetBrains Mono.
4. **Tema:** krem varsayılan. Gece için `<html>`'e `night` sınıfı ekle. `localStorage.theme` değerlerini `cream`/`night` olarak sakla. §2.6'daki boot script'i `<head>`'de boyamadan önce çalıştır.
5. **Her yüzeye 2px `var(--line)` kenar ve blur'süz sert gölge** ver. Panel, kart ve buton `var(--shadow)` alır, overlay ve menü `var(--shadow-lg)` alır. Bulanık gölge, backdrop-blur ve yumuşak gradient kullanma.
6. **Hover ve basma davranışını uygula** (§4.4): hover'da `translate(-1px,-1px)` ve 4px gölge, basınca `translate(2px,2px)` ve 1px gölge (40ms). Eğri `var(--ease-press)`.
7. **Renk rolleri:** birincil eylem ve aktif durum hardal (`--on-mustard` metin). Bölüm etiketleri, bilgi ve odak kobalt. Hata kırmızı, çalışan iş turuncu, başarı yeşil. Küçük renkli metinde `--*-text`, dolgu üstü metinde `--on-*` kullan. Durumlar için §2.4'teki `STATUS_COLOR` eşlemesini kullan.
8. **Köşeler:** panel 14px, buton ve girdi 10px (sm 8px), pil 999px, kart ve menü 12px.
9. **Odak:** her etkileşimli öğede `outline: 2.5px solid var(--focus)` (offset 3px, raised öğelerde gölgenin dışında). Güvenlik ağı kuralını ekle.
10. **Bileşenler:** buton (4 varyant, 3 boyut), IconButton (kare, `aria-label` zorunlu), Chip (seçili = mürekkep plaka ve hardal gölge), SectionPill ve StatusPill, Segmented (`radiogroup`, aktif hardal), Tabs (klasör sekmesi, hardal şapka), Input (sunken, odakta panel) ve Panel (başlıkta hardal ikon plakası). Tarifler §5'te.
11. **Overlay'ler:** scrim `var(--scrim)`. Modal pop girişi 180ms, çıkışı 140ms. Drawer sağdan 240ms girer, 180ms çıkar. Odak tuzağı kur, odağı geri ver, Esc yalnızca en üst katmanı kapatsın.
12. **Boş durumlar:** kesik kenarlı kutu, `.ui-hatch` taraması, kalın başlık ve soluk ipucu.
13. **Hareket:** süreleri §7.2'den al. `prefers-reduced-motion` bloğunu mutlaka ekle.
14. **Kâğıt dokusu:** `body::before` gürültü katmanını ve `body { position: relative; isolation: isolate; }` kuralını ekle.
15. **3D gerekiyorsa** §8.8'i uygula: renkleri tokenlardan oku, toon malzeme ve 3 adımlı gradyan kullan, `Outlines` kontur ekle, `flat` aç, DPR'ı sınırla, frameloop'u görünürlüğe bağla ve 2D yedek göster.
16. **Kontrol et:** iki temada ekran görüntüsü al. Küçük metinlerde ≥4.5:1 kontrastı doğrula. Gecede gölgelerin `--shadow-ink` (`#b9ae97`) olduğunu ve parlamadığını kontrol et.

---

## 11. Bilinen boşluklar ve uyarılar

- **Boşluk, boyut ve font-size tokenı yok.** Boşluk Tailwind'in varsayılan ölçeğinden geliyor (1 adım = 0.25rem = 3.5px, kök 14px yüzünden). Font boyutları `t-*` sınıfları ve keyfi px değerleriyle veriliyor.
- **Kök font 14px.** Tailwind'in rem tabanlı bütün ölçüleri (`h-16`, `text-xs` …) varsayılan 16px'e göre %12.5 daha küçük çıkar. Taşırken buna dikkat edin.
- **Özel breakpoint yok.** Mobilde yalnızca kabuk uyarlanır (ray katmanı, ikon arama); board sütunları yatay kayar, ayrı bir mobil board tasarımı yok.
- **Sistem temasına göre otomatik seçim yok.** `prefers-color-scheme` okunmuyor, varsayılan her zaman krem.
- **Bazı köşe yarıçapları token değil, sabit.** `12px`, `8px`, `9px`, `11px` ve `5px` değerleri sınıflarda doğrudan yazılı. Yalnızca `--r-panel`, `--r-btn`, `--r-pill` ve `--r-sm` token. `--r-sm` Tailwind temasına eşlenmemiş.
- **Gradient tamamen yasak değil.** Sert duraklı desenler (tarama, nokta ızgara, fosforlu kalem) ve ajan çekirdeğinin yumuşak `radial-gradient` halesi kodda var.
- **3D'de yumuşak gölge var.** `ContactShadows` (blur 2.2/2.4) ve `Blob` dokusu, 2D'deki "blur yok" kuralının istisnası.
- **Plan ve kod ayrışmaları (kod esas alındı):**
  - Gece `--ink-3`: plan §3'te `#8E8471`, §11'in Faz 1 notunda `#968C78`, kodda `#9d937f`.
  - Gölge: plan `--shadow: 3px 3px 0 var(--line)` diyor, kod `var(--shadow-ink)` kullanıyor (gecede `#b9ae97`).
  - Fabrika istasyon renkleri landing'de (todo kobalt) ve board'da (todo ink-3) farklı.
- **Bileşenlerin uygulamaya bağımlılıkları var.** `Modal`, `Drawer` ve `Toast`, `useTranslation` (kapat/gizle metinleri) ve `useToastStore` (zustand) kullanıyor. Taşırken bunları kendi i18n ve store çözümünüzle değiştirin.
