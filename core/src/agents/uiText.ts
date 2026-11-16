import { z } from "zod";

/**
 * §3/10: the GUI's language for texts core writes into the task (team summary,
 * stop reasons, PR body, auto comments). Carried as a run option only, never
 * stored; English when the request did not send one.
 */
export type UiLang = "tr" | "en";
export const uiLangSchema = z.enum(["tr", "en"]);

/** USD amount in user-facing text: "$0.38" (`precision` decimals). */
export function formatUsd(n: number, precision = 2): string {
  return "$" + n.toFixed(precision);
}

/** Role time limit in stop texts: "20 dk" / "20 min", under a minute in seconds. */
function formatDuration(ms: number, lang: UiLang): string {
  if (ms < 60_000) {
    const s = Math.max(1, Math.round(ms / 1000));
    return lang === "tr" ? `${s} sn` : `${s} s`;
  }
  const m = Math.round(ms / 60_000);
  return lang === "tr" ? `${m} dk` : `${m} min`;
}

/** Why a conflict resolver run failed (`conflict_unresolved:<reason>`, zincir F4.6 §3/33). */
export type ConflictReason =
  | "markers_left"
  | "qa_fail"
  | "role_timeout"
  | "budget"
  | "aborted"
  | "server_restart"
  | "unsupported"
  | "claude_exit"
  | "push_failed"
  | "git";

/** Texts of the conflict resolver's summary comment (zincir F4.6, §5.10). */
export interface ResolverText {
  title: string;
  result: string;
  resolved: string;
  unresolved: (reason: string) => string;
  clean: string;
  qa: string;
  qaSkipped: string;
  cost: string;
  target: string;
  files: string;
  mergedTasks: string;
  newCommit: (sha: string) => string;
  upToDate: string;
  restored: (sha: string) => string;
  cleanNote: (mode: "conflict" | "update") => string;
  note: string;
  qaReport: string;
  reason: Record<ConflictReason, string>;
}

export interface UiText {
  summaryTitle: string;
  team: string;
  outcome: string;
  qaRounds: string;
  cost: string;
  outcomeLabel: Record<"delivered" | "explored" | "stuck", string>;
  lastOutput: string;
  stuckTitle: string;
  lastBugList: string;
  emptyOutput: string;
  stopStalled: string;
  stopRoundLimit: (max: number) => string;
  stopBudget: (spent: number, budget: number) => string;
  stopTimeout: (role: string, ms: number) => string;
  roleDidNotRun: string;
  roleBrief: string;
  roleSpec: (acs: number) => string;
  roleDelivery: (count: number, round: number, commit: string | null) => string;
  roleQa: (verdict: string, round: number) => string;
  prTeamTitle: string;
  prAcceptance: string;
  prQaResult: string;
  prQaRound: (round: number) => string;
  prDescription: string;
  prAnalysis: string;
  prHowToTest: string;
  prAcceptanceIntro: string;
  prQuickCheck: string;
  prRunTests: string;
  prRunTestsShort: string;
  prTryUi: string;
  prTryManual: string;
  prAgentLog: string;
  noChanges: string;
  /** bakim #1: the base branch vanished mid-run; the work is kept on `branch`. */
  baseBranchLost: (base: string, branch: string) => string;
  brokenDown: (count: number) => string;
  resolver: ResolverText;
}

