import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const tmp = process.env.TMPDIR ?? "/tmp";
  const stamp = `${process.pid}-${Date.now()}`;
  process.env.CLAUFLOW_DATA_DIR = `${tmp}/clauflow-attroles-${stamp}`;
  process.env.GH_CONFIG_DIR = `${tmp}/clauflow-attroles-gh-${stamp}`;
});

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runComment } from "./commentRunner.js";
import { startResolution } from "./conflictResolver.js";
import { READ_ADDED_LOG } from "./roleImages.js";
import { addAttachment, attachmentsDir, linkPendingToComment } from "../services/attachmentService.js";
import { createComment, getComment } from "../services/commentService.js";
import { createTask, getTask, updateTask } from "../services/taskService.js";
import { createTeam } from "../services/teamService.js";
import { BUILTIN_TEAM_IDS, defaultRole } from "../services/teamTemplates.js";
import { git, readCalls, writeRepoFile } from "../test-utils/fakeRepo.js";
import { pngBytes, webpBytes } from "../test-utils/images.js";
import { cleanupTeamCases, inspect, makeTeamCase, runTeamCase, type TeamCase } from "../test-utils/teamHarness.js";

/**
 * bakim #8 (plan §3/28–30, §5.6): every role call of a task with images gets
 * `--add-dir <attachments dir>` and the absolute paths in its prompt, and the
 * fake CLI process can read the files (`attachmentsSeen`). Without images
 * nothing changes. Access strategy: `--add-dir` (F5/2 real check passed).
 */

interface SeenCall {
  role: string | null;
  prompt: string;
  tools: string | null;
  addDirs: string[] | null;
  attachmentsSeen: Array<{ block: string; path: string; exists: boolean; bytes: number | null }>;
}
const calls = (c: TeamCase) => readCalls(c.state) as unknown as SeenCall[];

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  cleanupTeamCases();
  rmSync(process.env.CLAUFLOW_DATA_DIR!, { recursive: true, force: true });
  rmSync(process.env.GH_CONFIG_DIR!, { recursive: true, force: true });
});

function attachTwo(taskId: string) {
  const a = addAttachment(taskId, pngBytes(64, 32), { name: "buton.png" });
  const b = addAttachment(taskId, webpBytes(10, 10), { name: "kenar.webp" });
  return [a, b];
}

function expectSeesImages(call: SeenCall, taskId: string, paths: string[]) {
  expect(call.addDirs).toEqual([attachmentsDir(taskId)]);
  for (const p of paths) expect(call.prompt).toContain(`- ${p} (`);
  expect(call.prompt).toContain("open each one with the Read tool");
  const seen = call.attachmentsSeen.filter((s) => s.block === "attachments");
  expect(seen.map((s) => s.path)).toEqual(paths);
  expect(seen.every((s) => s.exists && (s.bytes ?? 0) > 0)).toBe(true);
}

describe("team roles get the task's images (bakim #8)", () => {
  it("Yazılım Ekibi: CEO, Analyst, Developer and QA calls all carry the paths and --add-dir; files readable; not in the repo", async () => {
    const c = await makeTeamCase({ scenario: "pass", teamId: BUILTIN_TEAM_IDS.yazilimEkibi, project: { defaultTeamId: null } });
    const imgs = attachTwo(c.task.id);
    const task = await runTeamCase(c, { uiLang: "tr" });
    expect(task.status).toBe("review");
    const r = inspect(c);
    expect(r.roles).toEqual(["ceo:1", "analyst:1", "developer:1", "qa:1"]);
    for (const call of calls(c)) {
      expectSeesImages(call, c.task.id, imgs.map((i) => i.path));
      // The flag sits right after --permission-mode; -p first; prompt on stdin.
      const argv = (call as unknown as { argv: string[] }).argv;
      expect(argv.slice(0, 5)).toEqual(["-p", "--permission-mode", "bypassPermissions", "--add-dir", attachmentsDir(c.task.id)]);
    }
    // Attachments live outside the repo: nothing about them on the branch or in the tree.
    expect(r.branchFiles(task.branch!)).toEqual(["fake-1.txt"]);
    expect(existsSync(join(c.repo, ".clauflow"))).toBe(false);
    expect(r.status).toBe("");
  });

  it("Solo developer gets them too", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const imgs = attachTwo(c.task.id);
    const task = await runTeamCase(c);
    expect(task.status).toBe("review");
    const [dev] = calls(c);
    expect(dev!.role).toBe("developer");
    expectSeesImages(dev!, c.task.id, imgs.map((i) => i.path));
    expect(dev!.prompt.indexOf("<attachments>")).toBeGreaterThan(dev!.prompt.indexOf("</task>"));
  });

  it("a task without images: no --add-dir, no <attachments>, tools unchanged", async () => {
    const c = await makeTeamCase({ scenario: "pass", teamId: BUILTIN_TEAM_IDS.yazilimEkibi, project: { defaultTeamId: null } });
    await runTeamCase(c);
    for (const call of calls(c)) {
      expect(call.addDirs).toBeNull();
      expect(call.prompt).not.toContain("<attachments>");
      expect(call.attachmentsSeen).toEqual([]);
      expect((call as unknown as { argv: string[] }).argv).not.toContain("--add-dir");
    }
  });

  it("a custom role without Read gets Read for the call (and a log line) only when there are images", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const dev = { ...defaultRole("developer"), tools: ["Write", "Edit", "Bash"] };
    const team = createTeam({ name: "No Read", projectId: c.project.id, roles: [dev, defaultRole("qa")] });
    c.task = await updateTask(c.task.id, { teamId: team.id });
    attachTwo(c.task.id);
    const task = await runTeamCase(c);
    const [d, q] = calls(c);
    expect(d!.tools).toBe("Write,Edit,Bash,Read");
    expect(q!.tools).toBe(defaultRole("qa").tools.join(","));
    expect(task.agent.log.filter((l) => l === READ_ADDED_LOG)).toHaveLength(1);

    const plain = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const team2 = createTeam({ name: "No Read 2", projectId: plain.project.id, roles: [dev, defaultRole("qa")] });
    plain.task = await updateTask(plain.task.id, { teamId: team2.id });
    const t2 = await runTeamCase(plain);
    expect(calls(plain)[0]!.tools).toBe("Write,Edit,Bash");
    expect(t2.agent.log).not.toContain(READ_ADDED_LOG);
  });
});

