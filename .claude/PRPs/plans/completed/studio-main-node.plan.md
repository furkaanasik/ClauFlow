# Plan: Studio Main Node

## Summary
Studio canvas'ta her zaman bir `main` agent node bulunur. Studio açıldığında `main.md` yoksa otomatik oluşturulur, canvas'ta sol üste sabitlenir, özel görsel kimliğe sahiptir ve silinemez. Silinirse bir sonraki yüklemede yeniden oluşur.

## User Story
As a developer using Studio, I want a permanent `main` entry-point node so that I always have a clear starting point for my agent graph.

## Problem → Solution
Studio açılışında `main` agent yoksa boş canvas → Backend `GET /agents` çağrısında `main.md` yoksa otomatik oluşturur; canvas `main` node'u daima `{ x: 20, y: 20 }` konumuna sabitler, silinemez hale getirir ve diğer node'lardan ayırt eden özel border/badge ile gösterir.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (ROADMAP.md feature)
- **PRD Phase**: N/A
- **Estimated Files**: 4

---

## UX Design

### Before
```
┌─────────────────────────────────────────────┐
│  Studio Canvas (empty or random nodes)      │
│                                             │
│   [planner]  [coder]  [reviewer]           │
│   (any order, no fixed entry point)         │
└─────────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────────┐
│  Studio Canvas                              │
│  ┌──────────────────────┐                  │
│  │ ★ ENTRY  main        │ ← top-left fixed │
│  │ (gold border, badge) │                  │
│  └──────────────────────┘                  │
│                                             │
│   [planner]  [coder]  [reviewer]           │
└─────────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Studio açılış | `main.md` yoksa canvas boş | `main.md` auto-created, node görünür | Backend'de `GET /agents` sırasında |
| Delete tuşu / Backspace | Tüm node'lar silinebilir | `main` node'u silinemez | `handleNodesChange` filtresi |
| AgentEditDrawer | Her agent için Delete butonu | `main` için Delete butonu gizli | `slug === "main"` kontrolü |
| Node görünümü | Tüm node'lar aynı kind-based border | `main` özel gold border + "entry" badge | `NODE_ACCENT` genişletme |
| Canvas pozisyon | Saved graph ya da default grid | `main` her zaman `{ x: 20, y: 20 }` | `buildNodes` içinde override |
| Drag | Tüm node'lar sürüklenebilir | `main` sürüklenemiyor | `draggable: false` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/routes/projectsClaude.ts` | 317-361 | `GET /agents` — buraya auto-create eklenecek |
| P0 | `gui/src/components/Studio/StudioCanvas.tsx` | 40-56 | `buildNodes` — position + draggable override |
| P0 | `gui/src/components/Studio/StudioCanvas.tsx` | 266-272 | `handleNodesChange` — delete guard |
| P0 | `gui/src/components/Studio/AgentNode.tsx` | 35-99 | `NODE_ACCENT`, `KNOWN_KINDS`, `deriveNodeKind` |
| P1 | `gui/src/components/Studio/AgentEditDrawer.tsx` | 1-60 | Delete button location |
| P1 | `core/src/services/graphService.ts` | tüm dosya | `serializeAgentFile`, `agentFilePath` pattern |

## External Documentation
N/A — established internal patterns only.

---

## Patterns to Mirror

### AGENT_FILE_CREATION
```typescript
// SOURCE: core/src/routes/projectsClaude.ts:480-517
const fm: AgentFrontmatter = {
  name: parsed.data.name ?? parsed.data.slug,
  model: parsed.data.model,
  description: parsed.data.description,
  allowedTools: parsed.data.allowedTools,
};
const content = serializeAgentFile(fm, parsed.data.body ?? "");
fs.writeFileSync(file, content, "utf8");
// then commitAgentChange(...)
```

### NODE_ACCENT_PATTERN
```typescript
// SOURCE: gui/src/components/Studio/AgentNode.tsx:44-88
const NODE_ACCENT: Record<NodeKind, NodeAccent> = {
  planner: {
    border: "border-l-4 border-l-indigo-500",
    header: "bg-indigo-500/10",
    badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/40",
    label: "planner",
  },
  // ...
};
```

### DERIVE_NODE_KIND_PATTERN
```typescript
// SOURCE: gui/src/components/Studio/AgentNode.tsx:91-99
function deriveNodeKind(slug: string): NodeKind {
  const lower = slug.toLowerCase();
  for (const k of KNOWN_KINDS) {
    if (lower === k || lower.startsWith(`${k}-`) || lower.endsWith(`-${k}`)) {
      return k;
    }
  }
  return "custom";
}
```

