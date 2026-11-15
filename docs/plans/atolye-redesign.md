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
- [ ] Tokenlar (§3): krem ve gece temaları, eski isimlere alias'lar, tema geçişi ve `localStorage.theme` taşıma. Header ve landing'deki tekrarlanan toggle tek bir hook'a (`useTheme`) alınır.
- [ ] Fontlar: Jost ve JetBrains Mono.
- [ ] §4'teki bileşenler.
- [ ] `/styleguide` sayfası.
- [ ] Faz sonu: lint, ekran görüntüleri, commit.

### Faz 2: İskelet ve Board
- [ ] Sol ray ve üst bar. Görünüm seçici; Fabrika ve Liste şimdilik yer tutucu.
- [ ] Board sütunları, daraltılmış sütun şeridi ve istatistik paneli.
- [ ] TaskCard: §5'teki içerik ve maliyet.
- [ ] Hızlı filtre çipleri (yalnızca arayüz tarafında filtreleme).
- [ ] Liste görünümü.
- [ ] Sürükle-bırak testi (Playwright, sandbox): TODO içi sıralama ve izin verilmeyen geçişte onay penceresi.
- [ ] Faz sonu: lint, ekran görüntüleri, commit.

### Faz 3: Detay ve diğer ekranlar
- [ ] TaskDetail → sağdan açılan Drawer. Tüm sekmeler ve bölümler. ToolCallTimeline, MiniDagView, CommentsTab.
- [ ] Modallar: AddTask, ImportIssues, NewProject, CloneRepo, GithubConnect, ConfirmDialog, Toast, AgentBadge log modalı.
- [ ] ProjectDetailDrawer ve ClaudeConfigTab (tam ekran editör portalı dahil).
- [ ] Studio: tuval, AgentNode, Skills/Agents yan panelleri, NodeRunPanel, AgentEditDrawer, Toolbar, SkillsManagerModal.
- [ ] PR sayfası ve PRDetailDrawer.
- [ ] Insights.
- [ ] NotificationPopover ve PrereqIndicator.
- [ ] Faz sonu: lint, her ekran için iki temada ekran görüntüsü, commit.

### Faz 4: 3D
- [ ] Ortak 3D altyapısı: dinamik yükleme, görünürlük ve reduced-motion denetimi, tema renkleri, WebGL yedeği.
- [ ] Landing Ajan Fabrikası ve yeni landing düzeni.
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

## 12. İlerleme günlüğü

- 2026-11-15: Plan yazıldı ve onaylandı. Çalışma başlatılmadı; Furkan'ın "başla" demesi bekleniyor.
- 2026-11-15: **Faz 0 tamam.** Dal `redesign/atolye` açıldı, chore commit (5c8e66e), 3D bağımlılıkları eklendi (typecheck yeşil; lint 0 hata, 7 önceden var olan uyarı), sandbox projesi `proj_c2dd3194` ve 12 kart oluşturuldu, 12 "önce" görüntüsü `/home/furkanasikdev/Projects/ClauFlow-redesign-shots/` altında. Sıradaki: Faz 1.
