"use client";

import clsx from "clsx";
import { useId, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Chip";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Toggle";
import { IconBolt, IconSearch } from "@/components/ui/icons";
import type { SkillCatalogEntry, SkillSource, TeamRole } from "@/types";
import { RolePlate } from "./RoleChain";
import { roleLabel } from "./roleMeta";
import { MAX_ROLE_SKILLS, ROLE_TOOLS, advisorOptions, type DraftIssue } from "./teamDraft";

interface RoleEditorProps {
  role: TeamRole;
  index: number;
  /** Absent = read-only view. */
  onChange?: (patch: Partial<TeamRole>) => void;
  models: string[];
  advisorEnabled: boolean;
  catalog: SkillCatalogEntry[] | null;
  catalogError: boolean;
  onOpenSkillManager: () => void;
  issues: DraftIssue[];
}

/** Role settings: name, model, advisor, instructions, tools and skills. */
export function RoleEditor({
  role,
  index,
  onChange,
  models,
  advisorEnabled,
  catalog,
  catalogError,
  onOpenSkillManager,
  issues,
}: RoleEditorProps) {
  const t = useTranslation();
  const te = t.team.editor;
  const id = useId();
  const readOnly = !onChange;
  const mine = issues.filter((i) => i.roleIndex === index).map((i) => i.code);
  const msg = (codes: string[]) => {
    const c = mine.find((x) => codes.includes(x));
    return c ? te.validation[c as keyof typeof te.validation] : undefined;
  };

  // Keep a current model that isn't in the list selectable (e.g. a full model name).
  const modelChoices = models.includes(role.model) ? models : [role.model, ...models];
  const advisorChoices = advisorOptions(role.model, models);
  if (role.advisorModel && !advisorChoices.includes(role.advisorModel)) advisorChoices.unshift(role.advisorModel);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex items-center gap-2.5">
        <RolePlate kind={role.kind} size="md" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="t-label !text-[10px]">{t.team.roles[role.kind]}</span>
          <span className="truncate text-[16px] font-bold text-ink">{roleLabel(role, role.kind, t)}</span>
        </div>
      </header>

      {readOnly ? (
        <ReadOnlyRole role={role} advisorEnabled={advisorEnabled} catalog={catalog} />
      ) : (
        <>
          <div className={clsx("grid gap-3", advisorEnabled ? "md:grid-cols-3" : "md:grid-cols-2")}>
            <Field label={te.roleName} error={msg(["name_required"])}>
              {({ id: fid, describedBy, invalid }) => (
                <Input
                  id={fid}
                  size="sm"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  maxLength={80}
                  value={role.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                />
              )}
            </Field>
            <Field label={te.model} error={msg(["invalid_model"])}>
              {({ id: fid, describedBy, invalid }) => (
                <Select
                  id={fid}
                  size="sm"
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={role.model}
                  onChange={(e) => onChange({ model: e.target.value })}
                  className="font-mono"
                >
                  {modelChoices.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {advisorEnabled && (
              <Field label={te.advisor} error={msg(["advisor_below_model", "haiku_advisor"])}>
                {({ id: fid, describedBy, invalid }) => (
                  <Select
                    id={fid}
                    size="sm"
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={role.advisorModel ?? ""}
                    onChange={(e) => onChange({ advisorModel: e.target.value || null })}
                    className="font-mono"
                  >
                    <option value="">{te.advisorNone}</option>
                    {advisorChoices.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          {advisorEnabled && <p className="-mt-2 text-[12px] leading-snug text-ink-3">{te.advisorHint}</p>}

          <Field label={te.instructions} hint={te.instructionsHint} aside={`${role.instructions.length}`}>
            {({ id: fid, describedBy }) => (
              <Textarea
                id={fid}
                mono
                rows={9}
                aria-describedby={describedBy}
                value={role.instructions}
                maxLength={20000}
                spellCheck={false}
                onChange={(e) => onChange({ instructions: e.target.value })}
                className="!text-[12.5px]"
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-tools-hint`}>
            <legend className="mb-2 text-[13px] font-semibold text-ink">{te.tools}</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {ROLE_TOOLS.map((tool) => (
                <Checkbox
                  key={tool}
                  label={<span className="font-mono text-[12px]">{tool}</span>}
                  checked={role.tools.includes(tool)}
                  onChange={(e) =>
                    onChange({
                      tools: e.target.checked
                        ? ROLE_TOOLS.filter((x) => x === tool || role.tools.includes(x))
                        : role.tools.filter((x) => x !== tool),
                    })
                  }
                />
              ))}
            </div>
            <p id={`${id}-tools-hint`} className={clsx("text-[12px] leading-snug", msg(["tools_min"]) ? "font-medium text-[var(--red-text)]" : "text-ink-3")}>
              {msg(["tools_min"]) ?? te.toolsHint}
            </p>
          </fieldset>

          <SkillPicker
            value={role.skills}
            onChange={(skills) => onChange({ skills })}
            catalog={catalog}
            catalogError={catalogError}
            onOpenSkillManager={onOpenSkillManager}
            error={msg(["skills_max", "invalid_skill_id", "duplicate_skill"])}
          />
        </>
      )}
    </div>
  );
}

function sourceLabel(source: SkillSource, te: ReturnType<typeof useTranslation>["team"]["editor"]): string {
  return source === "user" ? te.sourceUser : source === "project" ? te.sourceProject : te.sourcePlugin;
}

const SOURCE_DOT: Record<SkillSource, string> = {
  user: "var(--green)",
  project: "var(--mustard)",
  plugin: "var(--cobalt)",
};

const VISIBLE_LIMIT = 60;

function SkillPicker({
  value,
  onChange,
  catalog,
  catalogError,
  onOpenSkillManager,
  error,
}: {
  value: string[];
  onChange: (skills: string[]) => void;
  catalog: SkillCatalogEntry[] | null;
  catalogError: boolean;
  onOpenSkillManager: () => void;
  error?: string;
}) {
  const t = useTranslation();
  const te = t.team.editor;
  const id = useId();
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map((catalog ?? []).map((s) => [s.id, s])), [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = catalog ?? [];
    if (!q) return list;
    return list.filter(
      (s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [catalog, query]);
  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const full = value.length >= MAX_ROLE_SKILLS;

  const toggle = (skillId: string, on: boolean) => {
    onChange(on ? [...value, skillId] : value.filter((x) => x !== skillId));
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 flex w-full items-center gap-2 text-[13px] font-semibold text-ink">
        {te.skills}
        <span className="font-mono text-[11px] font-normal text-ink-3">{t.team.editor.skillsSelected.replace("{n}", String(value.length))}</span>
      </legend>
      <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] leading-snug text-ink-3">{te.skillsHint}</p>
        <Button size="sm" variant="secondary" icon={<IconBolt size={12} />} onClick={onOpenSkillManager}>
          {te.skillsManager}
        </Button>
      </div>

      <div className="flex min-h-7 flex-wrap gap-1.5" aria-live="polite">
        {value.length === 0 ? (
          <span className="text-[12px] text-ink-3">{te.skillsNone}</span>
        ) : (
          value.map((sid) => {
            const entry = byId.get(sid);
            return (
              <Tag
                key={sid}
                dot={entry ? SOURCE_DOT[entry.source] : "var(--red)"}
                onRemove={() => toggle(sid, false)}
                removeLabel={te.skillRemove.replace("{name}", sid)}
              >
                <span className="font-mono text-[11.5px]" title={entry?.description || (catalog ? te.skillUnknown : undefined)}>
                  {sid}
                </span>
              </Tag>
            );
          })
        )}
      </div>
      {error && <p className="text-[12px] font-medium text-[var(--red-text)]">{error}</p>}

      <div className="ui-panel ui-panel--sunken flex min-w-0 flex-col overflow-hidden">
        <div className="border-b-2 border-line bg-panel p-2">
          <label htmlFor={`${id}-q`} className="sr-only">
            {te.skillsSearch}
          </label>
          <Input
            id={`${id}-q`}
            size="sm"
            icon={<IconSearch size={13} />}
            placeholder={te.skillsSearch}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ul className="max-h-[15rem] overflow-y-auto px-2 py-1.5" aria-label={te.skills}>
          {catalogError ? (
            <li className="px-1 py-2 text-[12px] font-medium text-[var(--red-text)]">{te.skillsLoadError}</li>
          ) : catalog === null ? (
            <li className="px-1 py-2 font-mono text-[11.5px] text-ink-3">{te.skillsLoading}</li>
          ) : visible.length === 0 ? (
            <li className="px-1 py-2 text-[12px] text-ink-3">{te.skillsEmpty}</li>
          ) : (
            visible.map((s) => {
              const checked = value.includes(s.id);
              return (
                <li key={s.id} className="border-b-[1.5px] border-hair py-1.5 last:border-b-0">
                  <Checkbox
                    className="w-full"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                    label={
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-mono text-[12px] font-semibold">{s.id}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] font-normal text-ink-3">
                          <span aria-hidden className="ui-dot !h-1.5 !w-1.5 !border" style={{ "--dot": SOURCE_DOT[s.source] } as CSSProperties} />
                          {sourceLabel(s.source, te)}
                        </span>
                      </span>
                    }
                    hint={s.description ? <span className="line-clamp-1">{s.description}</span> : undefined}
                  />
                </li>
              );
            })
          )}
          {filtered.length > VISIBLE_LIMIT && (
            <li className="px-1 py-2 font-mono text-[11px] text-ink-3">
              {te.skillsMore.replace("{n}", String(filtered.length - VISIBLE_LIMIT))}
            </li>
          )}
        </ul>
      </div>
      {full && <p className="text-[12px] text-ink-3">{te.validation.skills_max}</p>}
    </fieldset>
  );
}

function ReadOnlyRole({
  role,
  advisorEnabled,
  catalog,
}: {
  role: TeamRole;
  advisorEnabled: boolean;
  catalog: SkillCatalogEntry[] | null;
}) {
  const te = useTranslation().team.editor;
  const byId = new Map((catalog ?? []).map((s) => [s.id, s]));
  const row = "grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2 border-b-[1.5px] border-hair last:border-b-0";
  const key = "t-label !text-[10px] pt-1";
  return (
    <dl className="flex flex-col">
      <div className={row}>
        <dt className={key}>{te.model}</dt>
        <dd className="font-mono text-[12.5px] font-semibold text-ink">{role.model}</dd>
      </div>
      {advisorEnabled && (
        <div className={row}>
          <dt className={key}>{te.advisor}</dt>
          <dd className="font-mono text-[12.5px] text-ink">{role.advisorModel ?? te.advisorNone}</dd>
        </div>
      )}
      <div className={row}>
        <dt className={key}>{te.tools}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {role.tools.map((tool) => (
            <Tag key={tool}>
              <span className="font-mono text-[11.5px]">{tool}</span>
            </Tag>
          ))}
        </dd>
      </div>
      <div className={row}>
        <dt className={key}>{te.skills}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {role.skills.length === 0 ? (
            <span className="text-[12.5px] text-ink-3">{te.skillsNone}</span>
          ) : (
            role.skills.map((sid) => (
              <Tag key={sid} dot={byId.has(sid) ? SOURCE_DOT[byId.get(sid)!.source] : undefined}>
                <span className="font-mono text-[11.5px]">{sid}</span>
              </Tag>
            ))
          )}
        </dd>
      </div>
      <div className="flex flex-col gap-1.5 pt-2.5">
        <dt className="t-label !text-[10px]">{te.instructions}</dt>
        <dd>
          {role.instructions.trim() ? (
            <pre className="max-h-[18rem] overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border-2 border-line bg-sunken px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink">
              {role.instructions}
            </pre>
          ) : (
            <p className="ui-hatch rounded-[10px] border-2 border-dashed border-hair px-3 py-2.5 text-[12px] text-ink-3">{te.noInstructions}</p>
          )}
        </dd>
      </div>
    </dl>
  );
}
