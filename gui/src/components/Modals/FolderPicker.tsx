"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { SectionPill } from "@/components/ui/Pills";
import { useEscapeLayer } from "@/components/ui/overlay";
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconChevronUp,
  IconEye,
  IconFolder,
  IconHome,
  IconPlus,
  IconSpinner,
} from "@/components/ui/icons";
import { ApiError, api, type DirListing } from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";

interface FolderPickerProps {
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

type ErrorKind = "notFound" | "forbidden" | "invalid" | "exists" | "name" | "generic";

const PAGE_STEP = 8;

function errorKind(err: unknown): ErrorKind {
  if (!(err instanceof ApiError)) return "generic";
  const code = (err.body as { error?: string } | null)?.error;
  if (code === "not_found") return "notFound";
  if (code === "permission_denied") return "forbidden";
  if (code === "invalid_path" || code === "not_a_directory") return "invalid";
  if (code === "already_exists") return "exists";
  if (code === "invalid_name") return "name";
  return "generic";
}

function parentOf(p: string): string | undefined {
  if (p === "/") return undefined;
  const cut = p.replace(/\/+$/, "").lastIndexOf("/");
  return cut <= 0 ? "/" : p.slice(0, cut);
}

function crumbsOf(p: string) {
  const parts = p.split("/").filter(Boolean);
  return [
    { label: "/", path: "/" },
    ...parts.map((label, i) => ({ label, path: `/${parts.slice(0, i + 1).join("/")}` })),
  ];
}

function isValidFolderName(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
}

export function FolderPicker({ open, initialPath, onClose, onSelect }: FolderPickerProps) {
  const t = useTranslation();
  const tf = t.folderPicker;
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const crumbRef = useRef<HTMLOListElement>(null);
  const requestRef = useRef(0);

  const [listing, setListing] = useState<DirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: ErrorKind; path: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<ErrorKind | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const typeahead = useRef({ text: "", at: 0 });

  const load = useCallback(
    async (target: string | undefined, hidden: boolean, opts: { select?: string; fallback?: boolean } = {}) => {
      const id = ++requestRef.current;
      setLoading(true);
      setError(null);
      let attempt = target;
      for (;;) {
        try {
          const data = await api.browseDirs(attempt, hidden);
          if (id !== requestRef.current) return;
          setListing(data);
          setSelected(opts.select && data.entries.some((e) => e.path === opts.select) ? opts.select : null);
          setLoading(false);
          return;
        } catch (err) {
          if (id !== requestRef.current) return;
          if (opts.fallback && attempt !== undefined) {
            attempt = parentOf(attempt);
            continue;
          }
          setError({ kind: errorKind(err), path: attempt ?? "~" });
          setSelected(null);
          setLoading(false);
          return;
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    setListing(null);
    setSelected(null);
    setShowHidden(false);
    setCreating(false);
    setNewName("");
    setCreateError(null);
    const start = initialPath?.trim();
    void load(start && start.startsWith("/") ? start : undefined, false, { fallback: true });
  }, [open, initialPath, load]);

  useEffect(() => {
    if (crumbRef.current) crumbRef.current.scrollLeft = crumbRef.current.scrollWidth;
  }, [listing?.path]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const cancelCreate = useCallback(() => {
    setCreating(false);
    setNewName("");
    setCreateError(null);
    listRef.current?.focus();
  }, []);
  useEscapeLayer(open && creating, cancelCreate);

  const entries = listing?.entries ?? [];
  const selectedIndex = entries.findIndex((e) => e.path === selected);
  const chosenPath = selected ?? listing?.path ?? "";

  const navigate = (target: string | undefined, select?: string) => {
    setCreating(false);
    setCreateError(null);
    void load(target, showHidden, { select });
  };

  const goUp = () => {
    if (listing?.parent) navigate(listing.parent, listing.path);
  };

  const toggleHidden = (next: boolean) => {
    setShowHidden(next);
    void load(listing?.path, next, { select: selected ?? undefined });
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!listing || createBusy) return;
    if (!isValidFolderName(name)) {
      setCreateError("name");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const entry = await api.makeDir(listing.path, name);
      setCreating(false);
      setNewName("");
      await load(listing.path, showHidden || name.startsWith("."), { select: entry.path });
      if (name.startsWith(".")) setShowHidden(true);
      listRef.current?.focus();
    } catch (err) {
      setCreateError(errorKind(err));
    } finally {
      setCreateBusy(false);
    }
  };

  const moveTo = (index: number) => {
    if (entries.length === 0) return;
    const clamped = Math.max(0, Math.min(entries.length - 1, index));
    setSelected(entries[clamped].path);
  };

  const jumpByLetter = (key: string) => {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.at < 700 ? state.text + key.toLocaleLowerCase() : key.toLocaleLowerCase();
    state.at = now;
    const start = state.text.length > 1 ? Math.max(selectedIndex, 0) : selectedIndex + 1;
    const ordered = [...entries.slice(start), ...entries.slice(0, start)];
    const hit = ordered.find((e) => e.name.toLocaleLowerCase().startsWith(state.text));
    if (hit) setSelected(hit.path);
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const current = selectedIndex >= 0 ? entries[selectedIndex] : null;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        moveTo(selectedIndex < 0 ? 0 : selectedIndex + 1);
        break;
      case "ArrowUp":
        moveTo(selectedIndex < 0 ? entries.length - 1 : selectedIndex - 1);
        break;
      case "PageDown":
        moveTo(selectedIndex + PAGE_STEP);
        break;
      case "PageUp":
        moveTo(selectedIndex - PAGE_STEP);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(entries.length - 1);
        break;
      case "Enter":
      case "ArrowRight":
        if (current) navigate(current.path);
        break;
      case "Backspace":
      case "ArrowLeft":
        goUp();
        break;
      default:
        if (e.key.length === 1 && e.key !== " ") jumpByLetter(e.key);
        else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const errorText = (kind: ErrorKind) =>
    ({
      notFound: tf.errorNotFound,
      forbidden: tf.errorForbidden,
      invalid: tf.errorInvalid,
      exists: tf.errorExists,
      name: tf.errorName,
      generic: tf.errorGeneric,
    })[kind];

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tf.title}
      description={tf.hint}
      icon={<IconFolder size={18} />}
      footerStart={
        chosenPath ? (
          <span dir="rtl" className="block truncate text-left font-mono text-[12.5px] text-ink" title={chosenPath}>
            <bdi dir="ltr">{chosenPath}</bdi>
          </span>
        ) : null
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tf.cancel}
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck size={15} />}
            disabled={!chosenPath || loading}
            onClick={() => chosenPath && onSelect(chosenPath)}
          >
            {tf.choose}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <IconButton label={tf.up} onClick={goUp} disabled={!listing?.parent || loading}>
            <IconChevronUp size={16} />
          </IconButton>
          <IconButton
            label={tf.home}
            onClick={() => navigate(listing?.home)}
            disabled={loading || (!!listing && listing.path === listing.home)}
          >
            <IconHome size={16} />
          </IconButton>
          <nav
            aria-label={tf.pathLabel}
            className="flex h-10 min-w-0 flex-1 items-center rounded-[var(--r-btn)] border-2 border-line bg-sunken px-1.5"
          >
            <ol
              ref={crumbRef}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]"
            >
              {listing &&
                crumbsOf(listing.path).map((c, i, all) => {
                  const last = i === all.length - 1;
                  return (
                    <Fragment key={c.path}>
                      {i > 1 && (
                        <li aria-hidden className="flex-none text-ink-3">
                          <IconChevronRight size={11} />
                        </li>
                      )}
                      <li className="flex-none">
                        <button
                          type="button"
                          aria-current={last ? "location" : undefined}
                          onClick={() => !last && navigate(c.path, all[i + 1]?.path)}
                          className={clsx(
                            "ui-focus rounded-[6px] px-1.5 py-0.5 font-mono text-[12.5px] transition-colors",
                            last ? "cursor-default font-semibold text-ink" : "text-ink-3 hover:bg-hair hover:text-ink",
                          )}
                        >
                          {c.label}
                        </button>
                      </li>
                    </Fragment>
                  );
                })}
            </ol>
          </nav>
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={tf.listLabel}
          aria-busy={loading || undefined}
          aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
          tabIndex={0}
          data-autofocus
          onKeyDown={onListKeyDown}
          className="ui-focus relative h-[19rem] overflow-y-auto rounded-[var(--r-btn)] border-2 border-line bg-sunken p-1.5 shadow-[inset_2px_2px_0_color-mix(in_srgb,var(--ink)_9%,transparent)]"
        >
          {loading && !listing ? (
            <div className="grid h-full place-items-center">
              <span className="flex items-center gap-2 text-[13px] text-ink-3">
                <IconSpinner size={15} />
                {tf.loading}
              </span>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col justify-center gap-3 p-3">
              <div role="alert" className="ui-banner ui-banner--error">
                <IconAlert size={15} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  {errorText(error.kind)}
                  <span className="mt-0.5 block truncate font-mono text-[12px]">{error.path}</span>
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void load(error.path === "~" ? undefined : error.path, showHidden)}>
                  {tf.retry}
                </Button>
                <Button size="sm" variant="ghost" icon={<IconHome size={14} />} onClick={() => navigate(undefined)}>
                  {tf.goHome}
                </Button>
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span
                aria-hidden
                className="grid h-10 w-10 place-items-center rounded-[10px] border-2 border-line bg-panel text-ink-3"
              >
                <IconFolder size={18} />
              </span>
              <p className="text-[13.5px] font-semibold text-ink">{tf.empty}</p>
              <p className="text-[12px] text-ink-3">{tf.emptyHint}</p>
            </div>
          ) : (
            <div className={clsx("flex flex-col gap-0.5 transition-opacity", loading && "opacity-50")}>
              {entries.map((entry, i) => (
                <div
                  key={entry.path}
                  id={optionId(i)}
                  role="option"
                  aria-selected={entry.path === selected}
                  title={entry.path}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => navigate(entry.path)}
                  className="ui-menu__item select-none aria-selected:bg-[color-mix(in_srgb,var(--mustard)_30%,var(--panel))] aria-selected:shadow-[inset_0_0_0_2px_var(--line)]"
                >
                  <IconFolder size={15} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{entry.name}</span>
                  {entry.isGitRepo && (
                    <span title={tf.gitRepo} className="flex-none">
                      <SectionPill tone="cobalt" size="sm" className="!h-5 !px-2 font-mono !text-[10.5px]">
                        git
                      </SectionPill>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {creating ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  size="sm"
                  autoFocus
                  aria-label={tf.newFolder}
                  icon={<IconFolder size={13} />}
                  value={newName}
                  invalid={!!createError}
                  placeholder={tf.newFolderPlaceholder}
                  className="font-mono"
                  disabled={createBusy}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setCreateError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      void submitCreate();
                    }
                  }}
                />
              </div>
              <Button
                size="sm"
                variant="primary"
                icon={<IconCheck size={14} />}
                loading={createBusy}
                disabled={!newName.trim()}
                onClick={() => void submitCreate()}
              >
                {tf.create}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelCreate} disabled={createBusy}>
                {tf.cancelCreate}
              </Button>
            </div>
            {createError && (
              <p role="alert" className="text-xs font-medium text-[var(--red-text)]">
                {errorText(createError)}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              icon={<IconPlus size={14} />}
              disabled={!listing || loading || !!error}
              onClick={() => setCreating(true)}
            >
              {tf.newFolder}
            </Button>
            <span className="min-w-0 flex-1 truncate text-center font-mono text-[11px] text-ink-3">{tf.keyHint}</span>
            <Chip
              selected={showHidden}
              onSelectedChange={toggleHidden}
              icon={<IconEye size={13} />}
              title={tf.showHiddenLabel}
              aria-label={tf.showHiddenLabel}
            >
              {tf.showHidden}
            </Chip>
          </div>
        )}
      </div>
    </Modal>
  );
}