const TR: UiText = {
  summaryTitle: "## Ekip özeti",
  team: "Ekip",
  outcome: "Sonuç",
  qaRounds: "QA turu",
  cost: "Maliyet",
  outcomeLabel: { delivered: "Teslim edildi", explored: "Keşif tamamlandı", stuck: "Takıldı" },
  lastOutput: "### Son çıktı",
  stuckTitle: "## Takıldı",
  lastBugList: "### Son hata listesi",
  emptyOutput: "(boş çıktı)",
  stopStalled: "QA arka arkaya iki kez esasen aynı hata listesini döndü",
  stopRoundLimit: (max) => `QA tur sınırına ulaşıldı (${max})`,
  stopBudget: (spent, budget) => `Bütçe aşıldı (${formatUsd(spent)} / ${formatUsd(budget)})`,
  stopTimeout: (role, ms) => `${role} rolü zaman aşımına uğradı (${formatDuration(ms, "tr")})`,
  roleDidNotRun: "çalışmadı",
  roleBrief: "brief yazdı",
  roleSpec: (acs) => `şartname yazdı${acs ? ` (${acs} kabul kriteri)` : ""}`,
  roleDelivery: (count, round, commit) =>
    `${count} teslim (son tur ${round}${commit ? `, commit ${commit}` : ""})`,
  roleQa: (verdict, round) => `${verdict} (tur ${round})`,
  prTeamTitle: "## Ekip",
  prAcceptance: "### Kabul kriterleri",
  prQaResult: "### QA sonucu",
  prQaRound: (round) => `QA turu ${round}`,
  prDescription: "## Açıklama",
  prAnalysis: "## Analiz",
  prHowToTest: "## Nasıl Test Edilir",
  prAcceptanceIntro: "Acceptance kriterleri (her biri test edilebilir):",
  prQuickCheck: "Hızlı doğrulama:",
  prRunTests:
    "- Repo'nun test komutunu çalıştır (`npm test` / `pytest` / `go test ./...` — package.json/pyproject/go.mod'a göre).",
  prRunTestsShort: "- Repo'nun test komutunu çalıştır (`npm test` / `pytest` / `go test ./...`).",
  prTryUi: "- Branch'i lokal'e çekip dev sunucusunu açarak davranışı UI/CLI üzerinden kontrol et.",
  prTryManual: "- Branch'i lokal'e çekip ilgili akışı manuel deneyle.",
  prAgentLog: "## Agent Logu (son 30 satır)",
  noChanges:
    "Değişiklik gerekmedi: ekip çalıştı ama repoda değiştirilecek bir şey bulmadı. Görev kapatıldı, dal silindi.",
  baseBranchLost: (base, branch) =>
    `Ana dal \`${base}\` koşu sırasında silindi ya da yeniden adlandırıldı. İş \`${branch}\` dalında commit'li duruyor; proje ayarlarında ana dalı düzeltip görevi yeniden başlat.`,
  brokenDown: (count) => `${count} alt göreve bölündü.`,
  resolver: {
    title: "## Çakışma çözücü",
    result: "Sonuç",
    resolved: "Çözüldü",
    unresolved: (reason) => `Çözülemedi (${reason})`,
    clean: "Temiz birleşti",
    qa: "QA",
    qaSkipped: "atlandı",
    cost: "Maliyet",
    target: "Hedef",
    files: "Çakışan dosyalar",
    mergedTasks: "Ana dala girenler",
    newCommit: (sha) => `Yeni birleştirme commit'i: ${sha}`,
    upToDate: "Dal ana dalın güncel hâlini zaten içeriyordu; yeni commit yok.",
    restored: (sha) => `Dal koşudan önceki hâline döndü (${sha})`,
    cleanNote: (mode) =>
      mode === "update"
        ? "Ana dal temiz birleşti; çakışma yoktu, QA atlandı."
        : "Çakışma artık yok: ana dal temiz birleşti, QA atlandı.",
    note: "### Çözücünün notu",
    qaReport: "### QA raporu",
    reason: {
      markers_left: "çakışma işaretçisi kaldı",
      qa_fail: "QA FAIL verdi",
      role_timeout: "rol zaman aşımına uğradı",
      budget: "bütçe aşıldı",
      aborted: "durduruldu",
      server_restart: "sunucu yeniden başladı",
      unsupported: "desteklenmeyen çakışma (ikili dosya ya da sil/değiştir)",
      claude_exit: "claude hatayla çıktı",
      push_failed: "push başarısız",
      git: "git hatası",
    },
  },
};

