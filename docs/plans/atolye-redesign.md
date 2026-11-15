# ClauFlow "Atölye" yeniden tasarımı: çalışma planı

> Bu dosya hem plan hem de gece çalışmasının durum kaydıdır. Her loop turu
> bu dosyayı okur, sıradaki işaretsiz adımı yapar ve ilerlemeyi buraya yazar.

## Sabah raporu

_(Tüm fazlar bitince ya da çalışma durunca burası doldurulacak: ne yapıldı, ne
yapılamadı, nereye bakmalı, ekran görüntüleri nerede.)_

---

## 1. Onaylanan kararlar (2026-11-15, Furkan)

- Plan onaylandı. Kapsam: `gui/` arayüzünün tamamının yeniden tasarlanması ve 3D eklenmesi.
- **Tema:** Varsayılan krem kâğıt. Ayrıca aynı dilde koyu bir "gece vardiyası" varyantı.
- **3D:** Landing'deki "Ajan Fabrikası" ve board'daki **Fabrika görünümü**. Board varsayılan olarak 2D kalır. Üst barda küçük bir "ajan çekirdeği" olur.
- **Referans:** Kullanıcının verdiği oyun arayüzü görseli. Yalnızca **görsel dil** alınır (krem zemin, kalın mürekkep kenar, sert gölge, hardal butonlar, kobalt etiket pilleri). Herhangi bir oyunun içeriği, adı veya sanatı kopyalanmaz.
- **Yerleşim:** Jira ve Trello'dan esinlenilir.
- **Backend:** Bu plan kapsamında **dokunulmaz**. Bkz. §9.

## 2. Gece çalışma kuralları (otonom mod)

1. **Soru sorma.** Bir karar belirsizse bu plana en yakın seçeneği seç ve §11 "Kendi kararlarım" bölümüne bir satır yaz.
2. **Dal:** Tüm iş `redesign/atolye` dalında yapılır. `master`a commit atma, **push etme, merge etme, PR açma.**
3. **Commit:** Her faz sonunda bir commit atılır. Biçim: `feat(gui): faz N - <özet>` ve ardından `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Faz büyükse ara commit atılabilir.
4. **Paket yöneticisi:** `gui/` için yalnızca `npx -y pnpm@11.0.9 ...` kullanılır. Global pnpm kurulmaz. `core/` npm ile çalışır, ona dokunulmaz.
5. **Dev sunucular:** Çalışmıyorlarsa arka planda başlatılır.
   - `cd core && npm run dev` (3001)
   - `cd gui && npx -y pnpm@11.0.9 dev` (3000)
6. **Ürün tetikleme yasak:** Test ederken bir kartı **DOING**'e taşıma ve **Review → Done** yapma. Bunlar gerçek `claude` ajanını çalıştırır, push eder ve PR merge eder. Gerçek GitHub reposu da klonlama.
   - Sürükle-bırak testi için uzaksız (remote'suz) yerel bir test reposu kullanılır: `/home/furkanasikdev/Projects/ClauFlow-sandbox`. Yoksa `git init` ile oluşturulur.
   - Testlerde yalnızca TODO içi sıralama ve izin verilmeyen geçişin onay penceresi denenir.
7. **Takılma:** Bir adımda iki deneme başarısız olursa adımı §10 "Takılanlar"a yaz ve sıradakine geç.
8. **Doğrulama:** Her adımdan sonra `npx -y pnpm@11.0.9 typecheck` çalışır. Her faz sonunda ayrıca `lint` çalışır. Faz 5'te `build` de çalışır. Kırmızıyla faz kapatılmaz.
9. **Ekran görüntüleri:** Her faz sonunda alınır ve repo dışına kaydedilir: `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/faz-N-<ekran>.png`. Hem krem hem gece teması çekilir.
   - Komut: `chromium --headless=new --disable-gpu --hide-scrollbars --window-size=1600,1000 --virtual-time-budget=8000 --screenshot=<yol> <url>`
   - Etkileşim gerekiyorsa Playwright kullanılır.
10. **Bitiş:** Tüm fazlar bitince "Sabah raporu" doldurulur ve loop durdurulur.
11. **Kota:** Claude kotası biterse durulur. Kalınan yer §12 "İlerleme günlüğü"ne yazılır.

## 3. Tasarım dili: tokenlar

`globals.css` içinde `:root` (krem) ve `html.night` (gece) olarak tanımlanır.

Mevcut `html.light` mekanizması tersine çevrilir: varsayılan krem olur, `night` sınıfı koyu temayı açar. Kullanıcının mevcut `localStorage.theme` değeri yeni değerlere taşınır.

| Token | Krem | Gece | Kullanım |
|---|---|---|---|
| `--paper` | `#F4ECDA` | `#17140F` | sayfa zemini |
| `--panel` | `#FBF6EA` | `#221E17` | kartlar, paneller |
| `--sunken` | `#EADFC6` | `#100E0A` | girdi alanları, boş slotlar, gösterge yuvaları |
| `--ink` | `#1B1712` | `#F4ECDA` | ana metin, kenarlıklar |
| `--ink-2` | `#4A4237` | `#CFC4AE` | ikincil metin |
| `--ink-3` | `#7D7364` | `#8E8471` | soluk metin, pasif noktalar |
| `--line` | `#1B1712` | `#E9DFC9` | 2px kalın kenarlık |
| `--hair` | `#1B171226` | `#F4ECDA22` | ince ayraçlar |
| `--mustard` | `#F2C33D` | `#F2C33D` | ana buton, aktif segment |
| `--mustard-press` | `#D9A923` | `#D9A923` | buton basılı hali |
| `--cobalt` | `#2D5BE3` | `#5B82F0` | bölüm etiket pilleri, bilgi, CI |
| `--orange` | `#EE7B2C` | `#F08A42` | aktif ajan, uyarı, sol kenar vurgusu |
| `--red` | `#C8372D` | `#E2574C` | tehlikeli eylem, hata |
| `--green` | `#3E9B5A` | `#5BB877` | done, başarı |

- **Gölge:** `--shadow: 3px 3px 0 var(--line)`. Hover'da `4px 4px 0`. Basılıyken `1px 1px 0` ve `translate(2px,2px)`.
- **Köşe:** panel ve kart 14px, buton 10px, pil 999px.
- **Fontlar** `next/font/google` ile yüklenir:
  - **Jost** (400–800): arayüz ve başlıklar
  - **JetBrains Mono**: ID'ler, loglar, sayılar
  - Fraunces ve Geist kaldırılır.
- **Durum renkleri:** todo `--ink-3`, doing `--orange`, ci `--cobalt`, review `--mustard`, done `--green`, nothing `--ink-3` (taralı), error `--red`.
- **Öncelik:** low ve medium, high ve critical. Kaç dolu çentikle gösterileceği, örnekteki "▲▲" gibi, uygulamada karara bağlanır.
- **Grain:** Kâğıt dokusu çok hafif (opacity ≤ 0.05) kalabilir. `body > * { z-index:2 }` hack'i kaldırılır, doku `pointer-events:none` sabit bir katmana taşınır.
- **Eski isimler:** Mevcut `--bg-*`, `--text-*`, `--accent-*`, `--status-*` isimleri geçiş süresince yeni tokenlara alias'lanır. Böylece henüz elden geçmemiş ekranlar kırılmaz. Faz 5'te kullanılmayan alias'lar silinir.

