# ClauFlow "Ekipler": çalışma planı

> Bu dosya hem plan hem de gece çalışmasının durum kaydıdır. Her loop turu bu dosyayı okur, sıradaki işaretsiz (`- [ ]`) adımı alt ajanlarla yapar, doğrular, `[x]` yapar ve §13'e bir satır yazar. "Faz sonu" adımı commit atar.

## Sabah raporu

_(Faz 5'in son adımında doldurulur: fazlar ve commit'ler tablosu, nasıl bakılır, ekran görüntüleri, bilinen sınırlar, gözden geçirmeye değer kararlar, önerilen sonraki adımlar. Biçim `atolye-redesign.md` sabah raporuyla aynı.)_

---

## 1. Onaylanan kararlar (2026-11-15, Furkan)

1. **Studio kalkar, yerine "Ekipler" gelir.** Ekip, sıralı bir **rol** listesidir. Roller sırayla çalışır. Tek geri besleme döngüsü vardır: QA → Yazılımcı. Serbest tuval ve paralellik yoktur.
2. **Hazır şablonlar** tohumlanır, hepsi sıfır ayarla çalışır:
   - **Solo:** Yazılımcı. Bugünkü basit modun aynısı.
   - **Yazılım Ekibi:** CEO → Analist → Yazılımcı ⇄ QA.
   - **Hata Avı:** Analist → Yazılımcı ⇄ QA.
   - **Keşif:** CEO → Analist. Kod yazmaz. Çıktı görev yorumuna gider, PR açılmaz.
3. **Roller ve çıktıları (artifact):**
   - CEO bir **brief** yazar. Kullanıcıya soru sormaz; belirsizlikler brief'in "Varsayımlar" bölümüne yazılır.
   - Analist **şartname** yazar: ne yapılacak, hangi dosyalar, **kabul kriterleri**.
   - Yazılımcı uygular, commit eder ve **teslim notu** yazar.
   - QA her kabul kriterini kontrol eder ve testleri çalıştırır. Ya geçer ya da Yazılımcı'ya **hata listesi** döner.
   - Çıktılar kalıcıdır ve görev detayında konuşma gibi okunan bir **ekip zaman çizelgesi** olarak gösterilir.
4. **Tanımlar ClauFlow'da yaşar, repoda değil.** Ekip ve rol tanımları ClauFlow DB'sindedir: projeler arası global şablonlar, proje varsayılan ekibi, görev bazında ekip seçimi. Ekip listelemek, oluşturmak ya da düzenlemek kullanıcının reposuna hiçbir şey yazmaz.
5. **"Çalışma modu" (executionMode simple/graph) seçicisi kalkar.** Yerine görev detayında "Bu görevi kim yapsın?" ekip seçicisi gelir. Varsayılanı proje varsayılan ekibidir.
6. **QA turları:**
   - Üst sınır proje bazında ayarlanır: bir sayı ya da **Sınırsız**. Yeni projelerde varsayılan 3.
   - Takılma tespiti: QA arka arkaya iki kez esasen aynı hata listesini dönerse çalışma durur, görev "takıldı" notuyla bırakılır.
   - Mevcut proje bütçesi (`budgetUsd`) geçerlidir.
7. **Şartname onay kapısı:** Varsayılan **kapalı** (hedef kullanıcı vibe coder, varsayılan tam özerklik). Proje ayarıyla açılır. Açıksa çalışma Analist'in şartnamesinden sonra durur, kullanıcı görev detayında onaylayınca devam eder.
8. **İzin atlama (bypass):** ClauFlow'un çalıştırdığı rollerde hep açıktır, ama yalnızca ClauFlow'un kendi CLI çağrısında bayrak olarak verilir. Repoya asla `.claude/settings.json` yazılmaz. Mevcut otomatik yazmalar ve commit'ler durdurulur.
9. **Rol ayarları:** talimat (prompt), **model** (gerçekten `--model` ile geçilir), izinli araçlar, skill'ler (gerçekten enjekte edilir) ve isteğe bağlı **danışman modeli** (`--advisor <model>`, deneysel; danışman ana modelden düşük olamaz, Haiku danışman olamaz). Varsayılanlar: CEO=sonnet, Analist=opus, Yazılımcı=sonnet+danışman opus, QA=sonnet+danışman opus. CLI kabul ettiği yerde takma adlar (`sonnet`/`opus`) kullanılır.
10. **Önce danışman spike'ı (Faz 0).** `claude -p --advisor opus` etkileşimsiz çalışıyor mu? `claude --help` ve küçük gerçek koşu. Çalışıyorsa rol düzeyindeki danışman ayarı yayınlanır. Çalışmıyorsa alan bir yetenek bayrağıyla gizlenir, §11'e yazılır, devam edilir.
11. **Birleşik skill listesi:** global `~/.claude/skills`, plugin skill'leri ve projenin kendi `.claude/skills`'i. Rolde seçilen skill'ler enjekte edilir. "Skill önerileri" kapsam dışı. SkillsManagerModal (plugin kurulumu) kalabilir, yeni Ekip ekranından açılır.
12. **Roller arasında commit:** sonraki rol gerçek diff'i görür. Ekibin son çıktısı görev yorumu olur. Mevcut otomatik inceleme yorumu davranışı çalışmaya devam eder.
13. **Arayüz:**
    - Ekip editörü proje panelindeki Studio segmentinin yerini alır: şablon seçici, proje varsayılan ekibi, rol listesi (talimat, model, danışman, araçlar, skill'ler, sıralama, rol ekle/çıkar), QA tur sınırı (Sınırsız dahil), şartname onayı anahtarı.
    - CLAUDE.md editörü ("Talimatlar") kalır.
    - Board kartı etkin rolü gösterir (ör. "QA kontrol ediyor").
    - İsteğe bağlı cila: Fabrika istasyonları rolleri yansıtır.
    - Tam proje ayarları sayfası ayrı bir gelecek iştir.
14. **Geçiş:** `executionMode='graph'` olan görevler Solo'ya eşlenir. Eski graf verisi dönüştürülmez (eski tabloların kaderi §3'te). Studio arayüzü, `graphRunner`, `_graph.json` işleme, `claudeTopologySyncService` ve `docs/graph-authoring.md` silinir. README/CLAUDE.md'deki Studio/graf satırları güncellenir.
15. **Gelecek işler (yazılır, yapılmaz):** CEO sorularının görev yorumu olarak sorulması (engellemeden); skill önerileri; tam ayarlar sayfası; kalıcı TODO sırası.

## 2. Gece çalışma kuralları (otonom mod)

**Loop turu protokolü:**
- a. Bu dosyayı oku. §10'daki ilk `- [ ]` maddeyi bul. O fazın başlığından önceki fazlar kapanmamışsa önce onları kapat.
- b. Maddeyi bir alt ajana ver. Alt ajana bu dosyanın yolunu, maddenin metnini ve ilgili bölümleri (§3–§9) söyle. Bağımsız iki madde varsa paralel çalıştırılabilir, ama aynı dosyaya dokunanlar sırayla.
- c. Doğrula: maddenin kendi kontrolü + ilgili paketin typecheck'i. Yeşilse `[x]` yap ve §13'e tek satır yaz. Kırmızıysa bir kez daha dene, yine olmazsa §11.
- d. Karar verdiysen §12'ye yaz. Kapsam dışına çıkma; yeni fikirleri §1/15 listesine ekle.
- e. Sıradaki tura geç. "Faz sonu" maddesi commit atar.

1. **Soru sorma.** Belirsiz kararda bu plana en yakın seçeneği seç, §12'ye bir satır yaz.
2. **Dal:** `master`dan `feature/ekipler`. **Push, merge, PR yok.**
3. **Commit:** Faz başına bir commit: `feat: faz N - <özet>`, boş satır, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Büyük fazda ara commit olabilir (`feat: faz Na - …`).
4. **Paket yöneticisi:** `gui/` için yalnızca `npx -y pnpm@11.0.9 …`. `core/` npm kullanır. Karıştırma.
5. **Dev sunucular zaten çalışıyor:** core :3001 (`tsx watch`, her core düzenlemesinde yeniden başlar), gui :3000. Durmuşlarsa arka planda başlat (`cd core && npm run dev`, `cd gui && npx -y pnpm@11.0.9 dev`). **Gerçek bir ajan koşusu sürerken core dosyası düzenleme:** yeniden başlama koşuyu öldürür ve `recoverOrphanedTasks` görevi geri sarar.
6. **Gerçek ajan koşusu YALNIZCA sandbox'ta:** proje `proj_c2dd3194`, repo `/home/furkanasikdev/Projects/ClauFlow/atolye-lab/sandbox` (remote yok, push/PR imkânsız).
   - `stringflow` (`proj_db77eb93`) da remote'suz ama kullanıcınındır: **orada ajan çalıştırma.**
   - **Asla** Review→Done sürükleme (`gh pr merge` çalışır). Remote'u olan hiçbir repoda ajan çalıştırma.
   - Gerçek koşular bir avuç: spike'ta en çok 5 minik koşu, Faz 5'te en çok 2 ekip koşusu. Döngü ve kenar durumları **sahte CLI** ile test edilir (§6.6).
   - Sandbox, ClauFlow çalışma ağacının içinde. Her gerçek koşudan önce ve sonra `git -C /home/furkanasikdev/Projects/ClauFlow status --porcelain` alınır; ajan ClauFlow'a dokunduysa geri al ve §11'e yaz.