const EN: UiText = {
  summaryTitle: "## Team summary",
  team: "Team",
  outcome: "Outcome",
  qaRounds: "QA rounds",
  cost: "Cost",
  outcomeLabel: { delivered: "Delivered", explored: "Exploration complete", stuck: "Stuck" },
  lastOutput: "### Last output",
  stuckTitle: "## Stuck",
  lastBugList: "### Last bug list",
  emptyOutput: "(empty output)",
  stopStalled: "QA returned essentially the same bug list twice in a row",
  stopRoundLimit: (max) => `QA round limit reached (${max})`,
  stopBudget: (spent, budget) => `Budget exceeded (${formatUsd(spent)} / ${formatUsd(budget)})`,
  stopTimeout: (role, ms) => `The ${role} role timed out (${formatDuration(ms, "en")})`,
  roleDidNotRun: "did not run",
  roleBrief: "wrote the brief",
  roleSpec: (acs) => `wrote the spec${acs ? ` (${acs} acceptance criteria)` : ""}`,
  roleDelivery: (count, round, commit) =>
    `${count} deliver${count === 1 ? "y" : "ies"} (last round ${round}${commit ? `, commit ${commit}` : ""})`,
  roleQa: (verdict, round) => `${verdict} (round ${round})`,
  prTeamTitle: "## Team",
  prAcceptance: "### Acceptance criteria",
  prQaResult: "### QA result",
  prQaRound: (round) => `QA round ${round}`,
  prDescription: "## Description",
  prAnalysis: "## Analysis",
  prHowToTest: "## How to test",
  prAcceptanceIntro: "Acceptance criteria (each one testable):",
  prQuickCheck: "Quick check:",
  prRunTests:
    "- Run the repo's test command (`npm test` / `pytest` / `go test ./...`, per package.json/pyproject/go.mod).",
  prRunTestsShort: "- Run the repo's test command (`npm test` / `pytest` / `go test ./...`).",
  prTryUi: "- Check out the branch locally, start the dev server and verify the behaviour in the UI/CLI.",
  prTryManual: "- Check out the branch locally and try the affected flow by hand.",
  prAgentLog: "## Agent log (last 30 lines)",
  noChanges:
    "No changes needed: the team ran but found nothing to change in the repo. Task closed, branch deleted.",
  baseBranchLost: (base, branch) =>
    `The base branch \`${base}\` was deleted or renamed during the run. The work is committed on \`${branch}\`; fix the base branch in the project settings and start the task again.`,
  brokenDown: (count) => `Split into ${count} subtask${count === 1 ? "" : "s"}.`,
  resolver: {
    title: "## Conflict resolver",
    result: "Result",
    resolved: "Resolved",
    unresolved: (reason) => `Not resolved (${reason})`,
    clean: "Merged cleanly",
    qa: "QA",
    qaSkipped: "skipped",
    cost: "Cost",
    target: "Target",
    files: "Conflicted files",
    mergedTasks: "Merged into base",
    newCommit: (sha) => `New merge commit: ${sha}`,
    upToDate: "The branch already contained the latest base; no new commit.",
    restored: (sha) => `The branch is back where it was before the run (${sha})`,
    cleanNote: (mode) =>
      mode === "update"
        ? "The base merged cleanly; there was no conflict, QA skipped."
        : "The conflict is gone: the base merged cleanly, QA skipped.",
    note: "### Resolver's note",
    qaReport: "### QA report",
    reason: {
      markers_left: "conflict markers left",
      qa_fail: "QA returned FAIL",
      role_timeout: "the role timed out",
      budget: "budget exceeded",
      aborted: "stopped",
      server_restart: "the server restarted",
      unsupported: "unsupported conflict (binary file or delete/modify)",
      claude_exit: "claude exited with an error",
      push_failed: "push failed",
      git: "git error",
    },
  },
};

export function uiText(lang: UiLang | undefined): UiText {
  return lang === "tr" ? TR : EN;
}
