import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import {
  GraphValidationError,
  buildNodePrompt,
  deriveNodeType,
  loadSkillContent,
  parseSkillsFromBody,
  planGraph,
  runGraph,
  type NodeArtifact,
} from "./graphRunner.js";
import type {
  AgentGraph,
  AgentGraphEdge,
  AgentGraphNode,
  Project,
  Task,
} from "../types/index.js";

function node(id: string, slug: string = id): AgentGraphNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: { slug },
  };
}

function edge(source: string, target: string): AgentGraphEdge {
  return { id: `${source}-${target}`, source, target };
}

describe("planGraph", () => {
  it("rejects an empty graph", () => {
    expect(() => planGraph({ nodes: [], edges: [] })).toThrow(
      GraphValidationError,
    );
  });

  it("returns a single node with no edges", () => {
    const plan = planGraph({ nodes: [node("a")], edges: [] });
    expect(plan.order).toEqual(["a"]);
    expect(plan.slugById).toEqual({ a: "a" });
  });

  it("walks a 3-node linear chain", () => {
    const graph: AgentGraph = {
      nodes: [node("a", "planner"), node("b", "coder"), node("c", "reviewer")],
      edges: [edge("a", "b"), edge("b", "c")],
    };
    const plan = planGraph(graph);
    expect(plan.order).toEqual(["a", "b", "c"]);
    expect(plan.slugById).toEqual({
      a: "planner",
      b: "coder",
      c: "reviewer",
    });
  });

  it("rejects multiple entries", () => {
    expect(() =>
      planGraph({
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge("a", "c")],
      }),
    ).toThrow(/multiple_entries/);
  });

  it("attaches offendingNodeIds for multiple entries", () => {
    try {
      planGraph({
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge("a", "c")],
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphValidationError);
      const ids = (err as GraphValidationError).offendingNodeIds;
      expect(ids).toEqual(expect.arrayContaining(["a", "b"]));
    }
  });

  it("allows fan-out (a→b and a→c) and returns topological order", () => {
    const plan = planGraph({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("a", "c")],
    });
    expect(plan.order[0]).toBe("a");
    expect(plan.order).toContain("b");
    expect(plan.order).toContain("c");
  });

  it("attaches offendingNodeIds for cycle", () => {
    try {
      planGraph({
        nodes: [node("a"), node("b")],
        edges: [edge("a", "b"), edge("b", "b")],
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphValidationError);
      expect((err as GraphValidationError).reason).toBe("cycle");
      expect((err as GraphValidationError).offendingNodeIds).toContain("b");
    }
  });

  it("attaches offendingNodeIds for disconnected (a→b plus orphan c)", () => {
    try {
      planGraph({
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge("a", "b")],
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphValidationError);
      const e = err as GraphValidationError;
      expect(["disconnected", "multiple_entries"]).toContain(e.reason);
      expect(e.offendingNodeIds).toContain("c");
    }
  });

  it("rejects all-cycle (no entry)", () => {
    expect(() =>
      planGraph({
        nodes: [node("a"), node("b")],
        edges: [edge("a", "b"), edge("b", "a")],
      }),
    ).toThrow(/no_entry/);
  });

  it("rejects a self-cycle when reachable from a true entry", () => {
    expect(() =>
      planGraph({
        nodes: [node("a"), node("b")],
        edges: [edge("a", "b"), edge("b", "b")],
      }),
    ).toThrow(/cycle/);
  });

  it("allows fan-out with fan-in (diamond: a→b, a→c, b→d, c→d)", () => {
    const plan = planGraph({
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
    });
    expect(plan.order[0]).toBe("a");
    expect(plan.order[plan.order.length - 1]).toBe("d");
    expect(plan.order).toContain("b");
    expect(plan.order).toContain("c");
  });

  it("rejects disconnected nodes", () => {
    expect(() =>
      planGraph({
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge("a", "b")],
      }),
    ).toThrow(/disconnected|multiple_entries/);
  });
});

