import type Database from "better-sqlite3";
import type { RoleKind, TeamRole } from "../types/index.js";

export const BUILTIN_TEAM_IDS = {
  solo: "team_solo",
  yazilimEkibi: "team_yazilim_ekibi",
  hataAvi: "team_hata_avi",
  kesif: "team_kesif",
} as const;

export const DEFAULT_NEW_PROJECT_TEAM_ID = BUILTIN_TEAM_IDS.yazilimEkibi;

export const ROLE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
] as const;

const ROLE_INSTRUCTIONS: Record<RoleKind, string> = {
  ceo: [
    "You are the CEO of a small software team. Turn the task into a short, decisive brief for the team.",
    "Read the repository only as much as you need to understand the context. Do not write or edit files.",
    "Never ask the user questions. When something is unclear, choose the most reasonable option and record it under Assumptions.",
    "Write the brief with these sections: Goal, Scope, Out of scope, Assumptions.",
  ].join("\n"),
  analyst: [
    "You are the analyst. Turn the task and the CEO brief (if any) into a precise specification the developer can implement without guessing.",
    "Inspect the codebase to name the concrete files, functions and tests involved. Do not write or edit files.",
    "Write the specification with these sections: What to build, Files, Acceptance criteria (numbered AC-1, AC-2, ...; each one objectively checkable), Test suggestions.",
  ].join("\n"),
  developer: [
    "You are the developer. Implement the task according to the specification and its acceptance criteria.",
    "Follow the conventions already used in the repository. Add or update tests for the change and run them.",
    "When a QA bug list is provided, fix every listed item before anything else.",
    "Finish with a delivery note: changed files, how each acceptance criterion is met, and the test command and its result.",
  ].join("\n"),
  qa: [
    "You are QA. Verify the developer's work against every acceptance criterion in the specification.",
    "Read the diff and the code, run the project's tests and any focused checks you need. Do not write or edit files.",
    "Report each acceptance criterion as passed or failed with a one-line reason, and summarise the test output.",
    "If anything fails, list the problems as a numbered bug list the developer can act on.",
  ].join("\n"),
};

const ROLE_NAMES: Record<RoleKind, string> = {
  ceo: "CEO",
  analyst: "Analist",
  developer: "Yazılımcı",
  qa: "QA",
};

const ROLE_DEFAULTS: Record<RoleKind, Pick<TeamRole, "model" | "advisorModel" | "tools">> = {
  ceo: { model: "sonnet", advisorModel: null, tools: ["Read", "Glob", "Grep"] },
  analyst: { model: "opus", advisorModel: null, tools: ["Read", "Glob", "Grep", "Bash"] },
  developer: {
    model: "sonnet",
    advisorModel: "opus",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  },
  qa: { model: "sonnet", advisorModel: "opus", tools: ["Read", "Bash", "Glob", "Grep"] },
};

export function defaultRole(kind: RoleKind): TeamRole {
  const defaults = ROLE_DEFAULTS[kind];
  return {
    id: kind,
    kind,
    name: ROLE_NAMES[kind],
    instructions: ROLE_INSTRUCTIONS[kind],
    model: defaults.model,
    advisorModel: defaults.advisorModel,
    tools: [...defaults.tools],
    skills: [],
  };
}

interface BuiltinTeamTemplate {
  id: string;
  templateKey: string;
  name: string;
  description: string;
  roles: TeamRole[];
}

export const BUILTIN_TEAMS: readonly BuiltinTeamTemplate[] = [
  {
    id: BUILTIN_TEAM_IDS.solo,
    templateKey: "solo",
    name: "Solo",
    description: "Tek bir Yazılımcı görevi baştan sona yapar.",
    roles: [defaultRole("developer")],
  },
  {
    id: BUILTIN_TEAM_IDS.yazilimEkibi,
    templateKey: "yazilim_ekibi",
    name: "Yazılım Ekibi",
    description: "CEO brief yazar, Analist şartname çıkarır, Yazılımcı uygular, QA kontrol eder.",
    roles: (["ceo", "analyst", "developer", "qa"] as const).map(defaultRole),
  },
  {
    id: BUILTIN_TEAM_IDS.hataAvi,
    templateKey: "hata_avi",
    name: "Hata Avı",
    description: "Analist hatayı tanımlar, Yazılımcı düzeltir, QA doğrular.",
    roles: (["analyst", "developer", "qa"] as const).map(defaultRole),
  },
  {
    id: BUILTIN_TEAM_IDS.kesif,
    templateKey: "kesif",
    name: "Keşif",
    description: "CEO ve Analist konuyu inceler. Kod yazılmaz, sonuç görev yorumu olur.",
    roles: (["ceo", "analyst"] as const).map(defaultRole),
  },
];

export function upsertBuiltinTeams(db: Database.Database): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO teams (id, projectId, templateKey, name, description, roles, builtin, createdAt, updatedAt)
     VALUES (@id, NULL, @templateKey, @name, @description, @roles, 1, @now, @now)
     ON CONFLICT(id) DO UPDATE SET
       projectId = NULL,
       templateKey = excluded.templateKey,
       name = excluded.name,
       description = excluded.description,
       roles = excluded.roles,
       builtin = 1,
       updatedAt = CASE WHEN teams.roles = excluded.roles
                         AND teams.name = excluded.name
                         AND teams.description = excluded.description
                        THEN teams.updatedAt ELSE excluded.updatedAt END`,
  );
  db.transaction(() => {
    for (const team of BUILTIN_TEAMS) {
      stmt.run({
        id: team.id,
        templateKey: team.templateKey,
        name: team.name,
        description: team.description,
        roles: JSON.stringify(team.roles),
        now,
      });
    }
  })();
}
