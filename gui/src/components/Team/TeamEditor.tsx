"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ApiError, api } from "@/lib/api";
import { useBoardStore } from "@/store/boardStore";
import { useTranslation } from "@/hooks/useTranslation";
import { useTeams } from "@/hooks/useTeams";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { SkillsManagerModal } from "@/components/Modals/SkillsManagerModal";
import { IconAlert, IconCheck, IconCopy, IconInfo, IconLock, IconRetry, IconStar, IconTeam, IconTrash, IconUpload } from "@/components/ui/icons";
import type { RoleKind, SkillCatalogEntry, SystemCapabilities, Team, TeamRole } from "@/types";
import { RoleEditor } from "./RoleEditor";
import { RoleList } from "./RoleList";
import { TeamList } from "./TeamList";
import { TeamSettings } from "./TeamSettings";
import { SOLO_TEAM_ID, fill, teamDescription, teamName } from "./roleMeta";
import {
  FALLBACK_MODELS,
  insertRole,
  moveRole,
  newRole,
  sameRoles,
  serverIssues,
  validateDraft,
  type DraftIssue,
} from "./teamDraft";

interface Draft {
  name: string;
  description: string;
  roles: TeamRole[];
}

let capabilitiesCache: SystemCapabilities | null = null;

function draftOf(team: Team): Draft {
  return { name: team.name, description: team.description, roles: team.roles.map((r) => ({ ...r })) };
}

type Confirm = { kind: "delete"; team: Team } | { kind: "discard"; nextId: string } | null;

/**
 * Ekip editörü: project team settings, the team list (built-ins, templates, project
 * teams) and the selected team's roles. Built-ins and templates are read-only here;
 * "Özelleştir" copies one into the project (copy-on-write) where it can be edited.
 */