## 4. Temel bileşenler (`components/ui/`)

Hepsi tokenları kullanır. Arbitrary renk (`text-[#..]`) ve ham Tailwind paleti (`rose-500` vb.) yasaktır.

- `Button`: varyantlar `primary` (hardal), `secondary` (panel + kenar), `ghost`, `danger` (kırmızı metin). Boyutlar sm/md/lg. İsteğe bağlı ikon, `loading` durumu, basınca gömülme.
- `IconButton`: kare, kenarlı. Örnekteki "×" gibi.
- `SectionPill`: kobalt etiket ("Upgrades" stili).
- `StatusPill`: ikon/nokta ve metin, durum renkleriyle ("Waiting for…" stili).
- `Chip`: filtre çipi, seçilebilir.
- `Segmented`: sarı aktif segment ve isteğe bağlı sayaç ("Outgoing 1 | Incoming 2").
- `Panel` / `Tile`: kenarlı kart. Başlık, ikon ve sağ üst noktalı ölçer içerebilir.
- `DotMeter`: `●●●○○`. `value/max`, renk ve boyut alır.
- `RingGauge`: dairesel ilerleme, merkezde ikon/değer, altında etiket ("4 / min" stili).
- `Tabs`
- Girdiler: `Input`, `Textarea`, `Select`
- `Kbd`
- `Tooltip`
- `Avatar`: ajan veya kullanıcı.
- Mevcut bileşenler yeniden giydirilir: `Modal`, `ConfirmDialog`, `Toast`, `Badge`. Prop API'leri **korunur**.
- Yeni `Drawer`: sağdan açılan, bölünmüş panel.
- `/styleguide` rotası: tüm bileşenler, iki tema yan yana. Geliştirme aracıdır, navigasyonda görünmez.

## 5. Yerleşim

- **Sol ray** (genişletilebilir/daraltılabilir):
  - Logo
  - Proje değiştirici (arama ve git dal/kirli durumu)
  - Görünümler: **Board / Liste / Fabrika (3D) / PR'lar / İstatistikler**
  - GitHub repoları (klonla)
  - "+ Yeni proje"
- **Üst bar:**
  - Breadcrumb
  - Hızlı filtre çipleri: öncelik, etiket, "ajan çalışıyor", "PR açık"
  - Arama (`/`)
  - Canlı/çevrimdışı durum pili
  - Ajan çekirdeği (3D mini)
  - Bildirimler
  - Ön koşul göstergesi
  - TR/EN
  - Tema
  - GitHub kullanıcısı
- **Board:**
  - Trello tarzı sütunlar: başlıkta durum pili, sayaç ve "+".
  - `ci` ve `nothing` sütunları daraltılmış başlar. Bu davranış korunur, daraltılmış sütun dikey bir şerit olarak görünür.
  - Board istatistikleri üstte küçük panel şeklinde: toplam, done, ilerleme `RingGauge` ile.
- **Kart:**
  - Öncelik şeridi
  - `CLF-87` anahtarı
  - Başlık
  - Açıklama (2 satır)
  - Etiket çipleri
  - Alt görev sayısı
  - CI ve PR rozetleri
  - **Maliyet** (yeni; `lib/cost.ts`)
  - Ajan çalışırken turuncu sol kenar ve canlı adım `StatusPill`'i (branching → running → pushing → pr_opening)
  - Kuyrukta bekleyen için iptal butonu
- **Liste görünümü** (yeni, yalnızca arayüz): Jira tarzı tablo. Anahtar, başlık, durum, öncelik, maliyet, PR. Satıra tıklayınca detay açılır. Yeni veri gerektirmez, store'daki `tasks` kullanılır.
- **Görev detayı:** Sağdan açılan `Drawer` (yaklaşık %55 genişlik), board arkada görünür.
  - Sekmeler: Detay / Log / Akış / Yorumlar.
  - Mevcut tüm bölümler korunur: Parent, Description, Analysis, Subtasks, Execution Mode, Priority, Retry/Abort, Branch/PR, Break down, Budget.
  - Bütçe `DotMeter` ve `RingGauge` ile gösterilir.
- **Diğer ekranlar** aynı dille yeniden giydirilir: AddTask, ImportIssues, NewProject, CloneRepo, GithubConnect, ProjectDetailDrawer, ClaudeConfigTab, Studio (React Flow düğümleri panel stilinde), SkillsManager, PR sayfası ve PRDetailDrawer, Insights, NotificationPopover, PrereqIndicator.
- **Landing (`/`):** Yeni kopya ve düzen. Hero'da 3D Ajan Fabrikası, "nasıl çalışır" bölümünde 3 adım ve CTA'lar. Landing'deki sabit metinler i18n'e taşınır.

## 6. 3D (Three.js + React Three Fiber)

- **Bağımlılıklar:** `three`, `@react-three/fiber` (v9, React 19), `@react-three/drei`, `@types/three`. Kurulumda o anki kararlı sürümler kullanılır.
- **Ortak ilkeler:**
  - Tüm 3D bileşenler `next/dynamic` ile `ssr:false` yüklenir.
  - Malzeme toon-shading. Kalın siyah kontur için drei `<Outlines>` kullanılır, böylece 2D dille aynı görünür.
  - Renkler token hex'lerinden gelir ve tema değişince güncellenir.
  - Performans:
    - DPR en fazla `[1, 1.75]`.
    - Sekme gizliyse veya sahne görünmüyorsa `frameloop` durur (IntersectionObserver ve `visibilitychange`).
    - `prefers-reduced-motion` açıksa animasyon durur, statik bir kare gösterilir.
  - WebGL yoksa SVG/2D yedek gösterilir.
- **Landing "Ajan Fabrikası":**
  - Kâğıt bir zemin üstünde 4 istasyon: TODO, DOING, REVIEW, DONE.
  - Kutular (görevler) konveyör üzerinde ilerler.
  - DOING'de bir robot kol/drone (ajan) kutuyu işler: kıvılcım, dönen dişli.
  - REVIEW'da bir göz/büyüteç tarar.
  - DONE'da "PR" damgası basılır, kutu paketlenir.
  - Kamera scroll ile ilerler, fareyle hafif paralaks var.
  - Tamamen prosedürel geometri kullanılır. Dış model dosyası yok.
- **Fabrika görünümü** (`/board?view=factory` veya görünüm seçicisi):
  - Gerçek board'un canlı 3D hali. Sütunlar istasyon, görevler kutu olur. Kutu etiketinde anahtar ve başlık yazar (drei `Text`/`Html`).
  - WebSocket'ten gelen store değişiklikleri sahneyi sürer:
    - `agent.status` running iken makine çalışır.
    - Durum değişince kutu bir istasyondan diğerine animasyonla geçer.
    - Hata olunca kırmızı alarm yanar.
    - `budget_exceeded` gelince duman çıkar.
  - Kutuya tıklamak detay Drawer'ını açar. Hover'da tooltip görünür.
  - Fabrika görünümünde sürükle-bırak **yoktur**; durum değişiklikleri 2D board'dan yapılır.
