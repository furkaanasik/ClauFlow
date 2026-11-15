import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSkillCatalog, readSkillBody, type SkillCatalogRoots } from "./skillCatalogService.js";

let root = "";
let roots: SkillCatalogRoots;

function skill(dir: string, name: string, content: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), content);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ekipler-skills-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const plugin = join(root, "plugins", "myplug");
  const disabled = join(root, "plugins", "offplug");

  skill(join(home, ".claude", "skills"), "alpha", "---\nname: Alpha\ndescription: \"user skill\"\n---\n\nAlpha body\n");
  mkdirSync(join(home, ".claude", "skills", "no-skill-md"), { recursive: true });
  skill(join(repo, ".claude", "skills"), "beta", "---\ndescription: project skill\n---\nBeta body");
  skill(join(plugin, "skills"), "gamma", "---\nname: gamma\ndescription: plugin skill\n---\n# Gamma\n\nGamma body\n");
  skill(join(disabled, "skills"), "delta", "Delta body");

  roots = {
    homeDir: home,
    projectRepoPath: repo,
    listPlugins: async () => [
      { id: "myplug@market", installPath: plugin, enabled: true },
      { id: "offplug@market", installPath: disabled, enabled: false },
    ],
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("skill catalog", () => {
  it("merges user, project and enabled plugin skills with namespaced ids", async () => {
    const catalog = await getSkillCatalog(roots);
    expect(catalog).toEqual([
      { id: "user:alpha", name: "Alpha", source: "user", description: "user skill" },
      { id: "project:beta", name: "beta", source: "project", description: "project skill" },
      { id: "myplug:gamma", name: "gamma", source: "plugin", pluginId: "myplug@market", description: "plugin skill" },
    ]);
  });

  it("reads a plugin:skill and a project skill body without frontmatter", async () => {
    expect(await readSkillBody("myplug:gamma", roots)).toBe("# Gamma\n\nGamma body");
    expect(await readSkillBody("project:beta", roots)).toBe("Beta body");
    expect(await readSkillBody("user:alpha", roots)).toBe("Alpha body");
  });

  it("only resolves ids that are in the catalog", async () => {
    expect(await readSkillBody("offplug:delta", roots)).toBeNull();
    expect(await readSkillBody("user:../../etc", roots)).toBeNull();
    expect(await readSkillBody("user:no-skill-md", roots)).toBeNull();
  });

  it("keeps user and project skills when the plugin list fails", async () => {
    const catalog = await getSkillCatalog({
      ...roots,
      listPlugins: async () => {
        throw new Error("no claude");
      },
    });
    expect(catalog.map((s) => s.id)).toEqual(["user:alpha", "project:beta"]);
  });
});