export function TeamEditor({ projectId, initialTeamId }: { projectId: string; initialTeamId?: string | null }) {
  const t = useTranslation();
  const te = t.team.editor;
  const project = useBoardStore((s) => s.projects.find((p) => p.id === projectId) ?? null);
  const setTeams = useBoardStore((s) => s.setTeams);
  const updateProjectLocal = useBoardStore((s) => s.updateProject);
  const { teams, loading } = useTeams(projectId);

  const [caps, setCaps] = useState<SystemCapabilities | null>(capabilitiesCache);
  const [catalog, setCatalog] = useState<SkillCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);

  const defaultId = project?.defaultTeamId ?? SOLO_TEAM_ID;
  const [selectedId, setSelectedId] = useState<string | null>(initialTeamId ?? null);
  const selected = useMemo(
    () => teams.find((x) => x.id === selectedId) ?? teams.find((x) => x.id === defaultId) ?? teams[0] ?? null,
    [teams, selectedId, defaultId],
  );
  const editable = Boolean(selected && !selected.builtin && selected.projectId !== null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [roleIndex, setRoleIndex] = useState(0);
  const [serverErr, setServerErr] = useState<DraftIssue[]>([]);
  const [busy, setBusy] = useState<null | "save" | "default" | "customize" | "template" | "delete">(null);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  useEffect(() => {
    if (initialTeamId) setSelectedId(initialTeamId);
  }, [initialTeamId]);

  useEffect(() => {
    if (capabilitiesCache) return;
    api
      .getCapabilities()
      .then((c) => {
        capabilitiesCache = c;
        setCaps(c);
      })
      .catch(() => setCaps({ advisor: false, models: FALLBACK_MODELS }));
  }, []);

  const loadCatalog = useCallback(() => {
    setCatalogError(false);
    api
      .listSkillCatalog(projectId)
      .then(setCatalog)
      .catch(() => setCatalogError(true));
  }, [projectId]);
  useEffect(() => loadCatalog(), [loadCatalog]);

  // Reset the draft whenever another team is selected or the saved version changes.
  const selectedKey = selected ? `${selected.id}:${selected.updatedAt}` : "";
  useEffect(() => {
    setDraft(selected ? draftOf(selected) : null);
    setServerErr([]);
    setRoleIndex((i) => (selected && i < selected.roles.length ? i : 0));
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const models = caps?.models ?? FALLBACK_MODELS;
  const advisorEnabled = Boolean(caps?.advisor);

  const view: Draft | null = editable ? draft : selected ? draftOf(selected) : null;
  const dirty = Boolean(
    editable &&
      draft &&
      selected &&
      (draft.name !== selected.name || draft.description !== selected.description || !sameRoles(draft.roles, selected.roles)),
  );
  const issues: DraftIssue[] = useMemo(() => {
    if (!editable || !draft) return [];
    const local = validateDraft(draft.name, draft.roles, models, advisorEnabled);
    return local.length > 0 ? local : serverErr;
  }, [editable, draft, models, advisorEnabled, serverErr]);

  const reload = async (selectId?: string) => {
    const list = await api.listTeams(projectId);
    setTeams(projectId, list);
    if (selectId) setSelectedId(selectId);
  };

  const showFlash = (ok: boolean, msg: string) => {
    setFlash({ ok, msg });
    if (ok) setTimeout(() => setFlash((f) => (f?.msg === msg ? null : f)), 3000);
  };

  const select = (id: string) => {
    if (id === selected?.id) return;
    if (dirty) {
      setConfirm({ kind: "discard", nextId: id });
      return;
    }
    setFlash(null);
    setSelectedId(id);
    setRoleIndex(0);
  };

  const patchDraft = (patch: Partial<Draft>) => {
    setServerErr([]);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  const patchRole = (i: number, patch: Partial<TeamRole>) => {
    setServerErr([]);
    setDraft((d) => {
      if (!d) return d;
      const roles = d.roles.map((r, k) => {
        if (k !== i) return r;
        const next = { ...r, ...patch };
        // A stronger main model can leave the advisor below it: drop the advisor then.
        if (patch.model && next.advisorModel) {
          const rank = (m: string) => models.findIndex((x) => m.toLowerCase().includes(x));
          if (rank(next.advisorModel) < rank(next.model)) next.advisorModel = null;
        }
        return next;
      });
      return { ...d, roles };
    });
  };

  const addRole = (kind: RoleKind) => {
    if (!draft) return;
    const role = newRole(kind, teams, new Set(draft.roles.map((r) => r.id)));
    const roles = insertRole(draft.roles, role);
    patchDraft({ roles });
    setRoleIndex(roles.findIndex((r) => r.id === role.id));
  };
  const removeRole = (i: number) => {
    if (!draft) return;
    patchDraft({ roles: draft.roles.filter((_, k) => k !== i) });
    setRoleIndex((cur) => Math.max(0, cur > i ? cur - 1 : Math.min(cur, draft.roles.length - 2)));
  };
  const move = (from: number, to: number) => {
    if (!draft) return;
    patchDraft({ roles: moveRole(draft.roles, from, to) });
    setRoleIndex(to);
  };

  const save = async () => {
    if (!selected || !draft || issues.length > 0) return;
    setBusy("save");
    setFlash(null);
    try {
      await api.updateTeam(selected.id, { name: draft.name.trim(), description: draft.description, roles: draft.roles });
      await reload();
      showFlash(true, te.saved);
    } catch (err) {
      const mapped = err instanceof ApiError ? serverIssues(err.body) : [];
      setServerErr(mapped);
      showFlash(false, mapped.length > 0 ? fill(te.issues, { n: mapped.length }) : te.saveError);
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = async () => {
    if (!selected || !project) return;
    setBusy("default");
    setFlash(null);
    const previous = project.defaultTeamId ?? null;
    updateProjectLocal(project.id, { defaultTeamId: selected.id });
    try {
      await api.updateProject(project.id, { defaultTeamId: selected.id });
    } catch {
      updateProjectLocal(project.id, { defaultTeamId: previous });
      showFlash(false, te.actionError);
    } finally {
      setBusy(null);
    }
  };

  const customize = async () => {
    if (!selected) return;
    setBusy("customize");
    setFlash(null);
    try {
      const copy = await api.createTeam({
        name: fill(te.copyName, { name: teamName(selected, t) }).slice(0, 80),
        description: teamDescription(selected, t).slice(0, 500),
        projectId,
        fromTeamId: selected.id,
      });
      await reload(copy.id);
      setRoleIndex(0);
    } catch {
      showFlash(false, te.actionError);
    } finally {
      setBusy(null);
    }
  };

  const saveAsTemplate = async () => {
    if (!selected || dirty) return;
    setBusy("template");
    setFlash(null);
    try {
      const tpl = await api.createTeam({
        name: selected.name,
        description: selected.description,
        projectId: null,
        fromTeamId: selected.id,
      });
      await reload(tpl.id);
      showFlash(true, te.templateSaved);
    } catch {
      showFlash(false, te.actionError);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (team: Team) => {
    setConfirm(null);
    setBusy("delete");
    setFlash(null);
    try {
      await api.deleteTeam(team.id);
      await reload(defaultId === team.id ? SOLO_TEAM_ID : defaultId);
    } catch (err) {
      const inUse = err instanceof ApiError && err.status === 409;
      showFlash(false, inUse ? te.deleteInUse : te.deleteError);
    } finally {
      setBusy(null);
    }
  };

  if (!project) return null;

  const isTemplate = Boolean(selected && !selected.builtin && selected.projectId === null);
  const roles = view?.roles ?? [];
  const role = roles[Math.min(roleIndex, Math.max(0, roles.length - 1))] ?? null;
  const kindBadge = selected
    ? selected.builtin
      ? { label: te.builtinBadge, bg: "var(--cobalt)", on: "var(--on-cobalt)" }
      : isTemplate
        ? { label: te.templateBadge, bg: "var(--mustard)", on: "var(--on-mustard)" }
        : { label: te.projectBadge, bg: "var(--panel)", on: "var(--ink)" }
    : null;

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5">
      <TeamSettings project={project} teams={teams} />

      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {loading && teams.length === 0 ? (
          <p className="font-mono text-[12px] text-ink-3">{t.team.picker.loading}</p>
        ) : (
          <TeamList teams={teams} selectedId={selected?.id ?? null} defaultId={defaultId} onSelect={select} />
        )}

        {selected && view && (
          <section aria-label={teamName(selected, t)} className="ui-panel ui-panel--raised min-w-0 overflow-hidden">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-line bg-panel px-4 py-3">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border-2 border-line bg-mustard text-[var(--on-mustard)]"
                style={{ boxShadow: "2px 2px 0 var(--shadow-ink)" }}
              >
                <IconTeam size={16} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {editable && draft ? (
                  <Input
                    size="sm"
                    aria-label={te.teamName}
                    value={draft.name}
                    maxLength={80}
                    invalid={!draft.name.trim()}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                    className="!max-w-[26rem] !text-[15px] !font-bold"
                  />
                ) : (
                  <h3 className="truncate text-[17px] font-bold leading-tight text-ink">{teamName(selected, t)}</h3>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                  {kindBadge && (
                    <span
                      className="inline-flex items-center gap-1 rounded-pill border-[1.5px] border-line px-1.5 font-mono text-[9.5px] font-bold uppercase leading-[16px] tracking-[0.08em]"
                      style={{ background: kindBadge.bg, color: kindBadge.on }}
                    >
                      {!editable && <IconLock size={9} />}
                      {kindBadge.label}
                    </span>
                  )}
                  {selected.id === defaultId && (
                    <span className="inline-flex items-center gap-0.5 rounded-pill border-[1.5px] border-line bg-green px-1.5 font-mono text-[9.5px] font-bold uppercase leading-[16px] tracking-[0.08em] text-[var(--on-green)]">
                      <IconCheck size={9} />
                      {te.defaultBadge}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selected.id !== defaultId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<IconStar size={13} />}
                    onClick={makeDefault}
                    loading={busy === "default"}
                    disabled={busy !== null || dirty}
                    title={dirty ? te.saveFirst : undefined}
                  >
                    {te.makeDefault}
                  </Button>
                )}
                {!editable && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<IconCopy size={13} />}
                    onClick={customize}
                    loading={busy === "customize"}
                    disabled={busy !== null}
                    title={te.customizeHint}
                  >
                    {te.customize}
                  </Button>
                )}
                {editable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<IconUpload size={13} />}
                    onClick={saveAsTemplate}
                    loading={busy === "template"}
                    disabled={busy !== null || dirty}
                    title={dirty ? te.saveFirst : te.saveAsTemplateHint}
                  >
                    {te.saveAsTemplate}
                  </Button>
                )}
                {!selected.builtin && (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<IconTrash size={13} />}
                    onClick={() => setConfirm({ kind: "delete", team: selected })}
                    loading={busy === "delete"}
                    disabled={busy !== null || selected.id === project.defaultTeamId}
                    title={selected.id === project.defaultTeamId ? te.deleteInUse : undefined}
                  >
                    {te.delete}
                  </Button>
                )}
              </div>
            </header>

            {!editable && (
              <div className="ui-banner ui-banner--info mx-4 mt-3.5">
                <IconInfo size={14} className="mt-0.5 shrink-0 text-[var(--cobalt-text)]" />
                <span>{selected.builtin ? te.readonlyBuiltin : te.readonlyTemplate}</span>
              </div>
            )}

            <div className="px-4 pt-3.5">
              {editable && draft ? (
                <Input
                  size="sm"
                  aria-label={te.teamDescription}
                  placeholder={te.teamDescriptionPlaceholder}
                  value={draft.description}
                  maxLength={500}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                />
              ) : (
                <p className="text-[13px] leading-snug text-ink-2">{teamDescription(selected, t) || "—"}</p>
              )}
              <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{te.rolesHint}</p>
            </div>

            <div className="grid gap-5 px-4 py-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <RoleList
                roles={roles}
                selected={Math.min(roleIndex, Math.max(0, roles.length - 1))}
                onSelect={setRoleIndex}
                onMove={editable ? move : undefined}
                onRemove={editable ? removeRole : undefined}
                onAdd={editable ? addRole : undefined}
                issues={issues}
                advisorEnabled={advisorEnabled}
              />
              <div className="min-w-0 xl:border-l-2 xl:border-dashed xl:border-hair xl:pl-5">
                {role ? (
                  <RoleEditor
                    key={`${selected.id}:${role.id}`}
                    role={role}
                    index={roles.indexOf(role)}
                    onChange={editable ? (patch) => patchRole(roles.indexOf(role), patch) : undefined}
                    models={models}
                    advisorEnabled={advisorEnabled}
                    catalog={catalog}
                    catalogError={catalogError}
                    onOpenSkillManager={() => setSkillsOpen(true)}
                    issues={issues}
                  />
                ) : (
                  <p className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-4 py-6 text-center text-[13px] text-ink-3">
                    {te.roleEditorEmpty}
                  </p>
                )}
              </div>
            </div>

            {(editable || flash) && (
              <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t-2 border-line bg-panel px-4 py-2.5">
                <span aria-live="polite" className="mr-auto flex min-w-0 items-center gap-2 text-[12.5px] font-semibold">
                  {flash ? (
                    <span className={flash.ok ? "inline-flex items-center gap-1 text-[var(--green-text)]" : "inline-flex items-center gap-1 text-[var(--red-text)]"}>
                      {flash.ok ? <IconCheck size={13} /> : <IconAlert size={13} />}
                      {flash.msg}
                    </span>
                  ) : dirty ? (
                    <span className="inline-flex items-center gap-1.5 text-[var(--orange-text)]">
                      <span aria-hidden className="ui-dot ui-dot--live !h-2 !w-2" style={{ "--dot": "var(--orange)" } as CSSProperties} />
                      {te.unsaved}
                    </span>
                  ) : null}
                  {issues.length > 0 && (
                    <span className="font-mono text-[11.5px] text-[var(--red-text)]">{fill(te.issues, { n: issues.length })}</span>
                  )}
                </span>
                {editable && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<IconRetry size={13} />}
                      disabled={!dirty || busy !== null}
                      onClick={() => {
                        if (selected) setDraft(draftOf(selected));
                        setServerErr([]);
                      }}
                    >
                      {te.revert}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<IconCheck size={13} />}
                      disabled={!dirty || issues.length > 0 || busy !== null}
                      loading={busy === "save"}
                      onClick={save}
                    >
                      {busy === "save" ? te.saving : te.save}
                    </Button>
                  </>
                )}
              </footer>
            )}
          </section>
        )}
      </div>

      <SkillsManagerModal
        projectId={projectId}
        open={skillsOpen}
        onClose={() => {
          setSkillsOpen(false);
          loadCatalog();
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === "delete"}
        variant="danger"
        title={confirm?.kind === "delete" && !confirm.team.projectId ? te.deleteTemplateTitle : te.deleteTeamTitle}
        description={
          confirm?.kind === "delete" && !confirm.team.projectId ? te.deleteTemplateDescription : te.deleteTeamDescription
        }
        confirmLabel={te.deleteConfirm}
        cancelLabel={te.keep}
        onConfirm={() => {
          if (confirm?.kind === "delete") void doDelete(confirm.team);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "discard"}
        variant="warning"
        title={te.discardTitle}
        description={te.discardDescription}
        confirmLabel={te.discard}
        cancelLabel={te.keep}
        onConfirm={() => {
          if (confirm?.kind === "discard") {
            setSelectedId(confirm.nextId);
            setRoleIndex(0);
            setFlash(null);
          }
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