- **Ajan çekirdeği** (üst bar, ~36px): Çalışan ajan sayısına göre dönen ve parlayan küçük bir obje. Ajan yokken yavaş "nefes alır".
- **Mikro animasyonlar** (CSS ve küçük JS):
  - Kart hover'da kalkar, gölge büyür.
  - Sürüklenen kart 2–3° eğilir.
  - DONE'a düşen kartta kısa bir parça patlaması olur.
  - Butonlar basılınca gömülür.
  - Drawer ve modal giriş/çıkış animasyonları.

## 7. Dokunulmayacaklar ve korunacak davranışlar

- `core/` backend'i.
- `store/boardStore.ts`'in veri mantığı, `lib/api.ts` ve `hooks/useAgentSocket.ts`'in olay işleme mantığı. Yalnızca arayüz tarafında yeni seçiciler eklenebilir.
- dnd-kit:
  - `PointerSensor distance:6`
  - `ALLOWED_TRANSITIONS` ve onay penceresi
  - Kart üstüne yayılmış `listeners` ve iç butonlardaki `stopPropagation`
  - Daraltılmış sütunun `setNodeRef`'i
  - `over.data.current.status`
- React Flow: `@xyflow/react/dist/style.css` import'u, handle sınıfları, `elementFromPoint(...).closest("[data-id]")` ile skill bırakma, tuvalin sabit yükseklikli ebeveyni.
- Klavye kısayolları: N, /, ?, Esc.
- localStorage anahtarları: `board-collapsed-cols`, `theme` (değerler taşınacak), `lang`, `notif-*`.
- i18n anahtarları. Yeni metinler hem `tr.ts` hem `en.ts`'e, tip de `types.ts`'e eklenir. Dokunulan sabit metinler i18n'e taşınır.
- `window.confirm` kullanılmaz, `ConfirmDialog` kullanılır.

## 8. Fazlar

### Faz 0: Hazırlık
- [x] `redesign/atolye` dalını aç. Mevcut iki commit edilmemiş dosyayı ilk commit'e al: `core/package-lock.json` ve `gui/pnpm-workspace.yaml`. Ayrı bir `chore` commit'i at.
- [x] 3D bağımlılıklarını ekle. typecheck yeşil olmalı.
- [x] `ClauFlow-sandbox` test reposunu ve içinde birkaç örnek görev oluştur. Remote olmayacak. Görevler API veya arayüz üzerinden açılır, DOING'e taşınmaz.
- [x] "Önce" ekran görüntülerini al: landing, board (dolu), detay, studio, PR'lar, insights.

### Faz 1: Tasarım sistemi
- [x] Tokenlar (§3): krem ve gece temaları, eski isimlere alias'lar, tema geçişi ve `localStorage.theme` taşıma. Header ve landing'deki tekrarlanan toggle tek bir hook'a (`useTheme`) alınır.
- [x] Fontlar: Jost ve JetBrains Mono.
- [x] §4'teki bileşenler.
- [x] `/styleguide` sayfası.
- [x] Faz sonu: lint, ekran görüntüleri, commit.

### Faz 2: İskelet ve Board
- [x] Sol ray ve üst bar. Görünüm seçici; Fabrika ve Liste şimdilik yer tutucu.
- [x] Board sütunları, daraltılmış sütun şeridi ve istatistik paneli.
- [x] TaskCard: §5'teki içerik ve maliyet.
- [x] Hızlı filtre çipleri (yalnızca arayüz tarafında filtreleme).
- [x] Liste görünümü.
- [x] Sürükle-bırak testi (Playwright, sandbox): TODO içi sıralama ve izin verilmeyen geçişte onay penceresi.
- [x] Faz sonu: lint, ekran görüntüleri, commit.

### Faz 3: Detay ve diğer ekranlar
- [x] TaskDetail → sağdan açılan Drawer. Tüm sekmeler ve bölümler. ToolCallTimeline, MiniDagView, CommentsTab.
- [x] Modallar: AddTask, ImportIssues, NewProject, CloneRepo, GithubConnect, ConfirmDialog, Toast, AgentBadge log modalı.
- [x] ProjectDetailDrawer ve ClaudeConfigTab (tam ekran editör portalı dahil).
- [x] Studio: tuval, AgentNode, Skills/Agents yan panelleri, NodeRunPanel, AgentEditDrawer, Toolbar, SkillsManagerModal.
- [x] PR sayfası ve PRDetailDrawer.
- [x] Insights.
- [x] NotificationPopover ve PrereqIndicator.
- [x] Faz sonu: lint, her ekran için iki temada ekran görüntüsü, commit.

### Faz 4: 3D
- [x] Ortak 3D altyapısı: dinamik yükleme, görünürlük ve reduced-motion denetimi, tema renkleri, WebGL yedeği.
- [x] Landing Ajan Fabrikası ve yeni landing düzeni.
- [ ] Board Fabrika görünümü, store'a bağlı.
- [ ] Üst bar ajan çekirdeği.
- [ ] Mikro animasyonlar (§6).
- [ ] Faz sonu: lint, ekran görüntüleri (`--use-gl=angle --use-angle=swiftshader` ile), commit.

### Faz 5: Cila ve doğrulama
- [ ] Erişilebilirlik:
  - Odak halkaları
  - Kontrast: metin/zemin en az 4.5:1. Hardal üstüne mürekkep yazı kullanılır.
  - Klavye ile gezinme
  - İkon butonlarında `aria-label`
- [ ] Kullanılmayan eski alias'ları, Fraunces/Geist kalıntılarını ve ölü CSS'i temizle.
- [ ] `typecheck`, `lint` ve `build` yeşil.
- [ ] Önce/sonra karşılaştırma görüntüleri.
- [ ] README'deki ekran ve stil anlatımını ve `.env.local` örneğini düzelt. Doğrusu: `NEXT_PUBLIC_API_BASE=http://localhost:3001/api`, `NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws`.
- [ ] Sabah raporunu yaz. Loop'u durdur.

## 9. Backend soruları ve istekleri

_(Furkan buraya ekleyecek. Bu bölüm dolup onaylanmadan `core/`a dokunulmaz.)_

## 10. Takılanlar

_(boş)_

## 11. Kendi kararlarım (otonom çalışırken verilen)

