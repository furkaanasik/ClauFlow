import { defaultRole } from "../../services/teamTemplates.js";

/**
 * bakim #8 (§3/31): fixed prompt contexts. `prompts-before-attachments.json`
 * holds every builder's output for these cases, rendered BEFORE the attachment
 * sections existed; with no attachments the builders must still match it byte
 * for byte.
 */
const bg = { aiPrompt: "A small TODO app.\nKeep it simple." };
const noBg = { aiPrompt: "" };
const task = { title: "Butonu düzelt", description: "Kaydet düğmesi hardal olsun.\n\n- kenar 2px", analysis: "" };
const analysed = { title: "Butonu düzelt", description: "Kaydet düğmesi.", analysis: "AC-1: düğme hardal." };

export const ROLE_CASES = {
  soloNoBg: () => ({ role: defaultRole("developer"), ctx: { task, project: noBg, round: 1, solo: true } }),
  soloBg: () => ({ role: defaultRole("developer"), ctx: { task: analysed, project: bg, round: 1, solo: true } }),
  ceo: () => ({ role: defaultRole("ceo"), ctx: { task, project: bg, round: 0, solo: false } }),
  analyst: () => ({ role: defaultRole("analyst"), ctx: { task, project: noBg, round: 0, solo: false, brief: "## Brief\nGoal." } }),
  dev1: () => ({ role: defaultRole("developer"), ctx: { task, project: bg, round: 1, solo: false, brief: "B", spec: "S" } }),
  dev2: () => ({
    role: defaultRole("developer"),
    ctx: { task, project: bg, round: 2, solo: false, brief: "B", spec: "S", bugList: "1. bug", delivery: "D" },
  }),
  qaDiff: () => ({
    role: defaultRole("qa"),
    ctx: { task, project: bg, round: 1, solo: false, spec: "S", delivery: "D", diff: "diff --git a/x b/x\n+1", baseBranch: "main" },
  }),
  qaEmpty: () => ({ role: defaultRole("qa"), ctx: { task, project: noBg, round: 2, solo: false, spec: "S", delivery: "D", diff: "" } }),
} as const;

export const COMMENT_CASES = {
  full: () => ({
    role: defaultRole("developer"),
    ctx: { task, project: bg, spec: "S", qaReport: { verdict: "pass" as const, body: "ok" }, comment: "Kenarı kesik yap.", uiLang: "tr" as const },
  }),
  bare: () => ({ role: defaultRole("developer"), ctx: { task, project: noBg, comment: "Just do it." } }),
} as const;

export const CONFLICT_CASES = {
  full: () => ({
    task,
    project: bg,
    spec: "S",
    target: "main",
    branch: "feature/clf-1-x",
    mergedTasks: [{ displayId: "CLF-2", title: "Other", description: "desc" }],
    conflicts: [{ path: "a.txt", text: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n" }],
    uiLang: "tr" as const,
  }),
} as const;
