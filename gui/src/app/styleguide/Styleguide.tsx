"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { TaskCardView } from "@/components/Card/TaskCard";
import { AttachmentInput, useStagedImages } from "@/components/Attachments/AttachmentInput";
import { AttachmentGrid, type GridImage } from "@/components/Attachments/AttachmentGrid";
import { ATTACHMENT_MAX_PER_TASK } from "@/lib/attachments";
import { useBoardStore } from "@/store/boardStore";
import type { Task } from "@/types";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import {
  Avatar,
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  DotMeter,
  Drawer,
  Field,
  IconAlert,
  IconBoard,
  IconBolt,
  IconBranch,
  IconButton,
  IconChart,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconClose,
  IconCoin,
  IconEye,
  IconFactory,
  IconGear,
  IconList,
  IconMoon,
  IconPlay,
  IconPlus,
  IconPR,
  IconRetry,
  IconRobot,
  IconSearch,
  IconSun,
  IconTrash,
  Input,
  Kbd,
  Modal,
  Panel,
  PriorityMark,
  RingGauge,
  SectionPill,
  Segmented,
  Select,
  StatusPill,
  Tabs,
  Tag,
  Textarea,
  Tile,
  ToastContainer,
  Tooltip,
} from "@/components/ui";

export type StyleguideMode = "split" | "cream" | "night";
type ThemeName = "cream" | "night";

/* Token hexes for the swatch table (mirrors globals.css). */
const PALETTE: Record<ThemeName, Record<string, string>> = {
  cream: {
    paper: "#F4ECDA", panel: "#FBF6EA", sunken: "#EADFC6", ink: "#1B1712", "ink-2": "#4A4237",
    "ink-3": "#6B6152", mustard: "#F2C33D", cobalt: "#2D5BE3", orange: "#EE7B2C", red: "#C8372D", green: "#3E9B5A",
  },
  night: {
    paper: "#17140F", panel: "#221E17", sunken: "#100E0A", ink: "#F4ECDA", "ink-2": "#CFC4AE",
    "ink-3": "#9D937F", mustard: "#F2C33D", cobalt: "#5B82F0", orange: "#F08A42", red: "#E2574C", green: "#5BB877",
  },
};
/* What sits on each swatch (ink for light fills, paper for dark). */
const ON: Record<ThemeName, Record<string, string>> = {
  cream: { ink: "#F4ECDA", "ink-2": "#F4ECDA", "ink-3": "#F4ECDA", cobalt: "#FBF6EA", red: "#FBF6EA" },
  night: { paper: "#F4ECDA", panel: "#F4ECDA", sunken: "#F4ECDA" },
};

function lum(hex: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ─── Page shell ──────────────────────────────────────────────────────────── */

export function Styleguide({ initialMode }: { initialMode: StyleguideMode }) {
  const t = useTranslation();
  const lang = useBoardStore((s) => s.lang);
  const setLang = useBoardStore((s) => s.setLang);
  const { isNight, toggleTheme } = useTheme();
  const [mode, setMode] = useState<StyleguideMode>(initialMode);

  const columns: ThemeName[] = mode === "split" ? ["cream", "night"] : [mode];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b-2 border-line bg-panel">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-4 px-6 py-3.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-[10px] border-2 border-line bg-mustard font-mono text-[13px] font-bold text-[var(--on-mustard)] shadow-hard"
          >
            cf
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="t-display text-[22px]">{t.styleguide.title}</h1>
            <p className="text-[13px] text-ink-3">{t.styleguide.subtitle}</p>
          </div>
          <Segmented
            label={t.styleguide.viewLabel}
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "split", label: t.styleguide.modeSplit },
              { value: "cream", label: t.styleguide.modeCream, icon: <IconSun size={13} /> },
              { value: "night", label: t.styleguide.modeNight, icon: <IconMoon size={13} /> },
            ]}
          />
          <Button size="sm" onClick={() => setLang(lang === "tr" ? "en" : "tr")}>
            {lang.toUpperCase()}
          </Button>
          <IconButton
            size="sm"
            label={isNight ? t.header.themeToLight : t.header.themeToDark}
            onClick={toggleTheme}
          >
            {isNight ? <IconSun size={15} /> : <IconMoon size={15} />}
          </IconButton>
        </div>
      </header>

      <div
        className={clsx(
          "mx-auto grid max-w-[1680px]",
          columns.length === 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1",
        )}
      >
        {columns.map((theme, i) => (
          <div
            key={theme}
            className={clsx(
              theme === "cream" ? "theme-cream" : "theme-night",
              "min-w-0 px-6 pb-16 pt-6",
              i > 0 && "xl:border-l-2 xl:border-line",
            )}
          >
            <div className="mb-6 flex items-center gap-3">
              <SectionPill tone="ink" icon={theme === "cream" ? <IconSun size={13} /> : <IconMoon size={13} />}>
                {theme === "cream" ? t.styleguide.cream : t.styleguide.night}
              </SectionPill>
              <span className="h-[2px] flex-1 bg-hair" />
              <span className="font-mono text-[11px] text-ink-3">
                {theme === "cream" ? ":root" : "html.night"}
              </span>
            </div>
            <Gallery theme={theme} wide={columns.length === 1} />
          </div>
        ))}
      </div>
      <ToastContainer />
    </main>
  );
}