- **Faz 0, chore commit:** `core/package-lock.json` ve `gui/pnpm-workspace.yaml` ayrı bir `chore:` commit'ine alındı (5c8e66e). Plan dosyası (`docs/plans/`) o commit'e değil, Faz 0 commit'ine girdi.
- **Faz 0, 3D sürümleri:** `three@0.187.0`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`, `@types/three@0.187.0` (dev). Kurulum anındaki kararlı sürümler.
- **Faz 0, sandbox projesi:** `/home/furkanasikdev/Projects/ClauFlow-sandbox` `git init -b main` ile açıldı, tek commit (README + `src/index.ts`), remote yok. ClauFlow'a `POST /api/projects` ile `createGithubRepo:false`, `remote:null`, `aiPrompt` **yok** (planner ajanı çalışmasın diye), `slug:"clf"` ile kaydedildi. Proje id: **`proj_c2dd3194`**. Kartlar `CLF-1…CLF-12`.
- **Faz 0, board nasıl dolduruldu:** `core/src/routes/tasks.ts` incelendi: `POST /api/tasks` gövdesinde `status` kabul ediyor ve yalnızca `createTask` + yayın yapıyor. Executor (`status:"doing"`) ve PR merge (`status:"done"`) tetikleyicileri yalnızca `PATCH /api/tasks/:id` içinde. Bu yüzden kartlar **doğrudan hedef sütunda oluşturuldu**, hiçbir PATCH/durum değişikliği yapılmadı. Dağılım: todo 7 (biri 2 alt görevli üst görev), review 2, done 2, nothing 1. `doing` ve `ci` bilerek boş bırakıldı (orphan-recovery ve CI watcher'a takılmasın). Review/done kartlarında `prNumber` yok, yani yanlışlıkla Review→Done yapılsa bile merge çağrılmaz.
- **Faz 0, ekran görüntüsü adları:** Kural 9 iki tema istiyor; mevcut uygulamada temalar `dark` (varsayılan) ve `light`. Adlar `faz-0-once-<ekran>-dark.png` / `-light.png`. Ekranlar: landing, board, detail, studio, prs, insights (12 dosya). Board'da proje URL ile seçilemediği için Playwright ile sidebar'dan tıklandı; tema `localStorage.theme` init script'iyle verildi. Studio: proje menüsü → Detaylar → Claude Config → Studio (yalnızca okuma; kaydetme yok).
- **Faz 0, PR'lar ekranı:** Sandbox'ın remote'u olmadığı için `/github` sayfası "API 422: Bu proje bir GitHub remote'una bağlı değil" hatası gösteriyor. Gerçek repo kullanmak kurallara aykırı olduğu için "önce" görüntüsü bu haliyle alındı. Faz 3'te PR ekranının dolu hali için mock veri veya boş/hata durumu tasarımı düşünülmeli.
- **Faz 0, dev göstergesi:** Görüntülerde sol altta Next.js dev "N" rozeti var; dev sunucusundan geliyor, tasarımın parçası değil.
- **Faz 1, tema değerleri ve taşıma:** `localStorage.theme` artık `cream` | `night`. Eski değerler açık seçim sayıldı: `light` → `cream`, `dark` → `night`; değer yoksa yeni varsayılan krem. Taşıma `<head>` içindeki boot script'inde yapılır (`gui/src/lib/theme.ts`, server layout'tan import edilebilsin diye "use client" dışı). `useTheme` (`hooks/useTheme.ts`) `useSyncExternalStore` ile Header, landing ve styleguide'ı senkron tutar; başka sekmedeki değişiklik `storage` olayıyla gelir. Eski `html.light` sınıfı boot'ta silinir.
- **Faz 1, kontrast için token sapmaları:** `--ink-3` krem `#7D7364` → `#6B6152` (kâğıtta 3.96 → 5.17:1), gece `#8E8471` → `#968C78` (panelde 4.49 → 4.99:1). Spec'teki parlak renkler (hardal, turuncu, yeşil, kırmızı, kobalt) dolgu olarak aynen kaldı; küçük metin için ek `--*-text` tokenları eklendi (krem: `--mustard-text #7F5B00`, `--orange-text #A3460F`, `--green-text #276E3D`, `--red-text #B3302A`, `--cobalt-text #2850C8`; hepsi kâğıt ve sunken üzerinde ≥4.5:1; gecede baz renklerle aynı). Dolgu üstü mürekkep için `--on-*` tokenları: hardal/turuncu/yeşil üstünde her iki temada koyu mürekkep; kobalt/kırmızı üstünde kremde krem, gecede koyu (gece kobaltı üstünde krem 3.0:1 kalıyordu).
- **Faz 1, gece gölgesi:** Spec `--shadow: 3px 3px 0 var(--line)`. Gecede `--line` kremdir; tam krem gölge parlıyordu. Gölge rengi ayrı token oldu (`--shadow-ink`): kremde `--line`, gecede biraz kısık krem `#B9AE97`. Kenarlıklar `--line` olarak kaldı.
- **Faz 1, legacy alias'lar:** Eski isimler `:root, .theme-cream, .theme-night` üzerinde yeni tokenlara bağlandı (alt ağaçta tema zorlanabilsin diye). `--accent-primary` eskiden limon yeşiliydi ve hem metin hem dolgu olarak kullanılıyordu; hardal metin olarak okunmadığı için **kobalt**a bağlandı. Ana buton sınıfı `.btn-ink` ise hardal + mürekkep metin + sert gölge olarak yeniden yazıldı. `--status-review` → `--mustard-text`, `--status-doing` → `--orange-text`, `--status-done` → `--green-text`. `--border` 1px eski ayraçlar için `--line`'ın %24'ü (yumuşak kahve çizgi), `--border-strong` %55'i. Eski `html.light { --color-zinc-* … }` palet override'ları silindi (yalnızca birkaç Studio/detay yerinde ham palet kullanılıyor, Faz 3'te yeniden yazılacak).
- **Faz 1, grain:** `body > * { z-index:2 }` hack'i kaldırıldı. `body` `position:relative; isolation:isolate` ile kendi stacking context'i oldu, doku `body::before` olarak `position:fixed; z-index:-1; pointer-events:none` (kremde multiply 0.045, gecede screen 0.05). Böylece doku kâğıdın üstünde, tüm içeriğin altında.
- **Faz 1, öncelik gösterimi:** Dört çentikli üçgen ölçek (`PriorityMark`): low ▲ (ink-3), medium ▲▲ (kobalt), high ▲▲▲ (turuncu), critical ▲▲▲▲ (kırmızı). Anlamı şekil taşır, renk destekler.
- **Faz 1, bileşen kararları:** `Chip` seçili hali mürekkep plaka + hardal ofset gölge (hardal "aktif segment" için ayrıldı). `Tabs` klasör sekmesi: aktif sekme panel renginde, üstünde hardal şapka. `Button` danger: panelde kırmızı metin, hover'da kırmızıya dolar. Disabled butonlar "mürekkepsiz plaka": sunken zemin, soluk çizgi, gölge yok (yarı saydam hardal gecede çamur gibi görünüyordu). Odak halkası her yerde 2.5px kobalt outline, 3px offset (sert gölgeyle çakışmasın diye box-shadow değil outline). Ek primitive'ler: `Tag` (kaldırılabilir etiket), `Field` (label + hint/error, aria bağlı), `PriorityMark`, ortak ikon seti `components/ui/icons.tsx`, overlay yardımcıları `usePresence` (çıkış animasyonu) ve `useFocusTrap`. `Modal`/`ConfirmDialog`/`Toast`/`Badge` prop API'leri korunarak yeniden giydirildi; `ConfirmDialog`'da odaklı bir butondayken Enter artık iki kez onaylamıyor.
- **Faz 1, `/styleguide`:** Varsayılan iki tema yan yana (`.theme-cream` / `.theme-night` alt ağaçları), `?mode=cream|night` tek tema. Başlıklar i18n'de (`styleguide.*`); örnek içerik (kart başlıkları vb.) sandbox görevleri gibi İngilizce bırakıldı, çünkü geliştirici aracı ve navigasyonda yok. Primitive'lerin ortak metinleri `common.*` anahtarlarına taşındı (kapat, gizle, kaldır, toast etiketleri).
- **Faz 1, `<html lang>`:** `lang` sabit `tr` idi; İngilizce arayüzde CSS `uppercase` "HIGH"ı "HİGH" yapıyordu. `LangHydrator` artık `document.documentElement.lang`'ı store'daki dille eşitliyor. Türkçe arayüzde çevrilmemiş İngilizce sabitler (ör. öncelik adları) hâlâ İ ile büyür; bunlar ilgili ekranlar elden geçerken i18n'e taşınacak.
- **Faz 1, ekran görüntüleri:** `faz-1-<ekran>-{krem,gece}.png`: styleguide (tam sayfa), styleguide-drawer, styleguide-confirm, styleguide-tooltip (toast dahil), board, detail, landing; ayrıca `faz-1-styleguide-yanyana.png`. Board/detail/landing henüz eski düzende ama yeni renk ve fontlarla; kırılma yok, sayfa hatası yok. `CLAUDE.md`'deki "Theme: html.light zinc override" notu artık eski; Faz 5'te README ile birlikte düzeltilecek.
- **Faz 2, kabuk yerleşimi:** Sol ray (`components/Shell/AppRail.tsx`) logo, proje değiştirici, 5 görünüm, GitHub repoları ve "+ Yeni proje" taşır; 76px ikon raya daralır (`localStorage["rail-collapsed"]`, yeni anahtar). Üst bar (`Shell/TopBar.tsx`) breadcrumb, arama (`#board-search`, `/` hâlâ odaklar), canlı/çevrimdışı pili, bildirimler, ENV göstergesi, TR/EN, tema ve GitHub kullanıcısını taşır. Görünüm `Segmented`'i (Board/Liste/Fabrika) ve hızlı filtre çipleri üst barın hemen altındaki board araç çubuğunda: spec çipleri "üst bar"a koyuyordu, ama yalnızca board/liste için anlamlı oldukları ve global barı kalabalıklaştırdıkları için oraya alındı. Eski `Layout/Header.tsx` ve `Sidebar/ProjectSidebar.tsx` silindi; `studioRequest`/`projectDetailRequest` efektleri ve modallar ray'e taşındı. "PR'lar" ve "İstatistikler" mevcut `/github` ve `/insights` sayfalarına gider (o sayfalar Faz 3'te yeni kabuğa alınacak). Ajan çekirdeği (3D) Faz 4'te üst bara eklenecek.
- **Faz 2, UI durumu:** Görünüm, ray ve hızlı filtreler `boardStore`'a değil ayrı, yalnızca arayüz amaçlı `store/viewStore.ts`'e kondu (§7: store veri mantığına dokunulmadı). Görünüm URL'de: `/board?projectId=…&view=list|factory` (board varsayılan, parametre yazılmaz). Filtre/sayaç/maliyet seçicileri saf fonksiyonlar olarak `lib/boardView.ts`'te; Board ve Liste aynı seçicileri kullanır. Arama artık görev anahtarını da (`CLF-3`) eşler.
- **Faz 2, proje değiştirici:** Eski satır satır proje listesi yerine Jira tarzı açılır menü: arama, her projede dal + kirli/temiz noktası (turuncu/yeşil) ve planner durumu; "Detaylar" her satırdaki ⓘ butonuyla açılır. Menü ray'in kaydırma alanının dışına kondu, yoksa kırpılıyordu. GitHub repoları ilk 5 tanesiyle gösterilir, "Tümünü göster (n)" ile açılır (37 repo ray'i dolduruyordu).
- **Faz 2, TODO içi sıralama:** Backend'de sıra alanı yok ve `core/`a dokunulmuyor; önceden aynı sütuna bırakmak hiçbir şey yapmıyordu. Sıralama artık istemci tarafında, proje başına `localStorage["board-order:<projectId>"]` (yeni anahtar) içinde tutuluyor; API çağrısı yok, durum değişmiyor. Sıralanmamış/yeni görevler store sırasıyla sona eklenir. Kalıcı sunucu sırası istenirse §9'a backend isteği olarak yazılmalı. Bu yüzden DnD testindeki "API ile doğrula" adımı: görevlerin durum ve `updatedAt` değerleri testten önce ve sonra birebir aynı, test boyunca hiç PATCH/POST/PUT/DELETE isteği yok; sıranın kalıcılığı sayfa yenilemesiyle doğrulandı.
- **Faz 2, dnd-kit:** `PointerSensor distance:6`, `ALLOWED_TRANSITIONS`, onay penceresi, kart üstüne yayılmış `listeners`, daraltılmış şeridin `setNodeRef`'i ve `over.data.current.status` korundu. Kart sunum katmanı `TaskCardView` olarak ayrıldı; `DragOverlay` artık aynı id ile ikinci bir `useSortable` çağırmıyor. İç butonlar `click`'e ek olarak `pointerdown`'da da `stopPropagation` yapar. Sürükleme sırasında izinli hedef sütun kesik kenarlı, onay gerektiren sütunun üstüne gelince turuncu taralı zemin ve "Onay gerekir" etiketi çıkar.
- **Faz 2, kart (§5):** Sol kenarda 4px öncelik şeridi + sağ üstte `PriorityMark`. Ajan çalışırken öncelik şeridinin yerini yürüyen çizgili turuncu kenar alır, kart hafif turuncuya boyanır ve tam satır bir `StatusPill` (canlı nokta + adım adı + branching→running→pushing→pr_opening için 4 çentikli adım izleyici) gösterilir; tıklayınca log modalı açılır. `AgentBadge` modalı `document.body`'ye portallanıyor (transform'lu kart `fixed` overlay'i hapsediyordu). Maliyet yalnızca token kullanıldıysa görünür (`lib/cost.ts`), bütçe aşılınca kırmızı. Üst görevde alt görev sayacı (`0/2`), alt görevde üst görevin anahtarı. Açık PR kobalt, merge edilmiş PR yeşil pil. Kuyruktaki görevde "Kuyrukta" pili ve × iptal. Hover'da kart 2px kalkar, gölge 3→5px; sürüklenen kopya 2.5° eğilir ve 8/10px gölge alır, yerinde kesik çizgili taralı bir yuva kalır.
- **Faz 2, kart durumları:** Sandbox'ta çalışan/kuyrukta/CI/PR/maliyetli kart üretmek ajanı tetiklemeyi gerektirdiği için bu durumlar `/styleguide`'a "Board kartları" bölümü olarak sahte görevlerle eklendi (`faz-2-card-states-*.png`).
- **Faz 2, filtreler:** Öncelik ve Etiket sayaçlı açılır menü çipleri (çoklu seçim), "Ajan çalışıyor" ve "PR açık" aç/kapa çipleri; aktif filtre varken "Temizle" ve "x / y görev" sayacı görünür. Hiçbir görev eşleşmezse sütunlar yerine boş durum paneli gösterilir.
- **Faz 2, diğer:** İstatistik paneli `RingGauge` (bitti/toplam, yeşil) + Toplam/Bitti/Çalışan/Maliyet. Fabrika görünümü şimdilik basılı bir istasyon önizlemesi olan yer tutucu. Kısayol yardımı `Modal` + `Kbd`'ye taşındı. Board, kart, kabuk ve CI/ajan rozetlerindeki sabit metinler i18n'e alındı (`shell.*`, `board.*`, `taskCard.*`). İlk yüklemede sütunlarda iskelet kartlar görünür. Test ve ekran görüntüsü betikleri repo dışında: `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/scripts/` (`dnd-test.mjs`, `shots-faz2.mjs`); Next.js dev rozeti görüntülerde enjekte edilen CSS ile gizlendi.
- **Faz 3a, detay paneli:** `TaskDetailDrawer` artık `ui/Drawer` (lg, ~%55) üzerine kurulu: üstte anahtar plakası + proje + "Studio'da aç", başlık, durum/öncelik/ajan/maliyet pilleri; altta klasör sekmeleri (ikonlu, sayaçlı, basınca gömülen; sekme değişince gövde kısa bir giriş animasyonu oynar). Sağda 280px bölünmüş sütun: Bütçe (`RingGauge` + 10 noktalı `DotMeter`, harcanan / limit; yeşil → hardal ≥%60 → turuncu ≥%90 → kırmızı aşıldı), Çalışma modu (`Segmented` + graf radyo listesi), Bağlantılar (dal, PR, merged / merge hatası), tarihler. `lg` altında bu sütun gizlendiği için aynı içerik Detay sekmesinin içinde de çizilir. Bölümler `§01 Açıklama ───` başlıklı, numaralar dinamik. Retry/Abort paneli, Break down, Parent/Subtasks (DotMeter ilerleme) korunarak yeniden çizildi; davranışlar ve API çağrıları aynı. Kapanırken son görev kopyası tutulur, böylece çıkış animasyonu boş panel göstermez.
- **Faz 3a, bütçe kaynağı:** Limit sırası `budget_exceeded` olayı → görevin `budgetUsd`'si → projenin `budgetUsd`'si → $2.00 (eski arayüzdeki "proje varsayılanı $2.00" metniyle aynı varsayım). Harcanan, olay yoksa `lib/cost.ts` ile `usage`'dan hesaplanır.
- **Faz 3a, log:** Zaman çizelgesi saat oluğu + kesik mürekkep rayı + araç ailesine göre renkli düğüm (okuma hardal, yazma kobalt, komut turuncu, alt ajan mürekkep), açılır argüman/sonuç kartları, ajan anlatımı konuşma balonu, üstte çağrı/süre/hata özeti ve "araç dağılımı" şeridi. Ham log, ajan log modalı, düğüm logu ve yorum logu ortak `Card/LogViewer.tsx`'i kullanır: satır numarası oluğu, basit ton boyama (hata/uyarı/komut/başarı), takip modu ve "Takip et" düğmesi, canlıyken yanıp sönen imleç.
- **Faz 3a, Esc katmanı:** Modal/Drawer/ConfirmDialog kendi `window` Esc dinleyicileri yerine `ui/overlay.ts`'teki `useEscapeLayer` yığınını kullanır: Esc yalnızca en üstteki katmanı kapatır (ör. drawer içindeki log modalını kapatınca drawer açık kalır). Hiç katman yokken Esc eskisi gibi board kısayoluna geçer (§7 korunur). Henüz elden geçmemiş ProjectDetailDrawer/PRDetailDrawer/Studio kendi dinleyicilerini tutuyor; sonraki ajan aynı hook'a geçirebilir.
- **Faz 3a, primitive eklemeleri (API kırmadan):** `Modal`'a isteğe bağlı `icon`, `description`, `footer`, `footerStart`; `Drawer`'a `meta`, `bodyClassName`, `bodyKey`; yeni `ui/Toggle.tsx` (`Checkbox`, `Switch`); ikonlar `IconTerminal`, `IconChat`, `IconCopy`, `IconFlow`, `IconFile`, `IconPencil`. `ConfirmDialog` artık çıkış animasyonu oynuyor (kapanırken düğmeler etkisiz), `Toast` 3 sn'lik otomatik kapanmayla eş bir boşalan şerit gösteriyor. Ortak CSS: `.ui-option`, `.ui-banner--*`, `.ui-check`, `.ui-switch`, `.ui-keyplate`, `.ui-sechead`, `.ui-linkrow`, `.tl*`, `.logpane*`, `.flow-node`, `.cmt`.
- **Faz 3a, modallar:** Formlar `Field`/`Input`/`Textarea`/`Segmented`/`Checkbox` ile; eylemler sabit alt şeritte (`form` özniteliğiyle submit). AddTask iki sütun (yazı sol, ayarlar sağda gömük panel; öncelik `PriorityMark`'lı radyo kartları). NewProject ad+slug ve repo yolu+dal yan yana, GitHub seçeneği seçilebilir kart. CloneRepo hedef yolu klasör kırıntısı olarak da gösterir. GithubConnect kodu tek tek harf plakaları olarak basar, iki numaralı adım. ImportIssues seçilebilir issue kartları, yükleme iskeleti, hata/boş durum (remote yoksa "Ayarla" proje detayına götürür); etiket renkleri GitHub verisi olduğu için `Tag dot`'ta ham hex olarak kalır.
- **Faz 3a, i18n:** Dokunulan tüm sabit metinler taşındı: `taskDetail.*` (≈35 yeni anahtar), `addTask`/`newProject`/`importIssues`/`cloneModal`/`prereqs` eklemeleri ve yeni `toolTimeline`, `flow`, `comments`, `githubConnect`, `notifications` ad alanları. TR silme onayı "Task silinsin mi?" → "Görev silinsin mi?".
- **Faz 3a, ekran görüntüleri:** Sandbox görevleri boş olduğu için Playwright tarayıcısında yalnızca GET yanıtları zenginleştirildi (`page.route`): CLF-6'ya tool call, ajan metni, düğüm koşuları, yorumlar, log, dal/PR, `usage` ve hata durumu; ImportIssues için sahte remote + issue listesi; GithubConnect için bağlı değil durumu ve yerel cevaplanan cihaz kodu. Betikte GET dışındaki her istek engellenir (core'a hiçbir yazma gitmedi; GitHub cihaz akışı başlatılmadı). Betik: `ClauFlow-redesign-shots/scripts/shots-faz3a.mjs`.
- **Faz 3b, portal:** `Modal` ve `ConfirmDialog` artık `createPortal(…, document.body)` ile çiziliyor. Drawer/sekme paneli animasyonu `transform` bıraktığı için içlerinde açılan `position: fixed` diyaloglar o kutuya hapsoluyordu. Prop API'leri değişmedi. ClaudeConfigTab'in tam ekran editörü kendi portalını (§7) korur; Esc için `useEscapeLayer`'a geçti (Esc yalnızca editörü kapatır, drawer açık kalır; betikte doğrulandı).
- **Faz 3b, proje paneli:** ProjectDetailDrawer `ui/Drawer` üzerinde; Drawer'a `full` genişliği (%94vw, min 760px) eklendi ve Claude Config sekmesinde panel bu genişliğe açılır (Studio'nun üç sütunu sığsın diye), Detaylar sekmesinde `xl`. Yan sütun: ilerleme halkası + durum sayıları, bağlantılar (remote yoksa taralı kutu), dal temiz/kirli, tehlikeli bölge. Görev aktifken repo alanları kilitli uyarısı.
- **Faz 3b, Studio:** Düğümler "atölye paneli": rol başlığı şeridi (renk: main hardal + taralı, planner kobalt, coder yeşil, reviewer turuncu, tester ink-2, ci kobalt, fix kırmızı, custom ink-3), 2px mürekkep çerçeve, sert gölge; koşu durumu gölge rengini değiştirir (çalışıyor turuncu + nabız, bitti yeşil, hata kırmızı, durduruldu hardal). Tuval kağıt üstünde nokta ızgara, kenarlar 2.25px ink-2, seçili kenar kobalt kesik. Yan paneller sürüklenebilir "kart" satırları (tutamak noktaları; tuvaldeki ajan kesik çerçeveli + yeşil tik). Ajan düzenleme ve "prompt'tan üret" `Modal`'a, SkillsManager `Modal xl` + `Tabs`'a geçti. §7 React Flow değişmezleri (stil importu, handle sınıfları, `elementFromPoint(...).closest("[data-id]")`, sabit yükseklikli ebeveyn) korundu. Ölü kod silindi: `handleSaveCurrentGraph`, `SkillSpinner`, `SCOPE_COLORS`, toolbar'daki kullanılmayan sabit.
- **Faz 3b, PR/İstatistik kabuğu:** Yeni `Shell/AppShell.tsx` (ray + üst bar + kaydırılan main). `TopBar`'a `section` prop'u: breadcrumb "Proje › PR'lar/İstatistikler", arama gizli. Board dışındayken ray görünüm düğmeleri `/board?projectId&view=` ile yönlendirir. Sayfalar proje seçimini store'dan alır, `?projectId=` URL'de `replaceState` ile senkron.
- **Faz 3b, PR'lar:** Durum renkleri kart PR rozetiyle aynı (açık kobalt, merged yeşil, kapalı kırmızı; `lib/githubConstants.ts`). Üç sayaç Tile + durum filtresi + sol şeritli PR satırları. Remote yoksa (hata metninde "remote") "fişi çekik" SVG çizimli durum kartı: proje ayarlarını açar veya yeniden dener; genel hata ve boş durum ayrı. PRDetailDrawer `full` genişlikte, split diff (eksik tarafı taralı), dosya listesi harf rozetli, "görüldü" işaretleri ve inceleme ilerleme çubuğu. Merge düğmesi yerinde ama hiç tıklanmadı.
- **Faz 3b, İstatistikler:** 4 KPI kartı (üst renk şeridi): görevler (bitti/hata bölünmüş çubuk), maliyet (girdi/çıktı/önbellek token dağılım çubuğu), tamamlanma ve CI başarı `RingGauge`. Node tipi tablosu başarı (yeşil ≥80, hardal ≥50, kırmızı) ve token çubuklarıyla; son görevler `StatusPill`'li bağlantı satırları (tıklayınca TaskDetailDrawer). Dışa aktar `ui-menu`; fiyat eskimiş uyarısı `ui-banner--warn`.
- **Faz 3b, ekran görüntüleri:** Sandbox'ta ajan/graf/PR/istatistik verisi olmadığı için `shots-faz3b.mjs` tarayıcıda GET yanıtlarını mock'lar (6 ajan, 4 düğümlü graf + CLF-6 düğüm koşuları, skill/plugin/registry listeleri, 5 PR + diff, istatistikler). GET dışı her istek engellendi; kaydet/üret/kur/merge tıklanmadı. Gerçek sandbox halleri de çekildi: `studio-empty`, `prs-error`, `insights-sandbox`.
- **Faz 4a, 3D kiti (`gui/src/components/three/`):** Three'siz modüller ayrı tutuldu ki sayfa chunk'ına renderer girmesin: `activity.ts` (`useSceneActivity`: IntersectionObserver rootMargin 0 + `visibilitychange` + `prefers-reduced-motion`; `frameloopFor` → görünür `always`, ekran dışı/gizli sekme `never`, reduced-motion `demand`), `webgl.ts` (WebGL**2** tespiti, çünkü three r163+ WebGL1'i bıraktı; `?webgl=0` yedeği zorlar), `colors.ts` (tokenlar `getComputedStyle` ile okunur, `useTheme` değişince yeniden). Three'li kısım `index.ts` barrel'ı: `SceneCanvas` (DPR `[1,1.75]`, drei `PerformanceMonitor` düşüşte DPR 1, `flat` = tone mapping yok ki token hex'leri aynen çıksın, hata sınırı + `webglcontextlost` → SVG yedeği), `SceneProvider` (palet başına tek paylaşılan toon/unlit malzeme; tema değişince yeniden derleme yok, renkler yerinde güncellenir; reduced-motion'da poster anına donan sahne saati), 3 basamaklı toon rampası (105/175/255) + buna ayarlı tek ambient + tek directional ışık, `Ink` (drei `<Outlines>`, kalınlık CSS px × DPR, 2D'deki 2px kurala denk), canvas dokuları (etiket/tabela/zemin baskısı; Jost/JetBrains Mono next/font değişkenlerinden, font dosyası veya troika/CDN isteği yok). Parçalar Fabrika görünümü için yeniden kullanılabilir: `Crate` (handle ile band/onay/PR damgası/kurdele durumları), `Conveyor` (instanced ayak/rulo, `travelRef` ile kayan bant), `RobotArm` (2 kemikli IK + taret yaw, kafa düz kalır, dönen dişliler), `Sparks` (instanced, tamamen zamandan türetilir), `Scanner`, `StampPress`, `Hopper`, `Bin`, `WrappedCrate`, `Terminal`, `DioramaBase` (kalın kâğıt tabla + 2D'deki sert ofset gölge + dünya birimli zemin baskısı), `StationSign`.
- **Faz 4a, istasyon renkleri:** Spec §3'te todo `--ink-3`; sahnede soluk kaldığı için art direction'daki dört vurgu kullanıldı: TODO kobalt, DOING turuncu, REVIEW hardal, DONE yeşil (diğer üçü §3 ile aynı). Tabela adları durum adlarıyla aynı (TODO/DOING/REVIEW/DONE, i18n'de `landing.stations.*.name`), altlarındaki notlar i18n.
- **Faz 4a, gece konturu:** 2D gecede kenarlar kremdir, ama ışıklı 3D formlarda krem kontur parlıyordu. Nesne konturu gecede `--sunken` (neredeyse siyah), yalnızca tablanın konturu `--line` (krem) ki sayfadan ayrılsın. Kutu etiketi yazısı iki temada koyu (`print` paleti).
- **Faz 4a, sahne kurgusu:** İndeksli hat: 4.2 sn'lik döngünün %27'sinde tüm kutular bir istasyon ilerler, kalanında her istasyon kendi kutusunu işler (TODO'da huniden düşer, DOING'de kol kaynak yapar + kıvılcım + dişli + monitörde kod akar, REVIEW'da büyüteç tarar ve yeşil lamba + ✓, DONE'da damga "PR" basar, kutu kurdeleyle paketlenir, rampadan kutuya kayar ve kaybolur). 5 kutuluk havuz, her şey sahne saatinden türetildiği için döngü dikişsiz ve reduced-motion karesi aynı zaman çizelgesinin bir anı. REVIEW tarayıcısı ilk denemede ön direkli kemerdi, kutuyu kapattığı için arkadan konsol (cantilever) yapıldı.
- **Faz 4a, gölgeler:** drei `ContactShadows` `frames={1}` ile bir kez pişirilir (tema değişince yeniden). Hareketli her şey (kol, kutular, kıvılcım) pişirme karelerinde gizli tutulur ve kutular bant üstünde ucuz "blob" gölge alır. Postprocessing yok.
- **Faz 4a, landing düzeni:** Hero 260vh'lik bölüm içinde sticky 100svh sahne: üstte iki sütun metin (başlık / açıklama + CTA'lar), sahne `setViewOffset` ile aşağı itilir ki başlık temiz kâğıtta dursun. Kaydırınca metin söner, kamera genel plandan TODO→DONE boyunca istasyon istasyon kayar; altta istasyon rayı ve odaktaki istasyonun açıklaması belirir (en üstte yalnızca "Kaydır, hattı gez" ipucu; zemin baskısı zaten istasyonları adlandırıyor). Fareyle hafif paralaks. Reduced-motion'da bölüm normal yükseklikte, sticky yok, sabit poster kare ve statik istasyon listesi. Ardından 3 adımlı "Nasıl çalışır" (sürükle / yorum yaz / birleştir, SVG piktogramlı paneller), hardal kapanış bandı ve footer. Eski sahte istatistik satırı ("opus 4.7" vb.) kaldırıldı. Landing'deki tüm metinler `landing.*` altında tr+en+types'a taşındı (`tagline`, `subtitle`, `cta` anahtarları korundu, içerikleri yenilendi).
- **Faz 4a, yükleme ve yedek:** Sahne `next/dynamic({ ssr:false })` ile yüklenir; yüklenene kadar ve WebGL2 yoksa aynı hattın token'lı SVG baskısı (`FactoryFallback`) gösterilir, sahne ilk kareleri çizince çapraz geçiş yapılır.
- **Faz 4a, ölçüm:** SwiftShader'da sahne ~190 draw call/kare (konturlar dahil; ayaklar/rulolar/kıvılcımlar instanced). Ekran dışına kaydırınca ve sekme gizlenince 0 kare doğrulandı (`ClauFlow-redesign-shots/scripts/probe-faz4.mjs`). Konsolda tek uyarı: `THREE.Clock: This module has been deprecated` — R3F 9.8.2'nin kendi içinden (`new THREE.Clock()`), bizim kodumuzdan değil; R3F güncellenince kalkar, hata değil.

## 12. İlerleme günlüğü

- 2026-11-15: Plan yazıldı ve onaylandı. Çalışma başlatılmadı; Furkan'ın "başla" demesi bekleniyor.
- 2026-11-15: **Faz 0 tamam.** Dal `redesign/atolye` açıldı, chore commit (5c8e66e), 3D bağımlılıkları eklendi (typecheck yeşil; lint 0 hata, 7 önceden var olan uyarı), sandbox projesi `proj_c2dd3194` ve 12 kart oluşturuldu, 12 "önce" görüntüsü `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/` altında. Sıradaki: Faz 1.
- 2026-11-15: **Faz 1 tamam.** Krem/gece tokenları + legacy alias katmanı, `useTheme` ve `localStorage.theme` taşıma, Jost + JetBrains Mono, §4 primitive'leri (`components/ui/`), `/styleguide`. typecheck yeşil; lint 0 hata, 7 önceden var olan uyarı. Görüntüler `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/faz-1-*`. Sıradaki: Faz 2.
- 2026-11-15: **Faz 2 tamam.** Sol ray + üst bar + görünüm seçici, yeni board sütunları (daraltılmış şerit, istatistik paneli), §5 kartı (maliyet dahil), hızlı filtreler, Liste görünümü, Fabrika yer tutucusu. DnD testi geçti (TODO içi sıralama kalıcı, Todo→Review onay penceresi açıldı ve iptal edildi, API durumu değişmedi). typecheck yeşil; lint 0 hata, 6 önceden var olan uyarı. Görüntüler `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/faz-2-*`. Sıradaki: Faz 3.
- 2026-11-15: **Faz 3a tamam** (Faz 3'ün ilk yarısı). Detay Drawer'ı (tüm sekmeler, bölünmüş bütçe/meta sütunu, log zaman çizelgesi, akış, yorumlar), 8 modal/overlay ve iki üst bar popover'ı. typecheck yeşil; lint 0 hata, 3 önceden var olan uyarı (Studio). Görüntüler `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/faz-3-*`. Sıradaki: ProjectDetailDrawer/ClaudeConfigTab, Studio, PR sayfası, Insights, faz sonu.
- 2026-11-15: **Faz 3 tamam** (3b). ProjectDetailDrawer + ClaudeConfigTab (tam ekran editör), Studio (tuval, düğümler, yan paneller, koşu paneli, ajan/üret/skill modalları), PR sayfası + PRDetailDrawer, İstatistikler; Modal/ConfirmDialog portal, AppShell. typecheck yeşil; lint 0 uyarı. Görüntüler `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/faz-3-*` (krem/gece). Sıradaki: Faz 4 (3D).
- 2026-11-15: **Faz 4a tamam** (Faz 4'ün ilk yarısı). Ortak 3D kiti `gui/src/components/three/` (dinamik yükleme, görünürlük/sekme/reduced-motion denetimi, token renkleri ve canlı tema, DPR `[1,1.75]`, WebGL2 yoksa SVG yedeği, yeniden kullanılabilir toon parçalar) ve landing "Ajan Fabrikası" + yeni landing düzeni (sticky kaydırmalı kamera, 3 adım, CTA'lar; metinler i18n'de). typecheck yeşil; lint 0 uyarı. Ayrı kopyada `next build`: `/` First Load 137 kB, 3D chunk'ları hidrasyondan sonra tembel (~242 kB gzip). Görüntüler `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/faz-4-landing-*` (krem/gece, kaydırılmış, reduced-motion, WebGL yedeği, mobil, tema geçişi). Sıradaki: Board Fabrika görünümü (aynı kiti kullanır), ajan çekirdeği, mikro animasyonlar, faz sonu.