### BUILD_NODES_PATTERN
```typescript
// SOURCE: gui/src/components/Studio/StudioCanvas.tsx:40-56
function buildNodes(agents, graphNodes, onEdit, onRemoveSkill, onAddSkill): Node[] {
  return agents.map((agent, i) => {
    const saved = graphNodes.find((n) => n.data.slug === agent.slug);
    return {
      id: agent.slug,
      type: "agent",
      position: saved?.position ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 160 },
      data: { agent, onEdit, onRemoveSkill, onAddSkill } as unknown as Record<string, unknown>,
    };
  });
}
```

### NODES_CHANGE_GUARD_PATTERN
```typescript
// SOURCE: gui/src/components/Studio/StudioCanvas.tsx:266-273
const handleNodesChange = useCallback(
  (changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
    const hasMoved = changes.some((c) => c.type === "position" && !c.dragging);
    if (hasMoved) setIsDirty(true);
  },
  [onNodesChange],
);
```

### COMMIT_AGENT_CHANGE_PATTERN
```typescript
// SOURCE: core/src/routes/projectsClaude.ts:280-315
async function commitAgentChange(repoPath, relPath, message) {
  // git add → git diff --cached → git commit
  // returns { committed, commitSha, commitWarning }
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `core/src/routes/projectsClaude.ts` | UPDATE | `GET /agents`'e `main.md` auto-create ekle |
| `gui/src/components/Studio/AgentNode.tsx` | UPDATE | `main` kind ekle: `NodeKind`, `NODE_ACCENT`, `KNOWN_KINDS`, `deriveNodeKind` |
| `gui/src/components/Studio/StudioCanvas.tsx` | UPDATE | `buildNodes` pozisyon+draggable override; `handleNodesChange` delete guard |
| `gui/src/components/Studio/AgentEditDrawer.tsx` | UPDATE | `main` slug için Delete butonu gizle |

## NOT Building
- `main` → diğer node'lara otomatik edge oluşturma (kullanıcı bağlantıları manuel çizer)
- `main` node'unu yeniden adlandırma/slug değiştirme koruması (sadece silme koruması yeterli)
- Mevcut Studio bug'larının analizi (implementation sırasında karşılaşılanlara bakılacak)
- Animasyon veya tutorial overlay

---

## Step-by-Step Tasks

### Task 1: Backend — `main.md` auto-create on `GET /agents`

- **ACTION**: `GET /:id/claude/agents` handler'ına `main.md` yoksa oluşturma mantığı ekle
- **IMPLEMENT**:
  ```typescript
  // core/src/routes/projectsClaude.ts — router.get("/:id/claude/agents") içinde
  // `const files = fs.readdirSync(dir).filter(...)` satırından SONRA, agentler map'lenmeden ÖNCE:
  const mainFile = agentFilePath(project.repoPath, "main");
  if (!files.includes("main.md") && !fs.existsSync(mainFile)) {
    const mainFm: AgentFrontmatter = {
      name: "Main",
      description: "Entry point for this project's agent graph",
    };
    const mainBody = "\nYou are the main orchestrator for this project. Coordinate with other agents as needed.";
    fs.writeFileSync(mainFile, serializeAgentFile(mainFm, mainBody), "utf8");
    await commitAgentChange(
      project.repoPath,
      path.relative(project.repoPath, mainFile),
      "chore(agents): bootstrap main entry-point agent",
    );
    files.unshift("main.md"); // main'i listenin başına ekle
  }
  ```
- **MIRROR**: AGENT_FILE_CREATION + COMMIT_AGENT_CHANGE_PATTERN
- **IMPORTS**: Mevcut importlar yeterli (`fs`, `path`, `serializeAgentFile`, `commitAgentChange`, `agentFilePath`, `AgentFrontmatter` hepsi zaten import edilmiş)
- **GOTCHA**: `files` array `const` — yeniden atama yerine `unshift` ile mutate et. `dir` var olmayabilir → `if (!fs.existsSync(dir))` erken return'ü aşmak için main'i create etmeden önce `fs.mkdirSync(dir, { recursive: true })` çağır.
- **VALIDATE**: `GET /api/projects/:id/claude/agents` çağır → agents'ta `{ slug: "main", name: "Main" }` görünmeli. Tekrar çağırınca duplicate oluşmamalı.

### Task 2: Frontend — `main` NodeKind + Visual Accent

- **ACTION**: `AgentNode.tsx`'e `main` kind ekle
- **IMPLEMENT**:
  ```typescript
  // NodeKind type'ına "main" ekle:
  type NodeKind = "main" | "planner" | "coder" | "reviewer" | "tester" | "ci" | "fix" | "custom";

  // NODE_ACCENT'a ekle:
  main: {
    border: "border-2 border-amber-400",
    header: "bg-amber-400/10",
    badge: "bg-amber-400/15 text-amber-300 border-amber-400/40",
    label: "entry",
  },

  // KNOWN_KINDS'a ekleme — EKLEME, deriveNodeKind'ı değiştir:
  function deriveNodeKind(slug: string): NodeKind {
    if (slug === "main") return "main";  // tam eşleşme, döngüden önce
    const lower = slug.toLowerCase();
    for (const k of KNOWN_KINDS) { ... }
    return "custom";
  }
  ```
- **MIRROR**: NODE_ACCENT_PATTERN + DERIVE_NODE_KIND_PATTERN
- **IMPORTS**: Değişiklik yok
- **GOTCHA**: `KNOWN_KINDS` array'ine `"main"` eklersen `main-something` gibi slug'lar da `main` kind'ına girer — bu yüzden deriveNodeKind'da döngüden önce exact match yap, `KNOWN_KINDS`'a ekleme.
- **VALIDATE**: Canvas'ta `main` node gold/amber border + "entry" badge göstermeli.

### Task 3: Frontend — `main` node pozisyon kilidi + drag disable

- **ACTION**: `StudioCanvas.tsx` `buildNodes` içinde `main` node'u her zaman `{ x: 20, y: 20 }` konumuna sabitle ve sürüklenemez yap
- **IMPLEMENT**:
  ```typescript
  // buildNodes içinde agents.map callback'i:
  return agents.map((agent, i) => {
    const isMain = agent.slug === "main";
    const saved = graphNodes.find((n) => n.data.slug === agent.slug);
    const position = isMain
      ? { x: 20, y: 20 }
      : saved?.position ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 160 };
    return {
      id: agent.slug,
      type: "agent",
      position,
      draggable: !isMain,
      data: { agent, onEdit, onRemoveSkill, onAddSkill, isMain } as unknown as Record<string, unknown>,
    };
  });
  ```
- **MIRROR**: BUILD_NODES_PATTERN
- **IMPORTS**: Değişiklik yok
- **GOTCHA**: `draggable: false` ReactFlow node property'si — `data` içine DEĞİL, node objesinin root'una koy.
- **VALIDATE**: `main` node sürüklenemiyor olmalı. Diğer node'lar sürüklenebilmeli.

### Task 4: Frontend — `main` node silme koruması

- **ACTION**: `StudioCanvas.tsx` `handleNodesChange`'e `main` için `remove` filtresi ekle
- **IMPLEMENT**:
  ```typescript
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const filtered = changes.filter(
        (c) => !(c.type === "remove" && c.id === "main"),
      );
      onNodesChange(filtered);
      const hasMoved = filtered.some((c) => c.type === "position" && !c.dragging);
      if (hasMoved) setIsDirty(true);
    },
    [onNodesChange],
  );
  ```
- **MIRROR**: NODES_CHANGE_GUARD_PATTERN
- **IMPORTS**: Değişiklik yok
- **GOTCHA**: `changes` array'ini filter etmeden `onNodesChange`'e geçme — filter'ı ilk adım yap.
- **VALIDATE**: `main` node seçiliyken Delete/Backspace'e bas → node silinmemeli. Diğer node'lar silinebilmeli.

### Task 5: Frontend — AgentEditDrawer'da `main` için Delete gizle

- **ACTION**: `AgentEditDrawer.tsx`'te `slug === "main"` ise Delete butonunu gizle
- **IMPLEMENT**:
  ```typescript
  // isEdit && slug !== "main" kontrolü ile Delete butonu render'ı sar:
  // Mevcut Delete butonu nerede render ediliyor → onu `slug !== "main" && (...)` içine al
  ```
  Dosyada Delete butonunu bul (muhtemelen "delete" veya t.delete string'i ile): `{isEdit && slug !== "main" && (<button ... Delete/Sil ...>)}`
- **MIRROR**: Mevcut drawer pattern
- **IMPORTS**: Değişiklik yok
- **GOTCHA**: `slug` prop — drawer açıkken `null` değil, gerçek slug. `isEdit && slug !== "main"` kombinasyonu yeterli.
- **VALIDATE**: `main` agent'ı düzenle → drawer açılır ama Delete butonu görünmez. Başka agent'larda Delete butonu görünmeye devam etmeli.

---

## Testing Strategy

### Unit Tests
N/A — mevcut projede test yok (CLAUDE.md: "Do not add tests if there are none")

### Edge Cases Checklist
- [ ] `main.md` zaten varken `GET /agents` çağrılsa duplicate oluşmaz
- [ ] `main.md` disk'ten elle silinirse bir sonraki `GET /agents` yeniden oluşturur
- [ ] `main` node Delete/Backspace ile seçili silmeye çalışılsa hayatta kalır
- [ ] `main` node drag denemeleri — sabit kalır
- [ ] `main` node için AgentEditDrawer açılır (sadece Delete gizli), düzenleme çalışır
- [ ] Diğer node'lar normal şekilde silinebilir, düzenlenebilir

---

## Validation Commands

### Static Analysis
```bash
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