/* ─── Section frame ───────────────────────────────────────────────────────── */

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-3">
        <SectionPill size="sm">{title}</SectionPill>
        <span className="font-mono text-[11px] text-ink-3">{String(n).padStart(2, "0")}</span>
        <span className="h-[2px] flex-1 bg-hair" />
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {label && <span className="t-label w-20 shrink-0">{label}</span>}
      {children}
    </div>
  );
}

/* ─── Gallery ─────────────────────────────────────────────────────────────── */

function Gallery({ theme, wide }: { theme: ThemeName; wide: boolean }) {
  const t = useTranslation();
  const toast = useToast();

  const [filters, setFilters] = useState<Record<string, boolean>>({ high: true, agent: false, pr: false, frontend: false });
  const [dir, setDir] = useState<"out" | "in">("out");
  const [view, setView] = useState<"board" | "list" | "factory">("board");
  const [tab, setTab] = useState<"detail" | "log" | "flow" | "comments">("detail");
  const [labels, setLabels] = useState(["backend", "security", "api"]);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);

  const pal = PALETTE[theme];
  let n = 0;

  return (
    <div>
      {/* 01 colours */}
      <Section n={++n} title={t.styleguide.colors}>
        <div className={clsx("grid gap-3", wide ? "grid-cols-6" : "grid-cols-3 sm:grid-cols-4")}>
          {Object.entries(pal).map(([name, hex]) => {
            const on = ON[theme][name] ?? "#1B1712";
            const ratio = contrast(hex, on);
            return (
              <div key={name} className="overflow-hidden rounded-[12px] border-2 border-line bg-panel shadow-hard">
                <div
                  className="flex h-14 items-end justify-between border-b-2 border-line px-2.5 pb-1.5"
                  style={{ background: `var(--${name})`, color: on }}
                >
                  <span className="text-[15px] font-bold">Aa</span>
                  <span className="font-mono text-[10px] font-semibold">{ratio.toFixed(1)}:1</span>
                </div>
                <div className="px-2.5 py-1.5">
                  <div className="font-mono text-[11.5px] font-semibold">--{name}</div>
                  <div className="font-mono text-[10.5px] text-ink-3">{hex}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 02 type */}
      <Section n={++n} title={t.styleguide.type}>
        <Panel padding="md">
          <div className="t-display text-[44px]">Atölye — agents at work.</div>
          <div className="t-h1 mt-3">Paginate task history endpoint</div>
          <div className="t-h2 mt-1">Review the plan before the agent runs</div>
          <p className="t-body mt-2 max-w-[60ch] text-ink-2">
            Jost carries the interface: geometric, friendly, sturdy at 600–800 for headings. Body copy sits at
            14px / 1.55 on cream paper with ink at 15:1.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-[13px]">
            <span className="font-semibold">CLF-87</span>
            <span className="text-ink-2">$0.42 · 12 841 tok</span>
            <span className="text-ink-3">12:04:33 pushing → pr_opening</span>
          </div>
          <div className="t-label mt-3">Mono label · tracked caps</div>
        </Panel>
      </Section>

      {/* 03 buttons */}
      <Section n={++n} title={t.styleguide.buttons}>
        {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
          <Row key={v} label={v}>
            <Button variant={v} size="sm">Small</Button>
            <Button variant={v}>Medium</Button>
            <Button variant={v} size="lg">Large</Button>
          </Row>
        ))}
        <Row label="icon">
          <Button variant="primary" icon={<IconPlus size={16} />}>New task</Button>
          <Button icon={<IconPlay size={14} />}>Run agent</Button>
          <Button iconRight={<IconChevronDown size={14} />}>Priority</Button>
          <Button variant="danger" icon={<IconTrash size={15} />}>Delete</Button>
        </Row>
        <Row label="state">
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              setBusy(true);
              window.setTimeout(() => setBusy(false), 1600);
            }}
          >
            {busy ? "Opening PR…" : "Open PR"}
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </Row>
        <Row label="square">
          <IconButton label="Close" size="sm"><IconClose size={13} /></IconButton>
          <IconButton label="Retry"><IconRetry /></IconButton>
          <IconButton label="Add" variant="primary"><IconPlus /></IconButton>
          <IconButton label="Settings" variant="ghost"><IconGear /></IconButton>
          <IconButton label="Delete" variant="danger"><IconTrash /></IconButton>
          <IconButton label="Close" size="lg"><IconClose size={18} /></IconButton>
          <IconButton label="Working" loading><IconPlay /></IconButton>
        </Row>
      </Section>

      {/* 04 pills */}
      <Section n={++n} title={t.styleguide.pills}>
        <Row label="section">
          <SectionPill>Upgrades</SectionPill>
          <SectionPill icon={<IconBolt size={13} />} count={3}>Agents</SectionPill>
          <SectionPill tone="ink">Backlog</SectionPill>
          <SectionPill tone="mustard" size="sm">New</SectionPill>
        </Row>
        <Row label="status">
          <StatusPill status="todo">Todo</StatusPill>
          <StatusPill status="doing" live>Running</StatusPill>
          <StatusPill status="review">Waiting for review</StatusPill>
          <StatusPill status="done">Merged</StatusPill>
          <StatusPill status="nothing">Offline</StatusPill>
          <StatusPill status="error">Failed</StatusPill>
        </Row>
        <Row label="solid">
          <StatusPill status="doing" variant="solid" live>branching</StatusPill>
          <StatusPill status="review" variant="solid">review</StatusPill>
          <StatusPill status="done" variant="solid" icon={<IconCheck size={12} />}>done</StatusPill>
          <StatusPill status="error" variant="solid" icon={<IconAlert size={12} />}>error</StatusPill>
          <StatusPill status="doing" size="md" icon={<IconBranch size={13} />}>pushing → pr_opening</StatusPill>
        </Row>
        <Row label="priority">
          <PriorityMark level="low" showLabel />
          <PriorityMark level="medium" showLabel />
          <PriorityMark level="high" showLabel />
          <PriorityMark level="critical" showLabel />
        </Row>
      </Section>

      {/* 05 chips */}
      <Section n={++n} title={t.styleguide.chips}>
        <Row label="filter">
          <Chip selected={filters.high} onSelectedChange={(v) => setFilters({ ...filters, high: v })} dot="var(--orange)" count={3}>
            High priority
          </Chip>
          <Chip selected={filters.agent} onSelectedChange={(v) => setFilters({ ...filters, agent: v })} icon={<IconRobot size={13} />}>
            Agent running
          </Chip>
          <Chip selected={filters.pr} onSelectedChange={(v) => setFilters({ ...filters, pr: v })} icon={<IconPR size={13} />} count={2}>
            PR open
          </Chip>
          <Chip selected={filters.frontend} onSelectedChange={(v) => setFilters({ ...filters, frontend: v })} dot="var(--cobalt)">
            frontend
          </Chip>
          <Chip disabled>disabled</Chip>
        </Row>
        <Row label="tags">
          {labels.map((l, i) => (
            <Tag
              key={l}
              dot={["var(--red)", "var(--orange)", "var(--cobalt)"][i % 3]}
              removeLabel={`${t.common.remove} ${l}`}
              onRemove={() => setLabels(labels.filter((x) => x !== l))}
            >
              {l}
            </Tag>
          ))}
          <Tag>tests</Tag>
          {labels.length < 3 && (
            <Button size="sm" variant="ghost" onClick={() => setLabels(["backend", "security", "api"])}>
              reset
            </Button>
          )}
        </Row>
      </Section>

      {/* 06 segmented */}
      <Section n={++n} title={t.styleguide.segmented}>
        <Row>
          <Segmented
            label="Direction"
            value={dir}
            onChange={setDir}
            options={[
              { value: "out", label: "Outgoing", count: 1 },
              { value: "in", label: "Incoming", count: 2 },
            ]}
          />
          <Segmented
            label="View"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: "Board", icon: <IconBoard size={13} /> },
              { value: "list", label: "List", icon: <IconList size={13} /> },
              { value: "factory", label: "Factory", icon: <IconFactory size={13} /> },
            ]}
          />
        </Row>
      </Section>

      {/* 07 panels */}
      <Section n={++n} title={t.styleguide.panels}>
        <div className={clsx("grid gap-4", wide ? "grid-cols-4" : "grid-cols-2")}>
          <Tile label="Total" value="12" icon={<IconBoard size={14} />} hint="+3 this week" />
          <Tile
            label="Done"
            value="2"
            icon={<IconCheck size={14} />}
            meter={<DotMeter value={2} max={5} size="sm" color="var(--green)" label="Done" />}
            accent="var(--green)"
          />
          <Tile label="Agent spend" value="$4.18" icon={<IconCoin size={14} />} hint="of $10.00 budget" accent="var(--mustard)" />
          <Tile label="Avg. cycle" value="38m" icon={<IconClock size={14} />} hint="todo → review" />
        </div>
        <div className={clsx("mt-4 grid gap-4", wide ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
          <Panel
            title="Agent budget"
            icon={<IconBolt size={15} />}
            meter={<DotMeter value={3} max={5} label="Budget used" />}
          >
            <p className="text-[13px] text-ink-2">
              3 of 5 runs used. The meter in the corner reads at a glance; the ring below gives the exact share.
            </p>
          </Panel>
          <Panel interactive padding="none" className="overflow-hidden" style={{ boxShadow: "inset 5px 0 0 var(--orange), var(--shadow)" }}>
            <div className="p-3.5 pl-5">
              <div className="flex items-center gap-2">
                <PriorityMark level="high" />
                <span className="font-mono text-[11.5px] font-semibold text-ink-2">CLF-6</span>
                <span className="flex-1" />
                <Avatar name="Claude" kind="agent" size="xs" state="running" />
              </div>
              <div className="mt-1.5 text-[15px] font-bold leading-snug">Paginate task history endpoint</div>
              <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">
                GET /api/tasks/:id/history returns everything at once. Add cursor pagination.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Tag>backend</Tag>
                <Tag>api</Tag>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-ink-3">$0.42</span>
              </div>
              <div className="mt-2.5">
                <StatusPill status="doing" live>running</StatusPill>
              </div>
            </div>
          </Panel>
          <Panel tone="sunken" padding="md" className="ui-hatch grid min-h-[140px] place-items-center">
            <div className="text-center">
              <div className="text-[13px] font-semibold text-ink-2">Empty slot</div>
              <div className="font-mono text-[11px] text-ink-3">drop a card here</div>
            </div>
          </Panel>
        </div>
      </Section>

      {/* 08 meters */}
      <Section n={++n} title={t.styleguide.meters}>
        <Row label="dots">
          <DotMeter value={1} size="sm" label="1 of 5" />
          <DotMeter value={3} label="3 of 5" color="var(--cobalt)" />
          <DotMeter value={4} size="lg" label="4 of 5" color="var(--orange)" />
          <DotMeter value={5} max={8} label="5 of 8" color="var(--green)" />
        </Row>
        <div className="flex flex-wrap items-start gap-8 pt-2">
          <RingGauge value={17} label="Progress" sublabel="2 / 12 done" ariaLabel="Progress" />
          <RingGauge value={4} max={6} color="var(--cobalt)" label="Throughput" sublabel="4 / min" ariaLabel="Throughput">
            <IconBolt size={22} />
          </RingGauge>
          <RingGauge value={72} color="var(--orange)" label="Budget" sublabel="$7.20 / $10" ariaLabel="Budget" />
          <RingGauge value={100} color="var(--green)" size={72} thickness={8} label="Merged" sublabel="12 / 12" ariaLabel="Merged">
            <IconCheck size={20} />
          </RingGauge>
        </div>
      </Section>

      {/* 09 tabs */}
      <Section n={++n} title={t.styleguide.tabs}>
        <Panel padding="none" className="overflow-hidden">
          <div className="pt-2">
            <Tabs
              label="Task"
              value={tab}
              onChange={setTab}
              items={[
                { value: "detail", label: "Detail" },
                { value: "log", label: "Log", count: 128 },
                { value: "flow", label: "Flow" },
                { value: "comments", label: "Comments", count: 3 },
              ]}
              trailing={<StatusPill status="review">review</StatusPill>}
            />
          </div>
          <div className="p-4 text-[13px] text-ink-2">
            {tab === "detail" && "Parent, description, analysis, subtasks, execution mode, priority, branch / PR, budget."}
            {tab === "log" && <span className="font-mono">[12:04:31] branching clf-6-paginate-history…</span>}
            {tab === "flow" && "Tool-call timeline."}
            {tab === "comments" && "Review comments the agent applies on the branch."}
          </div>
        </Panel>
      </Section>

      {/* 10 inputs */}
      <Section n={++n} title={t.styleguide.inputs}>
        <div className={clsx("grid gap-4", wide ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
          <Field label="Search" hint="Press / anywhere">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} icon={<IconSearch size={14} />} placeholder="Search tasks…" />
            )}
          </Field>
          <Field label="Priority">
            {({ id }) => (
              <Select id={id} defaultValue="high">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            )}
          </Field>
          <Field label="Branch" error="Branch name can't contain spaces">
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} invalid={invalid} defaultValue="clf 6 paginate" />
            )}
          </Field>
          <Field label="Description" aside="0 / 2000" className={wide ? "col-span-2" : "sm:col-span-2"}>
            {({ id }) => <Textarea id={id} placeholder="What should the agent do?" rows={3} />}
          </Field>
          <Field label="Small">
            {({ id }) => <Input id={id} size="sm" placeholder="sm input" />}
          </Field>
        </div>
      </Section>

      {/* 11 keys & tooltips */}
      <Section n={++n} title={t.styleguide.keys}>
        <Row label="kbd">
          <span className="flex items-center gap-2 text-[13px] text-ink-2"><Kbd>N</Kbd> new task</span>
          <span className="flex items-center gap-2 text-[13px] text-ink-2"><Kbd>/</Kbd> search</span>
          <span className="flex items-center gap-2 text-[13px] text-ink-2"><Kbd>?</Kbd> shortcuts</span>
          <span className="flex items-center gap-2 text-[13px] text-ink-2"><Kbd>Esc</Kbd> close</span>
          <span className="flex items-center gap-1 text-[13px] text-ink-2"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </Row>
        <Row label="tooltip">
          <Tooltip content="New task" shortcut="N">
            <IconButton label="New task" variant="primary"><IconPlus /></IconButton>
          </Tooltip>
          <Tooltip content="Watch the agent" side="bottom">
            <IconButton label="Watch"><IconEye /></IconButton>
          </Tooltip>
          <Tooltip content="Statistics" side="right">
            <IconButton label="Statistics" variant="ghost"><IconChart /></IconButton>
          </Tooltip>
        </Row>
      </Section>

      {/* 12 avatars */}
      <Section n={++n} title={t.styleguide.avatars}>
        <Row label="agent">
          <Avatar name="Executor" kind="agent" size="xs" />
          <Avatar name="Executor" kind="agent" size="sm" state="running" />
          <Avatar name="Executor" kind="agent" state="online" />
          <Avatar name="Executor" kind="agent" size="lg" state="error" />
        </Row>
        <Row label="user">
          <Avatar name="Furkan Aşık" size="sm" />
          <Avatar name="furkaanasik" state="online" />
          <Avatar name="Ada Lovelace" />
          <Avatar name="grace.hopper" />
          <Avatar name="Linus" size="lg" />
        </Row>
      </Section>

      {/* 13 overlays */}
      <Section n={++n} title={t.styleguide.overlays}>
        <Row>
          <Button onClick={() => setModal(true)}>Modal</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>ConfirmDialog</Button>
          <Button variant="primary" onClick={() => setDrawer(true)}>Drawer</Button>
          <Button variant="ghost" onClick={() => toast.success("PR #42 opened")}>Toast ok</Button>
          <Button variant="ghost" onClick={() => toast.error("Push rejected by remote")}>Toast err</Button>
          <Button variant="ghost" onClick={() => toast.info("Agent queued behind CLF-4")}>Toast info</Button>
        </Row>
        <AttachmentDemo theme={theme} />
      </Section>

      {/* board cards — every live state the sandbox can't safely produce */}
      <Section n={++n} title={t.styleguide.cards}>
        <CardStates wide={wide} />
      </Section>

      {/* 14 legacy */}
      <Section n={++n} title={t.styleguide.legacy}>
        <Row label="Badge">
          {(["neutral", "blue", "yellow", "orange", "purple", "green", "red"] as const).map((tone) => (
            <Badge key={tone} tone={tone} pulse={tone === "orange"}>{tone}</Badge>
          ))}
        </Row>
      </Section>

      <Modal open={modal} onClose={() => setModal(false)} title="Rename project">
        <p className="text-[13.5px] text-ink-2">
          Pick a new display name. The slug and task keys stay the same.
        </p>
        <div className="mt-4 flex justify-end gap-2.5">
          <Button onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setModal(false)}>Rename</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm}
        variant="danger"
        title="Move back to Todo?"
        description="CLF-6 is in review. Moving it back discards nothing, but the open PR stays on GitHub."
        confirmLabel="Move anyway"
        cancelLabel="Keep in review"
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      />

      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        eyebrow={
          <>
            <span className="font-semibold text-ink-2">CLF-6</span>
            <StatusPill status="review">review</StatusPill>
          </>
        }
        title="Paginate task history endpoint"
        headerActions={<Button size="sm" icon={<IconRetry size={13} />}>Retry</Button>}
        tabs={
          <Tabs
            label="Task"
            value={tab}
            onChange={setTab}
            items={[
              { value: "detail", label: "Detail" },
              { value: "log", label: "Log", count: 128 },
              { value: "flow", label: "Flow" },
              { value: "comments", label: "Comments", count: 3 },
            ]}
          />
        }
        aside={
          <div className="flex flex-col gap-5">
            <div>
              <div className="t-label mb-2">Priority</div>
              <PriorityMark level="high" showLabel />
            </div>
            <div>
              <div className="t-label mb-2">Budget</div>
              <RingGauge value={72} color="var(--orange)" size={76} thickness={8} sublabel="$7.20 / $10" ariaLabel="Budget" />
            </div>
            <div>
              <div className="t-label mb-2">Runs</div>
              <DotMeter value={3} label="Runs" />
            </div>
          </div>
        }
        footer={
          <>
            <Button onClick={() => setDrawer(false)}>Close</Button>
            <Button variant="primary" icon={<IconPR size={14} />}>Open PR</Button>
          </>
        }
      >
        <Panel title="Description" padding="md">
          <p className="text-[13.5px] text-ink-2">
            GET /api/tasks/:id/history returns everything at once. Add cursor pagination and keep the response
            shape backwards compatible.
          </p>
        </Panel>
      </Drawer>
    </div>
  );
}

