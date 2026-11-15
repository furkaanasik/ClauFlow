"use client";

import clsx from "clsx";
import { Fragment } from "react";
import { IconChevronRight, IconRetry } from "@/components/ui/icons";
import { useTranslation } from "@/hooks/useTranslation";
import type { RoleKind, TeamRole } from "@/types";
import { ROLE_TONE, roleIcon, roleLabel } from "./roleMeta";

/** Small ink-rimmed role plate: coloured square with the role glyph. */
export function RolePlate({ kind, size = "sm", className }: { kind: RoleKind; size?: "sm" | "md"; className?: string }) {
  const tone = ROLE_TONE[kind];
  const px = size === "md" ? "h-8 w-8 rounded-[9px] border-2" : "h-5 w-5 rounded-[6px] border-[1.5px]";
  return (
    <span
      aria-hidden
      className={clsx("inline-grid shrink-0 place-items-center border-line", px, className)}
      style={{ background: tone.fill, color: tone.on, boxShadow: size === "md" ? "2px 2px 0 var(--shadow-ink)" : undefined }}
    >
      {roleIcon(kind, size === "md" ? 15 : 11)}
    </span>
  );
}

/**
 * "CEO › Analist › Yazılımcı ⇄ QA": the team's role order. The QA → Developer
 * feedback loop is drawn as a retry glyph between the two.
 */
export function RoleChain({ roles, className }: { roles: TeamRole[]; className?: string }) {
  const t = useTranslation();
  return (
    <ol aria-label={t.team.picker.chainLabel} className={clsx("flex flex-wrap items-center gap-x-1 gap-y-1.5", className)}>
      {roles.map((role, i) => {
        const prev = roles[i - 1];
        const loop = role.kind === "qa" && prev?.kind === "developer";
        return (
          <Fragment key={role.id}>
            {i > 0 && (
              <li aria-hidden className="flex text-ink-3">
                {loop ? <IconRetry size={11} /> : <IconChevronRight size={11} />}
              </li>
            )}
            <li className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2">
              <RolePlate kind={role.kind} />
              {roleLabel(role, role.kind, t)}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