describe("comment runner: task images + the comment's own images (bakim #8)", () => {
  it("two blocks: <attachments> (task) and <feedback_attachments> (this comment); --add-dir once", async () => {
    const c = await makeTeamCase({ scenario: "pass", project: { defaultTeamId: null } });
    const branch = "feature/clf-1-review";
    git(c.repo, "checkout", "-q", "-b", branch);
    writeFileSync(join(c.repo, "work.txt"), "work\n");
    git(c.repo, "add", "-A");
    git(c.repo, "commit", "-q", "-m", "feat: work");
    git(c.repo, "checkout", "-q", "main");
    await updateTask(c.task.id, { status: "review", branch });
    const own = addAttachment(c.task.id, pngBytes(8, 8), { name: "gorev.png" });
    const draft = addAttachment(c.task.id, pngBytes(4, 4), { name: "yorum.png", pending: true });
    const comment = createComment(c.task.id, "Kenarı bu görseldeki gibi kesik yap.");
    linkPendingToComment(c.task.id, [draft.id], comment.id);

    await runComment(comment, c.project, { uiLang: "tr" });
    expect(getComment(comment.id)!.status).toBe("done");
    const call = calls(c).find((x) => x.role === "comment")!;
    expect(call.addDirs).toEqual([attachmentsDir(c.task.id)]);
    expect(call.prompt).toContain(`<attachments>\n- ${own.path} (`);
    expect(call.prompt).toContain(`<feedback_attachments>\n- ${draft.path} (`);
    expect(call.prompt.split(draft.path)).toHaveLength(2); // this comment's image only in its own block
    expect(call.attachmentsSeen).toEqual([
      { block: "attachments", path: own.path, exists: true, bytes: own.bytes },
      { block: "feedback_attachments", path: draft.path, exists: true, bytes: draft.bytes },
    ]);
  });
});

describe("conflict resolver and its QA round get the task's images (bakim #8)", () => {
  it("conflict_resolver + qa calls carry the paths and --add-dir", async () => {
    const c = await makeTeamCase({
      scenario: "pass",
      teamId: BUILTIN_TEAM_IDS.yazilimEkibi,
      project: { defaultTeamId: null },
      title: "Say hello from B",
      setupRepo: (repo) => {
        writeRepoFile(repo, "shared.txt", "base line\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-q", "-m", "seed shared.txt");
      },
    });
    const repo = c.repo;
    const base0 = git(repo, "rev-parse", "HEAD");
    const merged = await createTask({ projectId: c.project.id, title: "Say hello from A", description: "A." });
    const branchA = `feature/${merged.displayId!.toLowerCase()}-hello-a`;
    git(repo, "checkout", "-q", "-b", branchA);
    writeRepoFile(repo, "shared.txt", "line from A\n");
    git(repo, "commit", "-q", "-am", "feat: A");
    git(repo, "checkout", "-q", "main");
    git(repo, "merge", "-q", "--no-ff", "-m", `Merge ${branchA} (${merged.displayId})`, branchA);
    git(repo, "branch", "-q", "-D", branchA);
    const branch = `feature/${c.task.displayId!.toLowerCase()}-hello-b`;
    git(repo, "checkout", "-q", "-b", branch, base0);
    writeRepoFile(repo, "shared.txt", "line from B\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "feat: B");
    git(repo, "checkout", "-q", "main");
    await updateTask(c.task.id, { status: "review", branch, agent: { status: "done", currentStep: undefined, error: null } });
    const imgs = attachTwo(c.task.id);

    await startResolution(c.task.id, { mode: "conflict", trigger: "manual", uiLang: "tr" });
    const t = (await getTask(c.task.id))!;
    expect(t.agent).toMatchObject({ status: "done", currentStep: "conflict_resolved" });
    const resolver = calls(c).find((x) => x.role === "conflict_resolver")!;
    const qa = calls(c).find((x) => x.role === "qa")!;
    expectSeesImages(resolver, c.task.id, imgs.map((i) => i.path));
    expectSeesImages(qa, c.task.id, imgs.map((i) => i.path));
    expect(git(repo, "diff", "--name-only", `main...${branch}`)).toBe("shared.txt");
  });
});