/* ─── Board card states ───────────────────────────────────────────────────── */

const NOW = "2026-11-15T09:00:00.000Z";
const USAGE = { inputTokens: 182_000, outputTokens: 24_500, cacheReadTokens: 410_000, cacheWriteTokens: 38_000 };
const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function mockTask(p: Partial<Task> & Pick<Task, "id" | "displayId" | "title" | "status">): Task {
  return {
    projectId: "styleguide",
    description: "",
    analysis: "",
    priority: "medium",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    usage: ZERO,
    agent: { status: "idle", log: [] },
    ...p,
  } as Task;
}

const CARD_STATES: Task[] = [
  mockTask({
    id: "sg-run",
    displayId: "CLF-87",
    title: "Stream agent logs into the task drawer",
    description: "Pipe agent_log events into a virtualised list with sticky tail.",
    status: "doing",
    priority: "high",
    tags: ["frontend", "ws"],
    usage: USAGE,
    agent: { status: "running", log: ["$ git checkout -b clf-87", "claude -p …", "editing src/components/LogView.tsx"] },
  }),
  mockTask({
    id: "sg-queued",
    displayId: "CLF-88",
    title: "Retry webhook delivery with backoff",
    status: "doing",
    priority: "medium",
    tags: ["backend"],
  }),
  mockTask({
    id: "sg-review",
    displayId: "CLF-79",
    title: "Paginate task history endpoint",
    description: "Cursor pagination with a stable sort on (updatedAt, id).",
    status: "review",
    priority: "critical",
    tags: ["backend", "api", "perf", "db"],
    prNumber: 38,
    usage: USAGE,
  }),
  mockTask({
    id: "sg-done",
    displayId: "CLF-71",
    title: "Set up ESLint + Prettier",
    status: "done",
    priority: "low",
    tags: ["tooling"],
    prNumber: 33,
    prUrl: "https://github.com/example/repo/pull/33",
    usage: { ...USAGE, outputTokens: 4_000, cacheReadTokens: 20_000 },
  }),
  mockTask({
    id: "sg-error",
    displayId: "CLF-90",
    title: "Migrate config loader to zod schemas",
    status: "doing",
    priority: "high",
    tags: ["refactor"],
    parentTaskId: "sg-parent",
    agent: { status: "error", log: ["error: tests failed"] },
  }),
];