describe("deriveNodeType", () => {
  it("matches exact known types", () => {
    expect(deriveNodeType("planner")).toBe("planner");
    expect(deriveNodeType("coder")).toBe("coder");
    expect(deriveNodeType("reviewer")).toBe("reviewer");
    expect(deriveNodeType("tester")).toBe("tester");
  });

  it("matches prefix/suffix patterns", () => {
    expect(deriveNodeType("backend-coder")).toBe("coder");
    expect(deriveNodeType("planner-strict")).toBe("planner");
  });

  it("falls back to custom for unknown slugs", () => {
    expect(deriveNodeType("anything-else")).toBe("custom");
    expect(deriveNodeType("foo")).toBe("custom");
  });
});

describe("buildNodePrompt", () => {
  const baseTask: Task = {
    id: "task_test",
    projectId: "proj_test",
    title: "Add login endpoint",
    description: "POST /api/auth/login",
    analysis: "Implement with bcrypt + JWT",
    status: "doing",
    priority: "medium",
    tags: [],
    branch: null,
    prUrl: null,
    prNumber: null,
    displayId: null,
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    agent: {
      status: "running",
      currentStep: undefined,
      log: [],
      error: null,
      startedAt: null,
      finishedAt: null,
    },
  };

  const baseProject: Project = {
    id: "proj_test",
    name: "Test",
    description: "",
    aiPrompt: "Express + TypeScript backend",
    repoPath: "/tmp/test",
    defaultBranch: "main",
    remote: null,
    createdAt: "2026-05-02T00:00:00.000Z",
    planningStatus: "idle",
    slug: "test",
    taskCounter: 0,
  };

  const planner = {
    slug: "planner",
    frontmatter: { name: "Planner", description: "plans tasks" },
    body: "You are a planner. Output a brief plan.",
    allowedTools: null,
  };

  it("includes agent body, background, and task brief without prior", () => {
    const prompt = buildNodePrompt(planner, baseTask, baseProject, null);
    expect(prompt).toContain("You are a planner");
    expect(prompt).toContain("Express + TypeScript backend");
    expect(prompt).toContain("Implement with bcrypt + JWT");
    expect(prompt).not.toContain("Previous node output");
    expect(prompt).toContain("When done, exit the terminal");
  });

  it("includes prior text when present", () => {
    const prior: NodeArtifact = {
      text: "plan: make it work",
      diff: null,
      extra: {},
    };
    const prompt = buildNodePrompt(planner, baseTask, baseProject, prior);
    expect(prompt).toContain("Previous node output:\nplan: make it work");
  });

  it("includes a diff block when prior has a diff", () => {
    const prior: NodeArtifact = {
      text: "did the thing",
      diff: "diff --git a/x b/x\n+changed",
      extra: {},
    };
    const prompt = buildNodePrompt(planner, baseTask, baseProject, prior);
    expect(prompt).toContain("```diff");
    expect(prompt).toContain("+changed");
  });

  it("truncates diffs over 30k chars and notes truncation", () => {
    const huge = "x".repeat(50_000);
    const prior: NodeArtifact = { text: "", diff: huge, extra: {} };
    const prompt = buildNodePrompt(planner, baseTask, baseProject, prior);
    expect(prompt).toContain("truncated to 30000 chars");
    const fenceMatch = prompt.match(/```diff\n(x+)\n```/);
    expect(fenceMatch).not.toBeNull();
    expect(fenceMatch![1]!.length).toBe(30_000);
  });

  it("falls back to title when analysis and description are empty", () => {
    const t: Task = { ...baseTask, analysis: "", description: "" };
    const prompt = buildNodePrompt(planner, t, baseProject, null);
    expect(prompt).toContain("Add login endpoint");
  });

  it("omits the background section when project has no aiPrompt", () => {
    const p: Project = { ...baseProject, aiPrompt: "" };
    const prompt = buildNodePrompt(planner, baseTask, p, null);
    expect(prompt).not.toContain("Project background");
  });

  it("injects skill content for skills listed in body", () => {
    const agentWithSkill = {
      ...planner,
      body: "Do work.\n\n## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| my-skill | does stuff |\n",
    };
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFileSync).mockReturnValueOnce("# My Skill\nDo X." as ReturnType<typeof readFileSync>);
    const prompt = buildNodePrompt(agentWithSkill, baseTask, baseProject, null);
    expect(prompt).toContain("Skill: my-skill");
    expect(prompt).toContain("Do X.");
    vi.clearAllMocks();
  });

  it("skips skills with no SKILL.md", () => {
    const agentWithSkill = {
      ...planner,
      body: "Do work.\n\n## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| missing | |\n",
    };
    vi.mocked(existsSync).mockReturnValueOnce(false);
    const prompt = buildNodePrompt(agentWithSkill, baseTask, baseProject, null);
    expect(prompt).not.toContain("Skill: missing");
    vi.clearAllMocks();
  });

  it("skips skills with unsafe IDs (path traversal guard)", () => {
    const agentWithSkill = {
      ...planner,
      body: "Do work.\n\n## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| ../secret | |\n",
    };
    const prompt = buildNodePrompt(agentWithSkill, baseTask, baseProject, null);
    expect(prompt).not.toContain("Skill: ../secret");
  });

  it("does not inject when no Available Skills section", () => {
    const prompt = buildNodePrompt(planner, baseTask, baseProject, null);
    expect(prompt).not.toContain("Skill:");
  });
});