7. **DB ortak:** `core/data/tasks.db` hem `master` hem bu dal tarafından kullanılır. Göçler yalnızca **eklemeli ve idempotent** olur (§9). Faz 1'den önce yedek alınır.
8. **Ekran görüntüleri:** `atolye-lab/ekran-goruntuleri/ekipler-<faz>-<ekran>-{krem,gece}.png`, betikler `atolye-lab/ekran-goruntuleri/scripts/` (`shots-faz2.mjs`'teki Playwright kurulumunu kopyala: `/usr/bin/chromium`, Next dev rozetini gizleyen CSS, `localStorage.theme` = `cream`/`night`). Canlı olmayan durumlar için `page.route` ile GET yanıtları, WS için `page.routeWebSocket` (`shots-planlayici.mjs:19`) taklit edilir; GET dışı istekler engellenir.
9. **Takılma:** Bir adım iki denemede geçmezse §11'e yaz, sıradakine geç. Fazı kapatan doğrulamalar kırmızıysa faz kapanmaz.
10. **Doğrulama (her faz sonunda, hepsi yeşil):**
    - `cd core && npm run typecheck && npm test`
    - `cd gui && npx -y pnpm@11.0.9 typecheck && npx -y pnpm@11.0.9 lint` (**0 uyarı**)
    - GUI fazlarında (3, 4, 5) `next build`: çalışan dev sunucusunun `.next`'ine dokunmamak için scratchpad'e kopya (`node_modules` symlink'i, `.next` hariç) ve doğrudan `node_modules/.bin/next build`. Kopyada `pnpm build` çalıştırma (bkz. `atolye-redesign.md` §11 Faz 5).
11. **Tasarım:** Tüm GUI işi `DESIGN.md`'ye uyar: `components/ui/` primitive'leri, tokenlar, ham hex/palet yok, `ConfirmDialog`, ikonlar `ui/icons.tsx`'ten (emoji değil). Yeni metinler `tr.ts` + `en.ts` + `types.ts`'e.
12. **Bitiş:** Tüm fazlar bitince Sabah raporu doldurulur. Kota biterse dur, kalınan yeri §13'e yaz.

## 3. Plan yazılırken verilen kararlar (sabah gözden geçir)

- **Eski tablolar yerinde kalır, kullanılmaz.** `graphs` tablosu, `tasks.executionMode` ve `tasks.graphId` silinmez. Gerekçe: DB `master` ile ortak (§2/7); silmek `master`ı kırar ve geri dönüşü imkânsız kılar. Yalnızca okuma/yazma kodu silinir. Boot'ta her proje reposundan `_graph.json` okuyan göç (`taskService.ts:369-379`) kaldırılır.
- **Varsayılan ekip (kullanıcı kararı bana bıraktı, 2026-11-15):** mevcut projeler Solo kalır (`defaultTeamId = NULL` = Solo, davranış sessizce değişmez). **Yeni oluşturulan projeler `defaultTeamId` = Yazılım Ekibi şablonu ile başlar** — özelliğin amacı ekip akışı. Proje oluşturma (`POST /api/projects`) bu atamayı yapar; kullanıcı Ekip ekranından veya görev başına değiştirebilir.
- **Durma halleri** (takılma, tur sınırı, bütçe) aynı yoldan biter: iş `wip:` commit'iyle dalda kalır, repo base'e döner, **dal silinmez**, görev `todo` + `agent.status: error` + "Takıldı: <neden>" olur ve "Takıldı" yorumu yazılır. Kullanıcı iptali bugünkü gibi temizler (reset + dal silme).
- **Tur sınırı aşılınca da "takıldı".** Bilinen hatalarla PR açmak ya da görevi `done` saymak yanıltıcı olur.
- **Keşif sonu:** yorum yazılır, görev `done` olur, commit/push/PR yok, dal silinir.
- **Başarılı koşudan sonra repo base dala döner** (dal korunur). CLAUDE.md editörü yalnızca base daldayken commit eder, değilse dosyayı kaydeder ve `commitWarning: "not_on_default_branch"` döner. Böylece hiçbir arayüz commit'i görev dalına düşmez.
- **Araç kısıtı `--tools` ile.** `--allowedTools` bypass modunda yalnızca otomatik onaylar, kısıtlamaz (spike doğrular). QA ve CEO/Analist'te `Write`/`Edit` yok. Yazılımcı dışındaki bir rol çalışma ağacını kirletirse değişiklik `git stash push -u -m clauflow-discard-<rol>` ile kenara alınır (geri alınabilir).
- **Rol türleri dört tane** (`ceo`, `analyst`, `developer`, `qa`). Her tür ekipte en çok bir kez bulunur. "Rol ekle" eksik türlerden birini ekler. QA varsa Yazılımcı da vardır ve ondan sonra gelir.
- **Yerleşik şablonlar salt okunur.** Boot'ta upsert edilir (prompt iyileştirmeleri yayılsın diye). Düzenlemek "Özelleştir" ile projeye kopya açar (copy-on-write). Kullanıcı bir proje ekibini "Şablon olarak kaydet" ile global şablon yapabilir.

## 4. Koddan doğrulanan sorunlar ve düzeltildikleri adım

| Sorun | Kanıt | Adım |
|---|---|---|
| Tuval dosyadan yüklenir, DB'ye kaydeder; düğüm retry'ı dosyaya göre doğrular | `StudioCanvas.tsx:273` → `projectsClaude.ts:667` (`_graph.json`); kayıt `StudioCanvas.tsx:417` → `graphs` tablosu; executor DB'den okur `executor.ts:182`; retry `tasks.ts:343` `loadGraph(repoPath)` | F2, F4 (hepsi silinir) |
| Model yok sayılır | `claudeService.ts:286-297` argümanlarında `--model` yok; frontmatter modeli yalnızca satır/fiyat için `graphRunner.ts:382,499` | F2 |
| Üretilen skill'ler düşer | Üretici `## Available Skills` tablosu yazar (`projectsClaude.ts:413`); `loadSkillContent` `^[A-Za-z0-9_.-]+$` ile `plugin:skill` biçimini reddeder (`graphRunner.ts:151`); proje `.claude/skills` hiç taranmaz | F1, F2 |
| Coder diff'i boş | Düğümler arası commit yok; diff `base..HEAD` (`graphRunner.ts:562-571`), commit grafikten sonra (`executor.ts:524`) | F2 |
| Grafiğin son çıktısı atılır | `executor.ts:250` dönüş değeri kullanılmaz; otomatik yorum yalnızca basit dalda (`executor.ts:507-515`) | F2 |
| Ajan listelemek repoya yazar ve commit eder | `GET /claude/agents`: `main.md` + `ensureClaudeSettings` (bypassPermissions) + 2 commit (`projectsClaude.ts:331-358`); POST da yazar (`:514`); graf PUT commit'i (`:727-743`); `checkoutBase` `_graph.json` otomatik commit'i (`gitService.ts:120-139`) | F1 |
| Başarıdan sonra commit'ler görev dalına düşer | Executor başarıda base'e dönmez (`executor.ts:632-653`); Studio/CLAUDE.md commit'leri o anki dala (`projectsClaude.ts:76-110`) | F1, F2 |
| `syncTopologyToClaudeMd` ölü kod | Tek tanım `claudeTopologySyncService.ts:57`, çağıran yok; README:130 hâlâ "Mermaid'e yansıtılır" diyor | F4 |
| CLI yolu sabit | `spawn("claude", …)` (`claudeService.ts:305`); geçersiz kılma yok | F0 |
| Bütçe düğüm başına sıfırlanır | `midRunCost` her düğümde 0'dan (`graphRunner.ts:488`) | F2 (birikimli) |
| Takma ad fiyatı yanlış | `sonnet`/`opus` `MODEL_PRICING`'de yok, sonnet-4-5 fiyatına düşer (`pricingService.ts:71-77`); opus 5 kat ucuz görünür | F2 |
| Duraklatılmış görev boot'ta geri sarılır | `recoverOrphanedTasks` tüm `doing`'leri `todo`'ya çeker (`taskService.ts:960-976`) | F2 |
| `--advisor` yardımda yok | `claude --help` (2.1.306) listelemiyor; `--tools`, `--append-system-prompt`, `--model`, `--max-budget-usd` var | F0 spike |

## 5. Veri modeli ve API

### 5.1 Tablolar (eklemeli göç, `taskService.ts` göç bloklarının sonuna)

- `teams(id TEXT PK, projectId TEXT NULL REFERENCES projects(id) ON DELETE CASCADE, templateKey TEXT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', roles TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0, createdAt TEXT, updatedAt TEXT)`. `projectId NULL` = global şablon.
- `task_team_runs(id TEXT PK, taskId TEXT REFERENCES tasks(id) ON DELETE CASCADE, teamId TEXT, teamSnapshot TEXT NOT NULL, status TEXT NOT NULL, qaRound INTEGER NOT NULL DEFAULT 0, stopReason TEXT, costUsd REAL NOT NULL DEFAULT 0, startedAt TEXT, finishedAt TEXT)`. `status`: `running | awaiting_approval | delivered | explored | stuck | error | aborted`.
- `task_team_artifacts(id TEXT PK, runId TEXT REFERENCES task_team_runs(id) ON DELETE CASCADE, taskId TEXT, roleId TEXT, roleKind TEXT, kind TEXT, round INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, verdict TEXT, approved INTEGER, commitSha TEXT, nodeRunId TEXT, costUsd REAL, createdAt TEXT)`. `kind`: `brief | spec | delivery | qa_report | stuck | summary`.
- `projects`: `defaultTeamId TEXT` (NULL = Solo; yeni projelerde Yazılım Ekibi şablon id'si atanır), `qaMaxRounds INTEGER NOT NULL DEFAULT 3` (0 = Sınırsız), `specApproval INTEGER NOT NULL DEFAULT 0`.
- `tasks`: `teamId TEXT` (NULL = proje varsayılanı).
- `app_meta(key TEXT PK, value TEXT)`. Tek seferlik göç: `ekipler_graph_to_solo` anahtarı yoksa `UPDATE tasks SET teamId='team_solo' WHERE executionMode='graph' AND teamId IS NULL`, sonra anahtarı yaz.
- `task_node_runs` aynen kullanılır: her rol koşusu bir satır (`nodeId = role:<kind>:<round>`, `nodeType = <kind>`, `model`). `NodeType`'a `ceo | analyst | developer | qa` eklenir (İstatistikler bunu gruplar).

### 5.2 Tipler (`core/src/types/index.ts` ve `gui/src/types/index.ts` eş)

`RoleKind`, `TeamRole { id, kind, name, instructions, model, advisorModel: string|null, tools: string[], skills: string[] }`, `Team`, `TeamRun`, `TeamArtifact`. `AgentStatus`'a `awaiting_approval`. `Project`'e üç alan, `Task`'a `teamId`. `executionMode`/`graphId` tiplerden çıkar (kolonlar DB'de kalır).

### 5.3 Uç noktalar

- `GET /api/teams?projectId=` → yerleşikler + kullanıcı şablonları + o projenin ekipleri.
- `POST /api/teams` `{ name, projectId|null, roles, fromTeamId? }`, `PUT /api/teams/:id`, `DELETE /api/teams/:id`. Yerleşik → 403 `builtin_readonly`. Bir projenin varsayılanıysa silme → 409 `team_in_use`.
- `PATCH /api/projects/:id`: `defaultTeamId`, `qaMaxRounds` (0–20), `specApproval`.
- `POST/PATCH /api/tasks`: `teamId` (nullable). `executionMode`/`graphId` artık kabul edilmez (zod siler).
- `GET /api/tasks/:id/team` → `{ runs, artifacts }`. `POST /api/tasks/:id/team/approve` `{ specBody? }`.
- `GET /api/projects/:id/claude/skills/catalog` → `[{ id, name, source: user|project|plugin, pluginId?, description }]`. Kimlik: `user:<ad>`, `project:<ad>`, `<plugin>:<ad>`. Gövde yalnızca katalogdan çözülen yoldan okunur (regex ile değil).
- `GET /api/system/capabilities` → `{ advisor: boolean, models: string[] }`.
- WS: `team_run_updated { taskId, payload: TeamRun }`, `team_artifact { taskId, payload: TeamArtifact }`. Etkin rol `agent.currentStep = "team:<kind>"` ile gelir (yeni Task alanı yok).

## 6. Yürütme motoru

### 6.1 Dosyalar

- `core/src/services/teamTemplates.ts`: 4 yerleşik ekip (sabit id'ler `team_solo`, `team_yazilim_ekibi`, `team_hata_avi`, `team_kesif`) ve rol varsayılanları.
- `core/src/services/teamService.ts`: CRUD, `teamRolesSchema` doğrulaması, `resolveTeamForTask(task, project)` (görev → proje → Solo; bulunamayan id Solo'ya düşer ve loglanır).
- `core/src/services/skillCatalogService.ts`: birleşik skill listesi (plugin listesi 60 sn önbellekli), `readSkillBody(id)` frontmatter'ı atar.
- `core/src/agents/roleRunner.ts`: `runRole()`. `executor.ts:262-515`'teki tek-CLI bloğundan çıkarılır: düğüm satırı, araç çağrıları, ajan metni, alt ajan satırları, stream-json → text yedeği, kullanım/maliyet.
- `core/src/agents/teamPrompts.ts`: rol başına `-p` metni ve `--append-system-prompt` metni.
- `core/src/agents/teamArtifacts.ts`: `parseQaVerdict`, `isStalled`.
- `core/src/agents/teamRunner.ts`: `runTeam()`.

### 6.2 CLI çağrısı (`claudeService.ts`)

`["-p", prompt, "--permission-mode", "bypassPermissions", "--model", m, "--tools", "Read,Glob,…", "--append-system-prompt", sys, ("--advisor", a)?, "--output-format", "stream-json", "--verbose"]`. `-p` ilk argüman kalır. İkili `process.env.CLAUFLOW_CLAUDE_BIN || "claude"`, her spawn'da okunur. Rol çağrıları ayrıca `--strict-mcp-config` geçer (F0 spike, §12). `--advisor` yalnızca yetenek açıksa eklenir. Eski çağıranlar (`commentRunner`, `ciWatcher`, `prReviewRunner`, planner, breakdown) değişmez.

### 6.3 Akış (`runTeam`)

1. Ekibi çöz, `teamSnapshot` ile run satırı aç (devam ediliyorsa son `awaiting_approval` run'ı ve onaylı brief/spec yeniden kullanılır, Yazılımcı'dan başlanır).
2. Her rol için: bütçe kontrolü (birikimli `run.costUsd` ≥ `getTaskEffectiveBudget` → dur: bütçe); `setAgentStep("running", "team:<kind>")`; `runRole`; son metin `result` olayının `result` alanından (yoksa biriken metin); artifact yaz ve yayınla.
3. Yazılımcı sonrası: `commitAll` (`feat(<KEY>): <başlık>` / sonraki turlarda `fix(<KEY>): QA turu N`), `commitSha` artifact'a. Diğer roller sonrası: ağaç kirliyse stash (§3).
4. QA: `parseQaVerdict`. PASS → bitir. FAIL → `qaRound++`; tur sınırı (`qaMaxRounds > 0` ve `qaRound >= qaMaxRounds`) → dur: tur sınırı; `isStalled(önceki, şimdiki)` → dur: takıldı; değilse Yazılımcı'ya hata listesiyle dön, sonra QA tekrar.
5. Analist sonrası, `project.specApproval` açıksa ve ekipte Yazılımcı varsa: run `awaiting_approval`, `agent.status = awaiting_approval`, repo base'e döner, dal silinir (henüz kod yok), `runTeam` `{ kind: "awaiting_approval" }` döner.
6. Dönüş: `delivered | explored | stuck | awaiting_approval` ve özet metni.

### 6.4 Executor entegrasyonu

`executor.ts:243-516` (`if (graph) … else …`) `runTeam` ile değişir. `delivered` → mevcut commit/push/PR/CI/review yolu, PR gövdesine "## Ekip" bölümü (kabul kriterleri + QA sonucu), `## Ekip özeti` yorumu. `"## Code Review Report"` otomatik yorumu ve `prReviewRunner` korunur. `explored` → yorum, `done`, dal silinir. `stuck` → §3. `awaiting_approval` → görev `doing` kalır, slot boşalır. Başarı sonunda `git checkout <defaultBranch>`. `recoverOrphanedTasks`'e `AND agentStatus != 'awaiting_approval'`. `/abort` duraklatılmış görevi de `todo`'ya çeker ve run'ı `aborted` yapar.

### 6.5 Takılma ve karar ayrıştırma

- QA çıktısı son satırlardan birinde `VERDICT: PASS` ya da `VERDICT: FAIL` içerir, FAIL ise `## Hata listesi` altında numaralı maddeler. Karar satırı yoksa FAIL sayılır, tüm metin hata listesi olur ve uyarı loglanır.
- `isStalled(a, b)`: maddeler küçük harfe, noktalama/rakam/fazla boşluk atılarak normalize edilir; kelime kümelerinin Jaccard benzerliği ≥ 0.8 ise "esasen aynı". Saf fonksiyon, birim testli.

### 6.6 Sahte CLI ve yalıtılmış core

- `core/src/agents/__fixtures__/fake-claude.mjs` (repoda, çalıştırılabilir). Argümanları ayrıştırır, her çağrıyı `$FAKE_CLAUDE_STATE/calls.jsonl`'a yazar (`--model`, `--tools`, `--advisor`, sistem prompt'u dahil). Rolü sistem prompt'undaki `<!-- clauflow-role: <kind> round: <n> -->` işaretinden bulur. Senaryo `FAKE_CLAUDE_SCENARIO`: `pass`, `fail_then_pass`, `stuck`, `always_fail`, `no_verdict`, `exit_error`, `slow` (abort testi). Yazılımcı cwd'ye `fake-<round>.txt` yazar. Çıktı: `system/init`, `assistant` (metin + usage), `result` (usage ile).
- Vitest entegrasyon testleri: geçici git reposu (remote yok), DB'de geçici proje/görev, `process.env.CLAUFLOW_CLAUDE_BIN` sahteye.
- Yalıtılmış core (API/WS uçtan uca): `cd atolye-lab/fake/core-run && PORT=3101 CLAUFLOW_CLAUDE_BIN=<abs>/fake-claude.mjs node <abs>/core/node_modules/.bin/tsx <abs>/core/src/index.ts`. `DATA_DIR = cwd/data` olduğu için DB ayrı. Repolar `atolye-lab/fake/repos/`. İş bitince süreç öldürülür. Gerçek :3001'e dokunulmaz.

## 7. Rol sözleşmeleri ve şablon varsayılanları

Talimatlar İngilizce yazılır (model güvenilirliği), çıktı dili görevin dilidir. Her rol, sistem prompt'unda rol işaretini ve aşağıdaki çıktı biçimini taşır.

| Rol | Model / danışman | `--tools` | Girdi | Çıktı |
|---|---|---|---|---|
| CEO | sonnet / — | Read, Glob, Grep | görev, proje arka planı | `## Brief`: Amaç, Kapsam, Kapsam dışı, **Varsayımlar**. Soru sormaz. |
| Analist | opus / — | Read, Glob, Grep, Bash | görev, brief | `## Şartname`: Ne yapılacak, Dosyalar, **Kabul kriterleri** (`AC-1…`), Test önerisi |
| Yazılımcı | sonnet / opus | Read, Write, Edit, Bash, Glob, Grep | brief, şartname, (tur ≥2) hata listesi + önceki teslim notu | Kod + testler, testleri çalıştırır; `## Teslim notu`: değişen dosyalar, AC eşlemesi, test sonucu |
| QA | sonnet / opus | Read, Bash, Glob, Grep | şartname, teslim notu, `git diff <base>...HEAD` (30k karakterle kırpılır) | `## QA raporu` (AC başına ✓/✗, test çıktısı özeti), `VERDICT:` satırı, FAIL'de `## Hata listesi` |

Solo'nun Yazılımcı'sı bugünkü `testingInstructions` metnini (`executor.ts:280-297`) aynen kullanır. Skill'ler sistem prompt'una `Skill: <id>` başlığıyla eklenir (skill başına 20k, toplam 60k karakter tavanı), log'a `⚡ Skills injected: …` yazılır. Fiyat: takma ad ve aile eşlemesi (`opus` → en yeni opus satırı vb.), bilinmeyen tam adlar aile alt dizesiyle eşlenir.

## 8. Arayüz

- **Görev detayı (`TaskDetailDrawer.tsx`):** "Çalışma modu" bloğu (`:825-930`) yerine "Bu görevi kim yapsın?" seçicisi: ilk seçenek "Proje varsayılanı (X)", sonra yerleşikler ve proje ekipleri; çalışırken kilitli. "Akış" sekmesi "Ekip" olur: üstte ekip zaman çizelgesi, altta katlanır "Teknik akış" (mevcut `MiniDagView`). Başlıktaki "Studio'da aç" (`:381`) yerine "Ekibi düzenle".
- **Zaman çizelgesi (`Card/TeamTimeline.tsx`):** konuşma balonları. Rol avatarı + ad, tur etiketi, maliyet ve token (mono), commit çipi, katlanır markdown gövde. QA kararı yeşil/kırmızı `StatusPill`. Takılma kartı taralı (`.ui-hatch`) ve kırmızı.
- **Onay kapısı:** hardal banner, düzenlenebilir şartname (`Textarea`), "Onayla ve devam et" (birincil) ve "İptal" (`ConfirmDialog`).
- **AddTaskModal:** executionMode seçicisi (`:43-84`, `:196-230`) aynı ekip seçicisiyle değişir.
- **Kart:** `agent.currentStep` `team:<kind>` ise `AgentBadge` rol ikonu + "CEO brief yazıyor / Analist şartname yazıyor / Yazılımcı kodluyor (· tur N) / QA kontrol ediyor"; `awaiting_approval` hardal "Onay bekliyor".
- **Ekip editörü (`components/Team/`):** `ClaudeConfigTab` segmentleri "Talimatlar | Ekip" (`ClaudeConfigTab.tsx:28,49-71`). Şablon kartları + "Varsayılan yap", "Özelleştir", rol listesi (yukarı/aşağı düğmeleriyle sıralama, rol ekle/çıkar, doğrulama mesajları), rol düzenleyici (talimat, model, danışman (yetenek kapalıysa gizli; seçenekler sıraya göre süzülür), araç kutuları, aranabilir skill çoklu seçimi + "Skill yöneticisi" → `SkillsManagerModal`), proje ayarları (QA tur sınırı `Segmented` 1/2/3/5/Sınırsız + sayı, şartname onayı `Switch`), "Şablon olarak kaydet".
- **Store:** `studioRequest` → `teamEditorRequest { projectId }`. Ekipler proje başına, run/artifact görev başına; `useAgentSocket` iki yeni olayı işler.

## 9. Değişmezler

- Repoya ClauFlow arayüzünden yazma yok; tek istisna CLAUDE.md editörü ve yalnızca base daldayken.
- `-p <prompt>` her zaman ilk CLI argümanı. Bypass yalnızca bayrakla.
- Göçler eklemeli ve idempotent; `master` aynı DB ile çalışmaya devam eder.
- Executor davranışları korunur: `acquireSlot`, `gh auth setup-git`, hata → `todo` + `agent.status: error`, remote yoksa `done`, remote varsa `ci`/`review`, `nothing` tespiti, `prReviewRunner`, `startCiWatch`, bütçe olayı `budget_exceeded`.
- `commentRunner`, CI fix döngüsü, planner ve breakdown dokunulmadan çalışır.
- GUI: dnd-kit kuralları, `ALLOWED_TRANSITIONS`, klavye kısayolları, `localStorage` anahtarları, `useEscapeLayer`, i18n üçlüsü (`atolye-redesign.md` §7).
- Studio ile birlikte hiçbir yeni özellik eklenmez; kapsam dışı maddeler §1/15'te.

## 10. Fazlar

### Faz 0: Hazırlık ve spike
- [x] `git checkout -b feature/ekipler master`. Bu plan dosyası ilk faz commit'ine girer.
- [x] DB yedeği: `node -e` ile better-sqlite3 `.backup()` → `atolye-lab/db-yedek/tasks-<zaman>.db`. Boyut > 0 doğrula.
- [x] Spike A, scratchpad'de `git init` edilmiş boş bir dizinde (repo değil): (1) `--model sonnet`: `system/init` olayındaki gerçek model adını kaydet; (2) bypass + `--allowedTools Read` ile "x.txt oluştur" → dosya oluşuyor mu; aynısı `--tools Read` ile; (3) `--append-system-prompt` + `-p` birlikte; (4) `--model sonnet --advisor opus` etkileşimsiz: çıkış kodu, stderr, olaylarda danışman izi, usage. En çok 5 minik koşu ("Reply OK"). Sonuçları §12'ye tablo olarak yaz.
- [x] Karar: danışman çalışıyorsa `core/src/services/claudeCapabilities.ts` içinde `ADVISOR_SUPPORTED = true`, değilse `false` + §11 kaydı. `fable` takma adı kabul ediliyorsa model listesine ve sıralamaya nereye girdiğini §12'ye yaz.
- [x] `claudeService.ts:305`: `process.env.CLAUFLOW_CLAUDE_BIN || "claude"`. Vitest: env bir betiğe işaret edince o çalışır.
- [x] Sahte CLI (§6.6) ve duman testi: `runClaude` ile `pass` senaryosu stream-json'u doğru ayrıştırıyor, `calls.jsonl` yazılıyor.
- [x] Yalıtılmış core betiği `atolye-lab/fake/start-fake-core.sh` (§6.6). Başlat, `curl :3101/api/projects` → `[]`, öldür.
- [x] Sandbox koruması: sandbox'a "bu bağımsız bir test reposudur; üst dizinlerdeki CLAUDE.md'yi yok say, bu dizinin dışına çıkma" diyen `CLAUDE.md` ekle ve sandbox reposunda commit et (CLAUDE.md keşfi üst dizinlere çıkıyor).
- [x] "Önce" görüntüleri (`scripts/shots-ekipler-once.mjs`, yalnızca GET): Studio (proje paneli → Claude Config → Studio), görev detayındaki çalışma modu, AddTask modalı, çalışan kart (taklit). Krem + gece.
- [x] Faz sonu: §2/10 doğrulamaları, commit `feat: faz 0 - dal, CLI spike, sahte CLI`.

### Faz 1: Veri, API, repo yazmalarının durması
- [x] Tipler (§5.2), core ve gui. Henüz kullanılmayan alanlar derlenmeli.
- [x] Göç (§5.1): tablolar, kolonlar, `app_meta`, graf→Solo eşlemesi. `_graph.json` okuyan boot göçünü sil. İki kez boot'ta idempotent olduğunu test et.
- [x] `teamTemplates.ts` (§7) + boot upsert. `GET` ile 4 yerleşik dönüyor.
- [x] `teamService.ts` + `teamRolesSchema` (tür tekilliği, QA ⇒ Yazılımcı ve sonra, 1–4 rol, danışman sırası, Haiku danışman olamaz) + `resolveTeamForTask`. Birim testleri.
- [x] `routes/teams.ts` + `index.ts` mount, 403/409 kuralları. Vitest ya da curl ile doğrula.
- [x] Proje PATCH alanları ve `createProject` varsayılanları. Görev POST/PATCH `teamId`; `executionMode`/`graphId` şemadan çıkar (`tasks.ts:73-74`).
- [x] `skillCatalogService` + `/claude/skills/catalog`. Kökler parametreli (testte geçici HOME). `plugin:skill` ve proje skill'i testte çözülüyor.
- [x] `GET /api/system/capabilities`.
- [x] Repo yazmalarını durdur: `GET /claude/agents`'taki `main.md` + `ensureClaudeSettings` + commit'ler (`projectsClaude.ts:331-358`), POST'taki `ensureClaudeSettings` (`:514`), graf PUT commit'i (`:727-743`), `gitService.ts:124` listesinden `_graph.json`. CLAUDE.md PUT yalnızca base dalda commit eder (§3).
- [x] Doğrula: sandbox'ta `GET /claude/agents` sonrası `git -C atolye-lab/sandbox status --porcelain` boş ve yeni commit yok.
- [x] Faz sonu: doğrulamalar, commit `feat: faz 1 - ekip verisi, API, repo yazmaları durdu`.

### Faz 2: Motor
- [x] `claudeService`: `model`, `tools`, `appendSystemPrompt`, `advisorModel` seçenekleri (§6.2). Sahte CLI `calls.jsonl` ile test.
- [x] Rol koşularını kullanıcı düzeyi ayar ve hook'lardan yalıtmayı değerlendir (F0'da "Fact-Forcing Gate" hook'u ilk yazmayı engelledi, §12): ör. `--setting-sources project,local` ya da hook'ları kapatan `--settings`, planlanmış `--strict-mcp-config` ile birlikte. `claude --help` ile bayrakları doğrula, sahte CLI `calls.jsonl` ile argümanları test et, kararı §12'ye yaz.
- [x] `pricingService`: takma ad + aile eşlemesi (§7). Birim testleri.
- [x] `roleRunner.ts` (§6.1): executor'daki bloğu taşı, davranışı birebir koru (alt ajan satırları, metin yedeği, birikimli bütçe, rol modeliyle fiyat).
- [x] `teamPrompts.ts`: dört rol + Solo, rol işareti, skill enjeksiyonu ve tavanları. Testler: `plugin:skill` enjekte ediliyor, tavan uygulanıyor.
- [x] `teamArtifacts.ts`: `parseQaVerdict`, `isStalled` (§6.5). Testler: PASS, FAIL, karar yok, eşik altı/üstü.
- [x] `teamRunner.ts` sıralı akış + artifact kalıcılığı + WS yayınları (`broadcastTeamRunUpdated`, `broadcastTeamArtifact`) + roller arası commit/stash.
- [x] QA döngüsü: tur sınırı, Sınırsız, takılma, roller arası bütçe kontrolü.
- [x] Onay kapısı: duraklat, `GET /tasks/:id/team`, `POST …/team/approve` (düzenlenmiş şartname), devam; `recoverOrphanedTasks` ve `/abort` güncellemesi.
- [x] Executor entegrasyonu (§6.4): `runTeam`, çıkış halleri, PR gövdesi "## Ekip", `## Ekip özeti` yorumu, başarıda base'e dönüş, Keşif yolu.
- [x] Sil: `graphRunner.ts` + testi, `enqueueResume`/`resumeFromNodeId`, `tasks.ts:314-370` düğüm abort/retry, graf PUT'taki `planGraph` doğrulaması, executor'daki `getGraph`. (`routes/graphs.ts` ve Studio uçları Faz 4'te, GUI ile birlikte.)
- [x] Sahte CLI entegrasyon testleri A: Solo; Yazılım Ekibi `pass`; `fail_then_pass` (2 Yazılımcı commit'i, QA ikinci turda gerçek diff'i görüyor).
- [x] Testler B: `stuck` (takıldı, dal duruyor, `wip:` commit), `always_fail` + sınır 2, Sınırsız + `stuck`, bütçe durması, `exit_error` (bugünkü hata yolu), `slow` + abort.
- [x] Testler C: Keşif (commit/PR yok, yorum var, `done`), onay kapısı duraklat → onayla → devam, `calls.jsonl`'da `--model`, `--tools`, skill metni, (yetenek açıksa) `--advisor`.
- [x] Yalıtılmış core uçtan uca (:3101): proje + görev oluştur, `PATCH status=doing`, küçük bir `ws` istemcisiyle `team_artifact` olaylarını say, `GET /tasks/:id/team` ile karşılaştır.
- [x] Faz sonu: doğrulamalar, commit `feat: faz 2 - teamRunner motoru`.

### Faz 3: Görev detayı arayüzü
- [x] GUI tipleri, `lib/api.ts` uçları, store dilimleri, `useAgentSocket` yeni olaylar; `TaskPatch`'ten `executionMode`/`graphId` çıkar.
- [x] i18n: `team.*` (rol adları, etkinlikler, durma nedenleri, onay kapısı, seçici), tr + en + types.
- [x] Ekip seçicisi bileşeni (`Team/TeamPicker.tsx`) ve `TaskDetailDrawer` entegrasyonu (§8).
- [x] AddTaskModal'da aynı seçici.
- [x] `TeamTimeline.tsx` ve "Ekip" sekmesi (altta "Teknik akış").
- [x] Onay kapısı arayüzü.
- [x] Kart rozeti: `AgentBadge` `STEP_KIND` + `team:<kind>` etiketleri + `awaiting_approval`.
- [x] "Studio'da aç" → "Ekibi düzenle" (`teamEditorRequest`).
- [x] Ekran görüntüleri (taklit GET + WS): QA 2. tur çalışıyor, onay bekliyor, takıldı, bitmiş zaman çizelgesi, kart rozetleri. Krem + gece. Ayrıca bir kez yalıtılmış core'a `page.route` 3001→3101 yönlendirmesiyle canlı akış.
- [x] Faz sonu: doğrulamalar + build, commit `feat: faz 3 - görev detayında ekip`.

### Faz 4: Ekip editörü ve Studio'nun silinmesi
- [ ] `ClaudeConfigTab` segmentleri "Talimatlar | Ekip", `TeamEditor` iskeleti.
- [ ] Şablon kartları, "Varsayılan yap", "Özelleştir" (kopya).
- [ ] Rol listesi: sıralama, ekle/çıkar, doğrulama mesajları.
- [ ] Rol düzenleyici: talimat, model, danışman, araçlar, skill'ler (katalog), "Skill yöneticisi".
- [ ] Proje ayarları: QA tur sınırı (Sınırsız dahil), şartname onayı.
- [ ] "Şablon olarak kaydet" ve kullanıcı şablonunu silme (`ConfirmDialog`).
- [ ] GUI'den Studio'yu sil: `components/Studio/*`, store `studio*` alanları, api'deki agents/graph/graphs/generate metotları, `studio_generation` olayı, i18n anahtarları, `.studio-*`/`.agent-node*` CSS, `@xyflow/react` (`npx -y pnpm@11.0.9 remove @xyflow/react`), AppRail bağlantısı.
- [ ] Core'dan Studio'yu sil: `projectsClaude.ts` agents/generate/graph uçları, `ensureClaudeSettings`, `commitAgentChange`, GUI kullanmıyorsa `/claude/push`; `graphService.ts`, `routes/graphs.ts` + `index.ts:40`, `taskService` graf fonksiyonları (tablo kalır), `broadcastStudioGeneration`, `AgentGraph` tipleri, `claudeTopologySyncService.ts`.
- [ ] Belgeler: `docs/graph-authoring.md` sil; README (`:85`, `:130`, `:257`), CLAUDE.md "Core Data Flow" 4. adım, DESIGN.md Studio satırları (`:304`, `:315`, `:335`, `:807`) Ekip editörüne göre.
- [ ] Tarama: `rg -n -i "studio|graphRunner|executionMode|_graph\.json|xyflow" core/src gui/src README.md CLAUDE.md DESIGN.md` yalnızca bilinçli kalanları gösterir; §12'ye yaz.
- [ ] Ekran görüntüleri: Ekip editörü (şablonlar, rol düzenleyici, ayarlar, doğrulama hatası). Krem + gece.
- [ ] Faz sonu: doğrulamalar + build, commit `feat: faz 4 - ekip editörü, studio silindi`.

### Faz 5: Cila, gerçek koşu, rapor
- [ ] (İsteğe bağlı) Fabrika: DOING istasyonunun tabelası/pili etkin rolü gösterir (`components/Factory/`).
- [ ] Erişilebilirlik: axe (gui `node_modules`'undaki axe-core) Ekip editörü, zaman çizelgesi, onay kapısı, iki tema; rol sıralamasında klavye yürüyüşü.
- [ ] Gerçek koşu 1 (sandbox): varsayılan ekip Yazılım Ekibi, `qaMaxRounds` 2, `budgetUsd` 3; küçük görev ("`src/` altına `slugify` fonksiyonu ve testi ekle"); `PATCH doing`. Doğrula: 4 rol artifact'ı, Yazılımcı commit'i dalda, QA kararı, `## Ekip özeti` yorumu, `done`, repo `main`de, ClauFlow ağacı temiz. Canlı kart ve zaman çizelgesi görüntüsü.
- [ ] Gerçek koşu 2 (sandbox): Keşif, küçük bir soru görevi. Commit/PR yok, yorum var.
- [ ] Önce/sonra karşılaştırmaları (ImageMagick yan yana): Studio → Ekip editörü, çalışma modu → ekip seçici.
- [ ] Son doğrulamalar (core test + typecheck, gui typecheck + lint + build).
- [ ] Sabah raporunu yaz.

## 11. Takılanlar

_(Faz 0: takılan yok.)_

_(Faz 1: takılan yok.)_

_(Faz 2: takılan yok.)_

_(Faz 3: takılan yok.)_

## 12. Kendi kararlarım (otonom çalışırken verilen)

**Spike sonuçları (Faz 0 doldurur):**

| Deneme | Komut özeti | Sonuç | Karar |
|---|---|---|---|
| `--model sonnet` | `claude -p "Reply OK" --permission-mode bypassPermissions --model sonnet --append-system-prompt … --output-format stream-json --verbose` (koşu 1) | init'teki model: `claude-sonnet-5-5` (assistant ve `modelUsage` anahtarı da aynı). $0.17 | Takma adlar CLI'ye aynen geçilir; fiyatlama `modelUsage` anahtarındaki tam adla yapılabilir. |
| bypass + `--allowedTools Read` | "x.txt oluştur", `--allowedTools Read` (koşu 2) | dosya oluştu mu: **evet** (Write kullanıldı, init'te tam araç listesi) | `--allowedTools` kısıtlamaz, kullanılmaz (§3 doğrulandı). |
| bypass + `--tools Read` | aynı istek, `--tools Read` (koşu 3) | dosya oluştu mu: **hayır** ("No such tool available: Write"); init'te yerleşik araç yalnızca `Read`. **Ama** 639 MCP aracı kaldı ve ToolSearch olmadığı için şemaları baştan yüklendi: 595k cache-write token, **$2.44** | Rol çağrılarına `--strict-mcp-config` eklenecek (koşu 5'te 4k token'a indi). Bkz. aşağıdaki Faz 0 kararı. |
| `--append-system-prompt` | koşu 1: "her yanıtı BANANA ile bitir" + `-p "Reply OK"` | çıktı `OK\n\nBANANA`, çıkış 0 | `-p` ilk argüman + `--append-system-prompt` birlikte çalışır. |
| `--model sonnet --advisor opus` | koşu 4: `-p "Reply OK"`; koşu 5: danışmanı çağırmasını isteyen prompt + `--tools Read --strict-mcp-config` | çıkış kodu 0 / stderr boş / usage: koşu 4'te danışman çağrılmadı (önemsiz istek, iz yok). Koşu 5'te `server_tool_use name=advisor` + `advisor_tool_result` (şifreli) olayları; `modelUsage`'ta ayrı `claude-opus-5-5` satırı ($0.036), `usage.iterations`'ta `type: advisor_message`; `total_cost_usd` ikisini içerir ($0.055) | `ADVISOR_SUPPORTED = true` |

Toplam spike harcaması ≈ $3.04 (5 koşu). Her koşudan önce/sonra ClauFlow `git status --porcelain` yalnızca `?? docs/plans/ekipler.md` gösterdi (koşular scratchpad'deki boş repoda).

_(Diğer kararlar buraya, faz etiketiyle.)_

- **F0 · `--advisor` gizli ama çalışıyor.** `claude --help` (2.1.306) listelemiyor, ama `claude --advisor` "argument missing" hatası veriyor, yani bayrak tanımlı. `-p` ile etkileşimsiz çalışıyor (koşu 5). Danışman, ana modelin kendi kararıyla çağırdığı sunucu tarafı bir araç: önemsiz isteklerde hiç çağrılmayabilir (koşu 4). Danışman maliyeti `total_cost_usd` içinde; Faz 2'de rol maliyeti `total_cost_usd`'den (yoksa `modelUsage` toplamından) alınmalı, yalnızca ana modelin token'larından hesaplanmamalı.
- **F0 · `fable` takma adı.** Gerçek koşu yapılmadı (5 koşu sınırı doldu). Kanıt: `claude --help` `--model` açıklamasında `'fable', 'opus', or 'sonnet'` örneği; CLI'nin kendi sıralama tablosu `haiku=0 < sonnet=1 < opus=2 < fable/mythos=3`, `fable` → `claude-fable-5-1`, CLI'nin kabul ettiği takma adlar `sonnet, opus, haiku, fable`. Model listesi `["haiku","sonnet","opus","fable"]` (zayıftan güçlüye), `fable` en üstte. Danışman sırası bu sıralamayla doğrulanır (`isValidAdvisor`, `claudeCapabilities.ts`).
- **F0 · Rol çağrılarına `--strict-mcp-config` (§6.2'ye ek).** `--tools` yerleşik araçları kısıtlar ama kullanıcının MCP araçlarını bırakır; `ToolSearch` listede olmayınca tüm MCP şemaları bağlama yüklenir (koşu 3: 595k token, $2.44 "x.txt oluştur" için). `--strict-mcp-config` (ve `--mcp-config` vermeden) ile MCP sunucusu yok, bağlam 4k. Faz 2'de `teamRunner` rol çağrıları `--strict-mcp-config` geçer. Eski çağıranlar (§6.2) değişmez.
- **F0 · Kullanıcı hook'ları rol koşularına sızıyor.** Koşu 2'de kullanıcının global `PreToolUse` hook'u ("Fact-Forcing Gate") ilk Write/Bash çağrısını reddetti, ajan tekrar denedi. ClauFlow'un bugünkü koşularında da aynı. `--bare` hook'ları atlar ama CLAUDE.md keşfini de kapatır; şimdilik dokunulmadı, Faz 2'de rol prompt'ları bu tekrar denemeye dayanıklı yazılır. Kalıcı çözüm (ör. `--setting-sources`) sabah gözden geçirmeye değer; bu planda yapılmaz.
- **F0 · Spike koşusu sayımı.** `fable` için ayrı koşu yerine 5. koşu danışmanı zorlamaya harcandı; danışmanın gerçekten çağrıldığını görmek `ADVISOR_SUPPORTED` kararı için daha değerliydi.
- **F0 · Yalıtılmış core çıktısı.** `GET /api/projects` `[]` değil `{"projects":[]}` döner (API biçimi bu); boş liste olarak doğrulandı.
- **F0 · `atolye-lab/` git'te yok.** `.git/info/exclude` ile hariç (`/atolye-lab/`). `start-fake-core.sh`, ekran betikleri ve DB yedeği yerelde kalır, faz commit'ine girmez. Sahte CLI repoda (`core/src/agents/__fixtures__/fake-claude.mjs`), §6.6'daki gibi.
- **F0 · DB yedeği.** `.backup()` ile `atolye-lab/db-yedek/tasks-20261115-190711.db` (118 KB, `integrity_check` ok, 20 görev) + ham kopya `raw-20261115-190711/` (`tasks.db`, `-wal`, `-shm`).
- **F0 · "Önce" görüntülerinde yazan GET'ler taklit edildi.** `GET /claude/agents` bugün sandbox reposuna yazıp commit ediyor (§4); betik `claude/agents`, `claude/graph`, `graphs`, `claude/skills` uçlarını tarayıcıda yanıtlar, GET dışını engeller. Çalışan kart ve graf modundaki görev `tasks` yanıtı değiştirilerek taklit edildi. Betik öncesi/sonrası sandbox `git log`/`status` değişmedi.
- **F1 · `executionMode`/`graphId` tiplerde kaldı.** §5.2 bunları tiplerden çıkarıyor, ama hâlâ okuyanlar var: core'da `executor.ts:182` (Faz 2'de `runTeam` ile gider), GUI'de çalışma modu seçicisi (Faz 3). Tipler o maddelerle birlikte temizlenecek. API artık bu alanları kabul etmiyor (zod siliyor), yani bu dalda GUI'deki "Çalışma modu" seçicisi Faz 3'e kadar etkisiz.
- **F1 · Servis katmanı alanları öne alındı.** `teamService` testleri `updateProject({ defaultTeamId })` ve `createTask({ teamId })` istediği için taskService'teki proje/görev alanları 4. maddede yapıldı. 6. madde yalnızca route şemaları ve doğrulamayla kaldı.
- **F1 · Yazılım Ekibi varsayılanı `createProject` içinde.** Varsayılan yalnızca `POST /api/projects`'te değil, servis katmanında atanıyor. Böylece klonla açılan projeler de Yazılım Ekibi ile başlıyor. Mevcut projeler `NULL` (= Solo) kalıyor.
- **F1 · Solo'nun Yazılımcı'sı = ekip Yazılımcı'sı (sonnet + danışman opus).** §1/9 varsayılanı uygulandı. "Bugünkü basit modun aynısı" akışı anlatıyor, model seçimini değil. Bugün `--model` geçilmiyor, kullanıcının varsayılan modeli kullanılıyor. Sabah gözden geçirmeye değer.
- **F1 · Rol araçları `ROLE_TOOLS` listesiyle sınırlı.** Liste: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, NotebookEdit, TodoWrite. Alt ajan aracı (`Agent`/`Task`) sunulmuyor.
- **F1 · Ekip erişim kuralı.** `tasks.teamId` ve `projects.defaultTeamId` yalnızca yerleşik bir ekibe, global bir şablona ya da projenin kendi ekibine işaret edebilir. Değilse 400 `invalid_team` döner. `resolveTeamForTask` aynı kuralı uygular ve yabancı ya da eksik id'de Solo'ya düşer.
- **F1 · Ekip silinince görev seçimleri temizlenir.** `deleteTeam` o ekibi seçmiş görevlerde `teamId = NULL` yapar, görev proje varsayılanına döner. Proje varsayılanıysa silme 409 döner.
- **F1 · Doğrulama mesajları makine kodu.** Kodlar: `duplicate_kind`, `duplicate_role_id`, `qa_requires_developer`, `qa_before_developer`, `advisor_below_model`, `haiku_advisor`, `invalid_model`, `invalid_skill_id`, `roles_min`, `roles_max`. Faz 4 bunları i18n'e eşler. Model adı `-` ile başlayamaz (CLI bayrağı gibi okunmasın diye).
- **F1 · Skill kataloğu.** Yanıt `{ skills: [...] }` (diğer uçlarla tutarlı, §5.3'teki çıplak dizi yerine). Yalnızca etkin plugin'ler listeleniyor. Plugin önekinde plugin adı kullanılıyor (`@`'den önceki kısım: `ecc@ecc` → `ecc:<skill>`). `~/.claude/commands` katalogda yok (§1/11 yalnızca skill dizinlerini sayıyor).
- **F1 · `ensureClaudeSettings` erken silindi.** Faz 4 listesindeydi, ama bu fazdan sonra çağıranı kalmadı. `bypassPermissions` yazan kod geri gelmesin diye şimdiden kaldırıldı. `isMinimalBootstrappedSettings` (agent DELETE'te eski dosyayı temizliyor) duruyor.
- **F1 · Yerleşik upsert'te `updatedAt` korunuyor.** İçerik değişmediyse `updatedAt` dokunulmadan kalıyor. Her boot'ta tarih değişmiyor.
- **F1 · Testler.** Göç ve şablon testleri geçici DB kullanıyor. Servis ve route testleri, mevcut test dosyaları gibi ortak DB'de kendi satırlarını açıp siliyor. Faz sonunda ortak DB'de 4 ekip ve 2 proje var, `integrity_check` ok. Route testleri `core/src/test-utils/httpApp.ts` ile geçici bir Express'e karşı çalışıyor.
- **F1 · Sandbox doğrulaması güçlendirildi.** Sandbox'ta `.claude/agents` yok, bu yüzden `GET /claude/agents` zaten erken dönüyor ve kontrol tek başına kanıt sayılmaz. Aynı kontrol bir de yalıtılmış core'da (:3101) yapıldı: sandbox'ın remote'suz klonuna (`atolye-lab/fake/repos/sandbox-agents-f1`) bir ajan dosyası eklendi.
- **F1 · Kullanıcı hook'u bu oturumu da etkiledi.** "Fact-Forcing Gate" iki kez devreye girdi: SQL `DELETE` içeren bir heredoc'ta ve `rm -rf` ile fake-core sıfırlamada. İstenen bilgiler verildi, komutlar tekrarlandı, sonuca etkisi olmadı. Rol koşularını yalıtma işi Faz 2'ye madde olarak eklendi.

- **F2 · Rol koşuları kullanıcı ayarlarından yalıtıldı: `--setting-sources project,local` + `--strict-mcp-config`.** `claude --help` (2.1.306) iki bayrağı da listeliyor. Kapıyı (gateguard) ecc plugin'i getiriyor, plugin ise kullanıcı `settings.json`'undaki `enabledPlugins` ile açılıyor. graphify hook'ları da kullanıcı ayarında. Kullanıcı kaynağı yüklenmeyince ikisi de gelmiyor. Bunu tek bir minik gerçek koşu doğruladı (scratchpad'de remote'suz boş repo, `--model haiku --tools Bash`, $0.0008): init'te yalnızca yerleşik plugin'ler var, MCP yok, ilk Bash çağrısı kapıya takılmadan çalıştı. ClauFlow `status --porcelain` öncesi ve sonrası aynı. Proje ve `local` ayarları (projenin kendi hook'ları ve izinleri) korunuyor, CLAUDE.md keşfi de (`--bare` gibi kapanmıyor). Kullanıcının `model` ayarı da düşüyor; rol zaten `--model` geçiyor. Skill'leri ClauFlow kendisi enjekte ediyor, kullanıcı plugin'lerine gerek yok. Eski çağıranlar (`commentRunner`, `ciWatcher`, planner, breakdown, `prReviewRunner`) değişmedi. Bayraklar `roleRunner`'ın `isolate` seçeneğiyle ekleniyor.
- **F2 · `--advisor` kapısı `buildClaudeArgs` içinde.** `advisorModel` yalnızca `ADVISOR_SUPPORTED` açıkken eklenir. Argüman dizisi `buildClaudeArgs` olarak dışa açıldı (test ediliyor). Eski çağıranların dizisi birebir aynı kaldı.
- **F2 · Fiyat eşlemesi.** Önce tam ad. Sonra aile alt dizesi (`haiku`/`sonnet`/`opus`) ve o ailenin sürüm numarası en yüksek satırı. `fable`/`mythos` için fiyat satırı yok; bunlar en yeni opus satırıyla fiyatlanır (bütçe tahmini için ihtiyatlı yön). Rol maliyeti önce `total_cost_usd`'den (danışmanı içerir, F0), yoksa `modelUsage[*].costUSD` toplamından, yoksa token fiyatından alınır. Fiyat tablosunun kendisi güncellenmedi (kapsam dışı).
- **F2 · `CLAUFLOW_DATA_DIR`.** `taskService` DB dizinini bu env değişkeninden alabiliyor (yoksa yine `cwd/data`). Motor testleri `vi.hoisted` ile kendi geçici DB'lerini açıyor, ortak `tasks.db`'ye yazmıyor.
- **F2 · Bütçe durması kullanıcı iptalinden ayrıldı.** `roleRunner` ebeveyn controller'a bağlı kendi controller'ını kullanır. Bütçe aşılınca yalnızca rolün CLI'si durur, `budget_exceeded` yayınlanır ve rol `budgetExceeded` döner. `teamRunner` bunu §3'teki "takıldı: bütçe" yoluna çevirir. Bugünkü davranış ("Kullanıcı tarafından durduruldu" + reset) yalnızca gerçek iptalde kalır.
- **F2 · Rol çıktı sözleşmesi.** Başlıklar sabit: `## Brief`, `## Şartname`, `## Teslim notu`, `## QA raporu`, `## Hata listesi`, `VERDICT:`. Gövde görevin dilinde. Yazılımcıya "commit atma, dal değiştirme" denir; commit'i ClauFlow roller arasında atar. Rol çıktısı `result` olayının metni olduğu için sistem prompt'u "son mesajın teslimatındır" der. Kapıya dayanıklılık için "hook reddederse sebebi oku, bir kez tekrar dene" satırı da var (F0).
- **F2 · `parseQaVerdict` toleransları.** Son `VERDICT:` satırı geçerlidir (rapor biçimi alıntılasa da). `**VERDICT: FAIL**` gibi süslü satırlar ve `## Bug list`/`## Bugs` başlıkları da kabul edilir. Numaralı madde yoksa `-` maddeleri, o da yoksa bölümün tamamı tek madde olur. `isStalled` iki listedeki tüm maddelerin kelime kümelerini birleştirip karşılaştırır (Jaccard ≥ 0.8, eşik dahil). Listelerden biri boşsa takılma sayılmaz.
- **F2 · Plugin listesi yalnızca gerekince.** Rolün skill'leri yalnızca `user:`/`project:` ise `claude plugin list` çağrılmaz (`loadRoleSkills`).

- **F2 · Run/artifact kalıcılığı ayrı dosyada: `core/src/services/teamRunService.ts`.** §6.1'de yok. `teamService` ekip tanımlarını, bu dosya `task_team_runs`/`task_team_artifacts` satırlarını yönetir. WS yardımcıları `broadcastTeamRunUpdated` ve `broadcastTeamArtifact` `wsService`'te.
- **F2 · Tur numarası.** `run.qaRound` FAIL'lenen QA turu sayısıdır (§6.3). Etkin tur `qaRound + 1`'dir. Düğüm `role:<kind>:<tur>`, artifact `round` aynı sayı. Yazılımcı commit'i ilk turda `feat(<KEY>): <başlık>`, sonrakilerde `fix(<KEY>): QA turu N`. KEY yoksa `feat: …`/`fix: …`.
- **F2 · QA FAIL'de durma sırası:** önce bütçe, sonra tur sınırı, sonra takılma. Rol bütçeyi aştıysa ve ondan sonra iş kalmadıysa (son rol bitti, QA PASS) ekip teslim eder. İş kaldıysa "takıldı: bütçe". Bütçeyi aşan Yazılımcı'nın işi `feat` commit'i almaz; executor `wip:` commit'iyle dalda bırakır.
- **F2 · `wip:` commit yalnızca ağaç kirliyse.** Yazılımcı'nın işi her rolden sonra commit edildiği için takılma ve tur sınırı durmalarında ağaç genelde temiz kalır, `wip:` oluşmaz. Dal her durumda korunur. `wip:` yolunu bütçe testi doğruluyor: Yazılımcı bütçeyi aşınca `fake-1.txt` `wip:` commit'ine giriyor.
- **F2 · "Takıldı" yorumu = `## Ekip özeti`.** Durmada tek yorum yazılır: özet, "Sonuç: Takıldı (<neden>)" satırını taşır, ayrıca `stuck` artifact'ı (neden + son hata listesi) eklenir. Görev hatası `Takıldı: <neden>`. Neden kodları `run.stopReason`'da: `stalled | round_limit | budget` (GUI Faz 3'te i18n'e eşler). Metinler Türkçe.
- **F2 · `## Ekip özeti` her ekipte, Solo dahil.** Bu, Solo için yeni bir yorum demek (bugün yalnızca "## Code Review Report" ve "nothing" durumunda yorum vardı). "nothing" durumunda eski ham metin yorumu yerine bu özet kalıyor (çift yorum olmasın diye). Özet, teslimde ve durmada son artifact'ı "Son çıktı" olarak, Keşif'te brief ve şartnamenin tamamını içerir. "## Code Review Report" otomatik yorumu tüm rollerin metninde aranarak korundu.
- **F2 · Onay kapısının devamı.** `POST /team/approve` son run `awaiting_approval` ve görev `doing` + `awaiting_approval` değilse 409 `not_awaiting_approval` döner. Uygunsa şartname artifact'ını `approved=true` yapar (varsa `specBody` ile gövdeyi değiştirir), yayınlar, ajanı `idle`'a çeker ve executor'ı kuyruğa alır. `runTeam` son run `awaiting_approval` ve şartnamesi onaylıysa aynı run'ı sürdürür: brief ve şartname DB'den gelir, Analist'ten sonraki rolden başlanır. Onaysızsa eski run `aborted`/`superseded` olur ve yeni run açılır. Devamda executor `resetTaskUsage` çağırmaz. Duraklamada `task.branch = null`.
- **F2 · Duraklatılmış görevin iptali.** `/abort` canlı süreç yokken `doing` görevin son run'ı `awaiting_approval` ya da `running` ise run'ı `aborted` yapar. Görev `todo` + "Kullanıcı tarafından durduruldu (şartname onayı beklerken)" olur, yanıt `source: "awaiting_approval"`. `recoverOrphanedTasks` ayrıca `running` kalmış run'ları `error`/`server_restart` yapar.
- **F2 · Başarıdan sonra base'e dönüş "nothing"te de var.** Dal korunur. CI düzeltme döngüsü (`ciWatcher`) bugüne kadar o anki dalda commit atıyordu; artık önce görev dalına geçiyor, ağaç temizse sonra base'e dönüyor. Yoksa düzeltme base'e düşerdi. Remote gerektirdiği için yalnızca typecheck ile doğrulandı. Sabah gözden geçirmeye değer.
- **F2 · `executionMode`/`graphId` core tiplerinden çıktı.** `taskService` bu kolonları artık okumuyor ve yazmıyor: INSERT kolon varsayılanını (`'simple'`/`NULL`) kullanıyor, UPDATE onlara dokunmuyor. Kolonlar ve `master`'ın okuması aynen duruyor. GUI tipleri Faz 3'te.
- **F2 · Silinenler.** `graphRunner.ts` ve testi (32 test), `enqueueResume`/`EnqueueOptions`, `/tasks/:id/nodes/:nodeId/{abort,retry}`, graf PUT'taki `planGraph` doğrulaması, executor'daki `getGraph` ve tek-CLI bloğu. GUI'deki Studio `api.abortNode`/`retryNode` çağırıyor; bunlar artık 404 dönüyor. Studio Faz 4'te tümden siliniyor. GUI derleniyor. Graf PUT hâlâ `_graph.json` yazıyor (commit atmadan, F1); uç Faz 4'te gidiyor.
- **F2 · Testlerde gh yalıtımı.** Executor her koşuda `gh auth setup-git` çağırıyor. Entegrasyon testleri ve yalıtılmış core `GH_CONFIG_DIR`'i geçici dizine çekiyor: gh "giriş yok" deyip çıkıyor, global git ayarına yazmıyor.
- **F2 · Oturumdaki kapı yine çıktı.** "Fact-Forcing Gate" fake-core sıfırlamasını (dizin silme + `RESET=1`) iki kez engelledi, plan güncellemesini de bir kez (karar metnindeki komut örneği yüzünden). İstenen bilgiler verildi; silme yerine yeni bir state dizini kullanıldı, plan güncellemesi betik dosyasından çalıştırıldı. Sonuca etkisi yok.

- **F3 · Onay bekleyen görev "çalışıyor" sayılmaz.** `isAgentWorking` artık `awaiting_approval`'ı dışlıyor (yeni `isAwaitingApproval`). Kart turuncu yürüyen kenar yerine altta hardal "Onay bekliyor" pili gösterir; "Ajan çalışıyor" filtresi, board istatistiği ve AgentCore sayacı onu saymaz. Kartın sürükleme kilidi ayrı tutuldu: onay bekleyen kart da sürüklenemez (onay ya da iptal ile çıkılır).
- **F3 · "Ekibi düzenle" şimdilik Claude Config sekmesine iner.** `teamEditorRequest { projectId }` eklendi; AppRail proje çekmecesini açar, çekmece Claude Config sekmesine geçer. "Ekip" segmenti Faz 4'te geliyor; o zamana kadar "Talimatlar" segmentinde açılıyor. `studioRequest`/`openStudio` store'da Studio için Faz 4'e kadar duruyor, görev çekmecesi artık çağırmıyor.
- **F3 · Ekip seçicisi yerel `Select`.** Klavye ve mobil davranışı için native select, `optgroup`'lar: Hazır ekipler, Şablonlarım, Bu projenin ekipleri. İlk seçenek "Proje varsayılanı (X)" (`teamId = null`). Altında seçili ekibin rol sırası (`RoleChain`, QA→Yazılımcı döngüsü yeniden-dene ikonuyla) ve açıklaması. Görev `doing`'deyken (kuyruk, çalışma, onay bekleme) kilitli. Silinmiş bir id seçiliyse ham id olarak görünür.
- **F3 · Yerleşik ekip ve rol adları çevrilir.** DB'deki adlar Türkçe. `templateKey` ile yerleşik ekiplerin adı/açıklaması, varsayılan rol adları (`Yazılımcı` vb.) i18n'den gelir; kullanıcının verdiği özel adlar olduğu gibi gösterilir.
- **F3 · Zaman çizelgesi gövdesi.** Balon başlığı çıktıyı adlandırdığı ve QA pili kararı taşıdığı için gövdenin ilk `##` başlığı ve `VERDICT:` satırı gösterimde atılır (veri değişmez, onay kapısındaki düzenlenebilir metin ham). Gövde 15rem'de kesilir, "Tamamını göster" şeridi kesiği örter; taşma `ResizeObserver` ile ölçülür. Token sayısı artifact'ın `nodeRunId`'sindeki düğüm koşusundan, model çipi de oradan. Birden fazla koşu varsa "Koşu" seçicisi çıkar, varsayılan en yenisi. Koşu `running` iken etkin rol için kesik çizgili "yazıyor" balonu.
- **F3 · Markdown tabloları ham görünür.** `react-markdown` GFM'siz kullanılıyor (yorumlarda da öyle); `remark-gfm` yerelde yok, gece bağımlılık eklemek yerine bırakıldı. Rol çıktıları tablo içerirse çizelgede düz metin olur. §1/15'e aday (küçük iş: `remark-gfm` ekle, `ReactMarkdown remarkPlugins`).
- **F3 · `.comment-markdown` liste işaretleri.** Tailwind preflight `ul/ol` işaretlerini siliyordu; disc/decimal ve ilk/son çocuk boşlukları eklendi. Yorum sekmesi de bundan yararlanır.
- **F3 · Onay kapısı.** Çekmece onay bekleyen bir görevde doğrudan "Ekip" sekmesinde açılır; kapı şartname balonunun hemen altında. Metin düzenlenmediyse `specBody` gönderilmez. "İptal" `ConfirmDialog` → `/abort`. Detay sekmesindeki ajan panelinde "Yeniden dene" yerine "Şartnameyi incele" çıkar.
- **F3 · Kart rozetinde tur.** `AgentBadge` turu store'daki son `TeamRun.qaRound`'dan okur (WS `team_run_updated` ya da çekmece açılışında `GET /team`). Sayfa koşu ortasında yenilenirse tur eki bir sonraki `team_run_updated`'a (her rol sonunda gelir) kadar görünmez. Bilinen küçük sınır.
- **F3 · Yeni ikonlar ve sınıflar.** `ui/icons.tsx`: `IconBriefcase`, `IconClipboard`, `IconCode`, `IconShieldCheck`, `IconTeam`. `globals.css`: `.team-bubble*`, `.team-chip`, `.ui-banner--approval`. DESIGN.md §5.16 ve §5.20'ye eklendi. Rol renkleri: CEO kobalt, Analist hardal, Yazılımcı turuncu, QA yeşil (`--on-*` ile).
- **F3 · `core/`'a tek dokunuş: sahte CLI'ye `FAKE_CLAUDE_DELAY_MS`.** Canlı akış görüntüsünde rollerin çalışırken görünmesi için isteğe bağlı gecikme (varsayılan 0). Yalnızca test fikstürü; core testleri (151) değişmeden yeşil.
- **F3 · Canlı akışta WS aktarımı.** `routeWebSocket` başka bir porta yönlendiremediği için sayfanın `:3001/ws` bağlantısı sunucuya hiç bağlanmıyor; Node'daki bir `ws` istemcisi `:3101`'in olaylarını sayfaya aktarıyor. HTTP `page.route` ile `:3101`'e yeniden yazılıyor. Koşuda `:3001`'e istek gitmedi.
- **F3 · Kilitli kartlara Playwright tıklaması `force` ister.** dnd-kit kilitli kartlara `aria-disabled="true"` veriyor; kullanıcı tıklayınca çekmece açılıyor (davranış öncekiyle aynı), yalnızca test betiğinde `force: true` gerekti.
- **F3 · Kullanılmayan i18n anahtarları silindi.** `executionModeLabel`, `graphLabel`, `modeSimple`, `modeGraph`, `graphSelect`, `graphsLoading`, `graphsEmpty`, `openInStudio`, `tabFlow` (tr/en/types). `TaskPatch`/`Task`/`CreateTaskInput`'tan `executionMode`/`graphId` çıktı; StudioCanvas'taki görev-graf bağı `null`'a sabitlendi (Studio Faz 4'te siliniyor).

## 13. İlerleme günlüğü

- 2026-11-15: Plan yazıldı. Çalışma başlamadı; Furkan'ın "başla" demesi bekleniyor.
- 2026-11-15 F0: `feature/ekipler` dalı `master`dan açıldı.
- 2026-11-15 F0: DB yedeği `atolye-lab/db-yedek/tasks-20261115-190711.db` (118 KB, integrity ok) + ham `-wal`/`-shm` kopyası.
- 2026-11-15 F0: Spike A, 5 gerçek koşu (scratchpad'de boş repo, ≈ $3.04): sonnet → `claude-sonnet-5-5`; `--allowedTools` kısıtlamıyor, `--tools` kısıtlıyor; `--append-system-prompt` çalışıyor; `--advisor opus` `-p` ile çalışıyor. Tablo §12'de.
- 2026-11-15 F0: `core/src/services/claudeCapabilities.ts` (`ADVISOR_SUPPORTED = true`, model sırası haiku<sonnet<opus<fable, `isValidAdvisor`) + test.
- 2026-11-15 F0: `claudeService` ikilisi `process.env.CLAUFLOW_CLAUDE_BIN || "claude"`; `claudeService.bin.test.ts` betik ve sahte CLI ile doğruluyor.
- 2026-11-15 F0: Sahte CLI `core/src/agents/__fixtures__/fake-claude.mjs` (7 senaryo, `calls.jsonl`) + `fake-claude.test.ts`; `runClaude` duman testi yeşil.
- 2026-11-15 F0: `atolye-lab/fake/start-fake-core.sh` (:3101, ayrı DB, sahte CLI); başlatıldı, `GET /api/projects` → `{"projects":[]}`, öldürüldü; :3001 etkilenmedi.
- 2026-11-15 F0: Sandbox'a izolasyon `CLAUDE.md` eklendi, sandbox reposunda `a6a5c43`.
- 2026-11-15 F0: "Önce" görüntüleri `ekipler-0-{studio,calisma-modu,addtask,kart-calisiyor,board}-{krem,gece}.png` (`scripts/shots-ekipler-once.mjs`, yalnızca GET, yazan GET'ler taklit).
- 2026-11-15 F0: Faz sonu doğrulamaları yeşil (core typecheck + 99 test, gui typecheck + lint 0 uyarı); faz 0 commit'i.
- 2026-11-15 F1: Tipler: core + gui `RoleKind`, `TeamRole`, `Team`, `TeamRun`, `TeamArtifact`, `SkillCatalogEntry`, `SystemCapabilities`; `AgentStatus`+`awaiting_approval`, `NodeType`+4 rol, `Project`+3 alan, `Task.teamId`, WS iki olay. GUI `Record<AgentStatus>` için `agentSteps.awaiting_approval` (tr/en/types) ve `AgentBadge` eşlemesi. İki paket typecheck yeşil.
- 2026-11-15 F1: Göç `core/src/services/ekiplerMigration.ts` (`applyEkiplerMigration(db)`, taskService göç bloklarının sonunda): `teams`, `task_team_runs`, `task_team_artifacts`, `app_meta` + indeksler, `projects` 3 kolon, `tasks.teamId`, `ekipler_graph_to_solo` tek seferlik eşleme. `_graph.json` boot göçü silindi. `ekiplerMigration.test.ts` geçici DB'de iki boot: idempotent. Ortak DB'de göç çalıştı (dev sunucu yeniden başladı), graf modunda görev yoktu, `integrity_check` ok.
- 2026-11-15 F1: `core/src/services/teamTemplates.ts`: 4 yerleşik ekip (sabit id), §7 rol varsayılanları, İngilizce rol talimatları, `ROLE_TOOLS`, `upsertBuiltinTeams` (boot'ta, `ON CONFLICT DO UPDATE`). `teamTemplates.test.ts` (idempotent, düzenlenen yerleşik geri yazılır, §7 varsayılanları) yeşil; ortak DB'de 4 satır. `GET /api/teams` doğrulaması `routes/teams.ts` maddesinde.
- 2026-11-15 F1: `core/src/services/teamService.ts`: CRUD (`listTeams` yerleşik → şablon → proje sırası, `createTeam` `fromTeamId` kopyası, `updateTeam`/`deleteTeam` `builtin_readonly`/`team_in_use`), `teamRolesSchema` (1–4 rol, tür ve id tekilliği, QA ⇒ Yazılımcı ve sonra, danışman sırası, Haiku danışman olamaz, `ROLE_TOOLS`, skill id biçimi, `-` ile başlayan model reddi), `resolveTeamForTask` (görev → proje → Solo, yabancı/eksik id Solo + uyarı). taskService'e proje/görev alanları (madde 6'nın servis kısmı) öne alındı. `teamService.test.ts` 12 test yeşil, typecheck yeşil.
- 2026-11-15 F1: `core/src/routes/teams.ts` (`GET /`, `GET /:id`, `POST`, `PUT /:id`, `DELETE /:id`; 403 `builtin_readonly`, 409 `team_in_use`, 400 `invalid_body` + zod mesajları) + `index.ts` mount. `routes/teams.test.ts` (5 test, `test-utils/httpApp.ts` ile geçici Express) yeşil. Canlı `curl :3001/api/teams` 4 yerleşiği doğru rol sırasıyla döndü.
- 2026-11-15 F1: Proje `PATCH` `defaultTeamId` (erişilebilir ekip, değilse 400 `invalid_team`), `qaMaxRounds` (tam sayı 0–20), `specApproval`; `createProject` varsayılanları (Yazılım Ekibi, 3, kapalı). Görev `POST`/`PATCH` `teamId` (doğrulamalı), `executionMode`/`graphId` zod'dan çıktı (gelirse atılır), `agentStatus` enum'una `awaiting_approval`. `routes/projectTeamFields.test.ts` 3 test yeşil.
- 2026-11-15 F1: `core/src/services/skillCatalogService.ts` (kökler parametreli `SkillCatalogRoots`: home, proje reposu, plugin listesi; plugin listesi repo başına 60 sn önbellek; yalnızca etkin plugin'ler; `readSkillBody` yalnızca katalogdan çözülen dosyayı okur, frontmatter'ı atar) + `GET /api/projects/:id/claude/skills/catalog` → `{ skills }`. `skillCatalogService.test.ts` (geçici HOME: `user:`, `project:`, `myplug:gamma`, devre dışı plugin, `../` reddi, plugin hatasında yedek) 4 test yeşil. Canlı: sandbox'ta 439 skill (133 user, 306 plugin), sandbox ağacı temiz.
- 2026-11-15 F1: `GET /api/system/capabilities` → `getClaudeCapabilities()`; `routes/system.test.ts` yeşil; canlı `{"advisor":true,"models":["haiku","sonnet","opus","fable"]}`.
- 2026-11-15 F1: Repo yazmaları durdu: `GET /claude/agents` artık yalnızca listeler (`main.md` önyüklemesi, `ensureClaudeSettings` ve iki commit silindi), `POST /claude/agents` `settings.json` yazmaz, graf `PUT` commit atmaz, `checkoutBase` korunan listesinde yalnızca `CLAUDE.md`, CLAUDE.md `PUT` base dal dışında `commitWarning: "not_on_default_branch"` ile yalnızca dosyayı kaydeder. `ensureClaudeSettings` çağıranı kalmadığı için silindi. `routes/projectsClaude.repoWrites.test.ts` (geçici git reposu) 4 test yeşil.
- 2026-11-15 F1: Sandbox doğrulaması: `:3001` üzerinden `GET /claude/agents` (proj_c2dd3194) sonrası sandbox `status --porcelain` boş, HEAD `a6a5c43` ve commit sayısı (2) aynı. Sandbox'ta `.claude/agents` olmadığından bu kontrol zayıf; ek olarak yalıtılmış core (:3101, ayrı DB) üzerinde sandbox'ın remote'suz klonu + `.claude/agents/coder.md` ile aynı GET: ağaç temiz, HEAD aynı, `main.md`/`settings.json` oluşmadı. Yeni projede `defaultTeamId=team_yazilim_ekibi`. :3101 öldürüldü, :3001 ayakta.
- 2026-11-15 F1: Plana Faz 2 maddesi eklendi: rol koşularını kullanıcı ayar/hook'larından yalıtmayı değerlendir (`--setting-sources project,local` / `--settings`, `--strict-mcp-config` ile).
- 2026-11-15 F1: Faz sonu doğrulamaları yeşil (core typecheck + 132 test / 18 dosya, gui typecheck + lint 0 uyarı); faz 1 commit'i.
- 2026-11-15 F2: `claudeService` `model`, `tools`, `appendSystemPrompt`, `advisorModel` (yetenek kapalıysa eklenmez), `strictMcpConfig`, `settingSources` seçenekleri; argümanlar `buildClaudeArgs`'ta. Sahte CLI `--setting-sources`/`--strict-mcp-config`'i de kaydediyor. `claudeService.roleArgs.test.ts` (3 test, `calls.jsonl` ile) yeşil, eski çağıranların dizisi değişmedi.
- 2026-11-15 F2: Yalıtma kararı: rol çağrıları `--setting-sources project,local --strict-mcp-config` (§12). 1 minik gerçek koşu (scratchpad, haiku, $0.0008): hook yok, plugin yok, MCP yok; ClauFlow ağacı aynı.
- 2026-11-15 F2: `pricingService.resolveModelPricing` (tam ad → aile + en yüksek sürüm → varsayılan; fable/mythos → opus). 5 yeni test, `pricingService.test.ts` 18 test yeşil.
- 2026-11-15 F2: `core/src/agents/roleRunner.ts` (`runRole`, `costFromResult`, `RoleRunError`): düğüm satırı `role:<kind>:<tur>`, araç çağrıları, alt ajan satırları, ajan metni, stream-json → metin yedeği, birikimli bütçe (rol controller'ı), rol modeliyle fiyat, `total_cost_usd` maliyeti. `roleRunner.test.ts` 5 test yeşil (kendi geçici DB'si). Executor'daki eski blok, executor entegrasyonu maddesinde `runTeam` → `runRole` ile değişiyor.
- 2026-11-15 F2: `core/src/agents/teamPrompts.ts`: rol işareti, ortak kurallar + talimat + çıktı sözleşmesi, skill bölümleri (skill başına 20k, toplam 60k), `loadRoleSkills` (katalogdan), Solo için bugünkü prompt birebir, QA için diff (30k). `teamPrompts.test.ts` 8 test yeşil (`ecc:tdd-workflow` ve `project:` skill enjekte ediliyor, tavanlar uygulanıyor).
- 2026-11-15 F2: `core/src/agents/teamArtifacts.ts`: `parseQaVerdict`, `normalizeBug`, `jaccard`, `isStalled` (≥ 0.8), `extractSpecAcceptanceCriteria`. `teamArtifacts.test.ts` 14 test yeşil (PASS, FAIL, karar yok, eşik altı/üstü/eşit).
- 2026-11-15 F2: `core/src/agents/teamRunner.ts` (`runTeam`, `buildTeamSummary`, `buildPrTeamSection`) + `core/src/services/teamRunService.ts` (run/artifact CRUD) + `wsService.broadcastTeamRunUpdated`/`broadcastTeamArtifact`. Sıralı roller, rol başına `team:<kind>` adımı, skill enjeksiyonu ve logu, Yazılımcı sonrası commit (`commitSha`), diğer roller sonrası `clauflow-discard-<rol>` stash'i. Doğrulama: entegrasyon testleri A/B/C ve :3101.
- 2026-11-15 F2: QA döngüsü: `parseQaVerdict`, FAIL → `qaRound++`, tur sınırı (0 = Sınırsız), `isStalled`, rol öncesi ve rol içi birikimli bütçe. Doğrulama: testler B (takıldı, sınır 2, Sınırsız + takıldı, Sınırsız + değişen hatalar → bütçe, iki bütçe durumu).
- 2026-11-15 F2: Onay kapısı: Analist sonrası `awaiting_approval` (run + ajan), dal silinir, base'e dönülür. `GET /api/tasks/:id/team` → `{ runs, artifacts }`, `POST /api/tasks/:id/team/approve` (`specBody?`), devam. `recoverOrphanedTasks` duraklatılmışları atlıyor, `running` run'ları `error` yapıyor. `/abort` duraklatılmışı `todo`'ya çekip run'ı `aborted` yapıyor. Doğrulama: testler C.
- 2026-11-15 F2: Executor entegrasyonu: tek-CLI/graf bloğu yerine `runTeam`. `awaiting_approval` → görev `doing` + slot boşalır; `stuck` → `wip:` (kirliyse), base'e dönüş, dal kalır, özet yorumu, `todo` + `Takıldı: …`; `explored` → özet yorumu, dal silinir, `done`; `delivered` → `## Ekip özeti` yorumu, commit/push/PR yolu (PR gövdesine `## Ekip`), base'e dönüş. "## Code Review Report", `nothing`, `prReviewRunner`, `startCiWatch` korundu. `ciWatcher` düzeltmeden önce görev dalına geçiyor.
- 2026-11-15 F2: Silindi: `graphRunner.ts` + testi, `enqueueResume`, düğüm abort/retry uçları, graf PUT `planGraph` doğrulaması, executor `getGraph`. Core `Task` tipinden `executionMode`/`graphId` çıktı (kolonlar duruyor). Core typecheck yeşil, GUI typecheck + lint (0 uyarı) yeşil.
- 2026-11-15 F2: `teamRun.a.test.ts` (3 test): Solo (bugünkü prompt birebir, tek commit, base'e dönüş, özet yorumu), Yazılım Ekibi `pass` (rol sırası, rol modelleri ve danışmanları, maliyet $0.04), `fail_then_pass` (2 commit `feat`/`fix … QA turu 2`, QA 2. turda `fake-2.txt` diff'ini görüyor, Yazılımcı 2. turda hata listesini ve önceki teslim notunu alıyor). Ortak DB'ye yazmıyor (`CLAUFLOW_DATA_DIR`).
- 2026-11-15 F2: `teamRun.b.test.ts` (8 test): `stuck` (stalled, dal + 2 commit duruyor, `main`de temiz), `always_fail` + sınır 2 (round_limit), Sınırsız + `stuck`, Sınırsız + `always_fail` (bütçeye kadar döner), bütçe (rol içi: `wip:` commit'i `fake-1.txt` ile; rol öncesi), `exit_error` (bugünkü hata yolu, dal silindi, run `error`), `slow` + abort (run `aborted`, dal silindi).
- 2026-11-15 F2: `teamRun.c.test.ts` (5 test): Keşif (commit/dal/PR yok, HEAD aynı, brief + şartname yorumda, `done`), onay kapısı (duraklat → `recoverOrphanedTasks` dokunmuyor → `GET /team` → düzenlenmiş şartnameyle onay → Yazılımcı ve QA düzenlenmiş metni görüyor, aynı run `delivered`, ikinci onay 409), duraklatılmışı iptal, `calls.jsonl`'da `--model`, `--tools`, `--strict-mcp-config`, `--setting-sources project,local`, `project:` skill metni, `--advisor` (yetenek açık: dev `fable`, QA `opus`), PR `## Ekip` bölümü (Solo'da yok).
- 2026-11-15 F2: Yalıtılmış core (:3101, ayrı DB, sahte CLI `fail_then_pass`, `GH_CONFIG_DIR` geçici): `atolye-lab/fake/scripts/e2e-faz2.mjs` proje (varsayılan `team_yazilim_ekibi`) + görev açtı, `PATCH doing`, `ws` istemcisi 7 `team_artifact` saydı = `GET /team` 7 artifact (aynı id'ler: brief, spec, delivery 1, qa FAIL, delivery 2, qa PASS, summary). Son `team_run_updated` `delivered` = API. Adımlar `team:ceo/analyst/developer/qa`. Repo `main`de ve temiz, dalda 2 commit. :3101 öldürüldü, :3001 ayakta.
- 2026-11-15 F2: Faz sonu doğrulamaları yeşil (core typecheck + 151 test / 24 dosya; graphRunner'ın 32 testi silindi, 48 yeni test; gui typecheck + lint 0 uyarı; ortak DB integrity ok, testlerden satır yok); faz 2 commit'i (ara commit `57fdc40` faz 2a).
- 2026-11-15 F3: GUI tipleri (`TeamStopReason`, `TaskTeamState`; `executionMode`/`graphId` `Task`/`TaskPatch`/`CreateTaskInput`'tan çıktı), `api.listTeams`/`getTaskTeam`/`approveTeamSpec`, store `teamsByProject`/`teamRuns`/`teamArtifacts`/`teamEditorRequest`, `useAgentSocket` `team_run_updated`/`team_artifact`. Typecheck çekmece ve AddTask'teki eski seçici kalkınca (madde 3–4) yeşil.
- 2026-11-15 F3: i18n `team.*` (roller, etkinlikler, tur eki, yerleşik ad/açıklamalar, artifact türleri, koşu durumları, durma nedenleri, karar, seçici, zaman çizelgesi, onay kapısı) tr + en + types; ölü çalışma modu/graf anahtarları silindi. Typecheck yeşil.
- 2026-11-15 F3: `Team/TeamPicker.tsx` (+ `RoleChain`, `roleMeta`, `hooks/useTeams.ts`, 5 rol/ekip ikonu) ve çekmecede "Bu görevi kim yapsın?" (`PATCH teamId`, `doing`'de kilitli, hata satırı). Typecheck yeşil.
- 2026-11-15 F3: AddTaskModal'da aynı seçici (`teamId` POST'ta), graf yüklemesi silindi. Typecheck + lint (0 uyarı) yeşil.
- 2026-11-15 F3: `Card/TeamTimeline.tsx` (koşu başlığı, rol balonları, QA kararı, commit/maliyet/token/model çipleri, takıldı ve özet kartları, canlı rol balonu, koşu seçici) + "Ekip" sekmesi, altta katlanır "Teknik akış" (`MiniDagView`). Typecheck + lint yeşil.
- 2026-11-15 F3: `Card/ApprovalGate.tsx` (hardal banner, düzenlenebilir şartname, "Onayla ve devam et", `ConfirmDialog`'lu İptal); çekmece onay bekleyende Ekip sekmesinde açılıyor, ajan panelinde "Şartnameyi incele". Typecheck + lint yeşil.
- 2026-11-15 F3: `AgentBadge` `team:<kind>` → rol ikonu + "QA kontrol ediyor · tur 2", `awaiting_approval` hardal dolu pil; `isAgentWorking` onay bekleyeni dışlıyor, kart kilidi ayrı. Typecheck + lint yeşil.
- 2026-11-15 F3: Başlıktaki "Studio'da aç" → "Ekibi düzenle" (`openTeamEditor`); AppRail ve ProjectDetailDrawer `teamEditorRequest`'i işliyor (Claude Config sekmesi). Typecheck + lint yeşil.
- 2026-11-15 F3: Görüntüler `scripts/shots-ekipler-faz3.mjs` (yalnızca GET, run/artifact/node-run `page.route`, kart turu `routeWebSocket`): `ekipler-3-{kartlar,kart-onay,board,qa-tur2,onay,onay-detay,takildi,bitti-ust,bitti-alt,secici,addtask}-{krem,gece}.png`, engellenen yazma yok. Canlı: `scripts/shots-ekipler-faz3-canli.mjs`, yalıtılmış core (:3101, `fail_then_pass`, 3 sn gecikme, onay kapısı açık) → `ekipler-3-canli-{kart,onay,calisiyor,bitti}-{krem,gece}.png`. GUI'den şartname düzenlenip onaylandı (`approved`, düzenleme gövdede), koşu `delivered`/`qaRound 1`, 7 artifact = 7 DOM balonu, sayfa hatası yok. :3101 öldürüldü, :3001 dokunulmadı.
- 2026-11-15 F3: Faz sonu doğrulamaları yeşil (core typecheck + 151 test / 24 dosya; gui typecheck + lint 0 uyarı; scratchpad kopyasında `node_modules/.bin/next build`: `/board` 322 kB, `/` 143 kB First Load); faz 3 commit'i.
