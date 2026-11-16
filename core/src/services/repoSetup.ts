import fs from "node:fs";
import path from "node:path";
import { commitAll, initRepo, writeDefaultIgnores } from "./gitService.js";

/**
 * Project repo setup with default ignores (bakim #7, plan §3/9):
 *  - a folder without `.git` (new or user-picked, possibly full): `git init`
 *    → `.gitignore` if missing (`DEFAULT_GITIGNORE`) → README if missing →
 *    first commit, which then takes the `.gitignore` and leaves
 *    `node_modules/`, `.env` … out;
 *  - an existing repo without `.gitignore`: no file, no commit; the same
 *    patterns go to the local `.git/info/exclude` block;
 *  - an existing repo with `.gitignore`: untouched.
 */

/** Local project path: an existing repo is left as is (apart from the exclude block). */
export async function ensureLocalRepo(repoPath: string, branch: string, name: string): Promise<void> {
  fs.mkdirSync(repoPath, { recursive: true });
  if (fs.existsSync(path.join(repoPath, ".git"))) {
    await writeDefaultIgnores(repoPath, { isNewRepo: false });
    return;
  }

  const init = await initRepo(repoPath, branch);
  if (init.code !== 0) {
    throw new Error(`git init failed: ${init.stderr || init.stdout}`);
  }
  await writeDefaultIgnores(repoPath, { isNewRepo: true });

  const readmePath = path.join(repoPath, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# ${name}\n`);
  }

  const commit = await commitAll(repoPath, "chore: initial commit");
  if (commit.code !== 0) {
    throw new Error(`initial commit failed: ${commit.stderr || commit.stdout}`);
  }
}

/**
 * The `createGithubRepo` path before `gh repo create --source=. --push`: same
 * ignore policy; it always tries a commit (the push needs one) and tolerates
 * "nothing to commit", as before.
 */
export async function prepareRepoForGithub(repoPath: string, name: string): Promise<void> {
  if (!fs.existsSync(repoPath)) fs.mkdirSync(repoPath, { recursive: true });

  const isNewRepo = !fs.existsSync(path.join(repoPath, ".git"));
  if (isNewRepo) {
    const init = await initRepo(repoPath);
    if (init.code !== 0) {
      throw new Error(`git init failed: ${init.stderr || init.stdout}`);
    }
  }
  await writeDefaultIgnores(repoPath, { isNewRepo });

  const readmePath = path.join(repoPath, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, `# ${name}\n`);
  }

  const commit = await commitAll(repoPath, "chore: initial commit");
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
    throw new Error(`initial commit failed: ${commit.stderr || commit.stdout}`);
  }
}