describe("parseSkillsFromBody", () => {
  it("parses skill ids from Available Skills table", () => {
    const body = "## Available Skills\n\n| Skill | Description |\n|-------|-------------|\n| ccg | does stuff |\n| plan | plans |\n";
    expect(parseSkillsFromBody(body)).toEqual(["ccg", "plan"]);
  });

  it("returns empty array when section absent", () => {
    expect(parseSkillsFromBody("No skills here.")).toEqual([]);
  });
});

describe("loadSkillContent", () => {
  it("returns null for unsafe skill IDs", () => {
    expect(loadSkillContent("../etc/passwd")).toBeNull();
    expect(loadSkillContent("../../secret")).toBeNull();
  });

  it("returns null when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    expect(loadSkillContent("nonexistent-skill")).toBeNull();
    vi.clearAllMocks();
  });

  it("returns file content when file exists", () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFileSync).mockReturnValueOnce("# Skill content" as ReturnType<typeof readFileSync>);
    expect(loadSkillContent("valid-skill")).toBe("# Skill content");
    vi.clearAllMocks();
  });
});

describe("runGraph abort cascade", () => {
  const abortTask: Task = {
    id: "task_abort_test",
    projectId: "proj_abort",
    title: "abort test",
    description: "",
    analysis: "",
    status: "doing",
    priority: "medium",
    tags: [],
    branch: null,
    prUrl: null,
    prNumber: null,
    displayId: null,
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    agent: {
      status: "running",
      currentStep: undefined,
      log: [],
      error: null,
      startedAt: null,
      finishedAt: null,
    },
  };

  const abortProject: Project = {
    id: "proj_abort",
    name: "Abort Test",
    description: "",
    aiPrompt: "",
    repoPath: "/tmp/abort-test",
    defaultBranch: "main",
    remote: null,
    createdAt: "2026-05-04T00:00:00.000Z",
    planningStatus: "idle",
    slug: "abort-test",
    taskCounter: 0,
  };

  it("throws 'aborted' immediately when controller is pre-aborted", async () => {
    const graph: AgentGraph = {
      nodes: [node("a", "planner"), node("b", "coder")],
      edges: [edge("a", "b")],
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      runGraph(abortTask, abortProject, graph, controller, "main"),
    ).rejects.toThrow("aborted");
  });

  it("throws 'aborted' for a single-node graph when pre-aborted", async () => {
    const graph: AgentGraph = { nodes: [node("a", "planner")], edges: [] };
    const controller = new AbortController();
    controller.abort();

    await expect(
      runGraph(abortTask, abortProject, graph, controller, "main"),
    ).rejects.toThrow("aborted");
  });
});