```bash
cd core && npm run typecheck
```
EXPECT: Zero type errors

### Lint
```bash
cd gui && pnpm lint
```
EXPECT: No errors

### Build
```bash
cd core && npm run build
cd gui && pnpm build
```
EXPECT: Both build without errors

### Browser Validation
```bash
cd core && npm run dev   # port 3001
cd gui && pnpm dev       # port 3000
```
Manual steps:
1. Yeni proje oluştur veya `main.md`'si olmayan projeyi aç
2. Studio'ya git → `main` node sol üstte, gold border, "entry" badge ile görünmeli
3. `main` node'unu sürüklemeye çalış → hareket etmemeli
4. `main` node'u seç → Delete tuşuna bas → silinmemeli
5. `main` node'una çift tıkla → AgentEditDrawer açılmalı, Delete butonu YOK
6. Başka node seç → Delete tuşuna bas → silinmeli
7. `main.md`'yi disk'ten sil, sayfayı yenile → `main` yeniden oluşmuş olmalı

### Manual Validation
- [ ] `main` node canvas'ta sol üstte görünür
- [ ] `main` node altın/amber border + "entry" badge
- [ ] `main` node sürüklenemez
- [ ] `main` node Delete/Backspace ile silinemez
- [ ] `main` için drawer'da Delete butonu yok
- [ ] `main.md` disk'ten silinip yeniden yüklenince geri gelir
- [ ] Mevcut agent'lar (planner, coder vb.) etkilenmemiş