function CardStates({ wide }: { wide: boolean }) {
  return (
    <DndContext>
      <div className={clsx("grid items-start gap-4", wide ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
        {CARD_STATES.map((task) => (
          <TaskCardView
            key={task.id}
            task={task}
            subtasks={task.id === "sg-review" ? { total: 3, done: 1 } : undefined}
            parentKey={task.parentTaskId ? "CLF-60" : undefined}
          />
        ))}
        <TaskCardView task={CARD_STATES[3]} overlay />
      </div>
    </DndContext>
  );
}

/* bakim #8: attachment input + grid + lightbox. Samples are drawn on a canvas
   from the theme tokens (no image files, no raw colours). */
function sampleImages(el: Element): GridImage[] {
  const css = getComputedStyle(el);
  const tok = (name: string) => css.getPropertyValue(name).trim() || "gray";
  const draw = (w: number, h: number, bg: string, fg: string, label: string) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) return "";
    g.fillStyle = tok("--paper");
    g.fillRect(0, 0, w, h);
    g.fillStyle = tok("--shadow-ink");
    g.fillRect(w * 0.3 + 6, h * 0.38 + 6, w * 0.4, h * 0.24);
    g.fillStyle = tok(bg);
    g.strokeStyle = tok("--line");
    g.lineWidth = 4;
    g.fillRect(w * 0.3, h * 0.38, w * 0.4, h * 0.24);
    g.strokeRect(w * 0.3, h * 0.38, w * 0.4, h * 0.24);
    g.fillStyle = tok(fg);
    g.font = `bold ${Math.round(h * 0.09)}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, w / 2, h / 2);
    return c.toDataURL("image/png");
  };
  return [
    { key: "sg-1", src: draw(640, 360, "--mustard", "--on-mustard", "Kaydet"), name: "buton.png", meta: "640×360 · 18 KB" },
    { key: "sg-2", src: draw(480, 320, "--cobalt", "--on-cobalt", "Save"), name: "button-blue.png", meta: "480×320 · 12 KB" },
    { key: "sg-3", src: draw(320, 320, "--red", "--on-red", "Delete"), name: "danger.png", meta: "320×320 · 9 KB" },
  ];
}

function AttachmentDemo({ theme }: { theme: ThemeName }) {
  const staged = useStagedImages();
  const ref = useRef<HTMLDivElement>(null);
  const [samples, setSamples] = useState<GridImage[]>([]);
  useEffect(() => {
    // tokens of this gallery's theme scope (the page shows cream and night side by side)
    if (ref.current) setSamples(sampleImages(ref.current));
  }, [theme]);
  return (
    <div ref={ref}>
      <Row label="Images">
        <AttachmentGrid images={samples} onDelete={() => undefined} />
      </Row>
      <Row label="Attach">
        <AttachmentInput
          remaining={ATTACHMENT_MAX_PER_TASK - samples.length - staged.items.length}
          onAdd={staged.add}
          staged={staged.items}
          onRemoveStaged={staged.remove}
          showCostHint
          className="w-full max-w-xl"
        />
      </Row>
    </div>
  );
}