---

## Acceptance Criteria
- [ ] Studio açılışında `main.md` yoksa otomatik oluşur ve git'e commit edilir
- [ ] `main` node canvas'ta her zaman `{ x: 20, y: 20 }` konumunda
- [ ] `main` node sürüklenemez (`draggable: false`)
- [ ] `main` node Delete/Backspace ile silinemez
- [ ] `main` node özel amber/gold border ve "entry" badge gösterir
- [ ] AgentEditDrawer `main` için Delete butonu göstermez
- [ ] `pnpm typecheck` ve `npm run typecheck` pass
- [ ] `pnpm build` ve `npm run build` pass

## Completion Checklist
- [ ] Backend: `files.includes("main.md")` kontrolü + `unshift` pattern
- [ ] Backend: `mkdirSync` guard (dir olmayabilir)
- [ ] Frontend AgentNode: exact match `slug === "main"` → `"main"` kind döner
- [ ] Frontend AgentNode: `KNOWN_KINDS` array'ine `"main"` eklenmedi
- [ ] Frontend StudioCanvas: `buildNodes` root'ta `draggable: !isMain`
- [ ] Frontend StudioCanvas: `handleNodesChange` filter önce yapılıyor
- [ ] Frontend AgentEditDrawer: `isEdit && slug !== "main"` guard
- [ ] No hardcoded magic strings beyond "main" (slug convention)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `dir` yokken `main.md` create | Medium | Error | `mkdirSync(dir, { recursive: true })` önce çağır |
| `files` const array mutate | Low | Bug | `unshift` kullan (mutate), ya da `const files = [...]` → `let` yap |
| `draggable: false` property yeri yanlış | Low | Bug | Node objesinin root'unda olmalı, `data` içinde değil |
| `handleNodesChange` filter sonra değil önce | Low | Bug | filter → onNodesChange sırası korunmalı |

## Notes
- Mevcut Studio bug'ları spec'te belirtilmemiş — implementation sırasında karşılaşılan bug'lar düzeltilebilir
- `main` node'un graph'ta özel bir "zorla bağlı" davranışı YOK — kullanıcı edge'leri manuel çizer
- `window.confirm` yerine mevcut pattern'de zaten confirm yoktu — silme koruması event filter ile sağlandı
- Backend'deki `files` array `const` → `unshift` mutation güvenli (array referansı değişmiyor, içeriği değişiyor). Alternatif: `const files = [...baseFiles]` let pattern.
```
