"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/Pills";
import { IconAlert, IconArrowUpRight, IconCheck, IconCopy, IconGithub, IconRetry, IconSpinner } from "@/components/ui/icons";
import {
  startGithubAuth,
  type GithubAuthStart,
  type GithubAuthStatus,
} from "@/lib/api";
import { useGithubAuth } from "@/hooks/useGithubAuth";
import { useTranslation } from "@/hooks/useTranslation";

interface GithubConnectModalProps {
  open: boolean;
  onClose: () => void;
  onConnected?: (status: GithubAuthStatus) => void;
}

export function GithubConnectModal({ open, onClose, onConnected }: GithubConnectModalProps) {
  const t = useTranslation().githubConnect;
  const { status, refresh } = useGithubAuth(open);

  const [startData, setStartData] = useState<GithubAuthStart | null>(null);
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);

  const beginFlow = useCallback(async () => {
    setStartLoading(true);
    setStartError(null);
    try {
      const data = await startGithubAuth();
      setStartData(data);
      await refresh();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setStartData(null);
      setStartError(null);
      setCopied(false);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    beginFlow();
  }, [open, beginFlow]);

  useEffect(() => {
    if (!open) return;
    if (status.connected) {
      onConnected?.(status);
      onClose();
    }
  }, [open, status, onConnected, onClose]);

  const userCode = startData?.userCode ?? status.userCode ?? null;
  const verificationUri = startData?.verificationUri ?? status.verificationUri ?? null;

  const handleCopy = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleOpenGithub = () => {
    if (!verificationUri) return;
    window.open(verificationUri, "_blank", "noopener,noreferrer");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.title}
      description={t.intro}
      icon={<IconGithub size={18} />}
      footerStart={
        userCode ? (
          <StatusPill status="info" live>
            {t.waiting}
          </StatusPill>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {startLoading && !userCode && (
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <IconSpinner size={14} />
            {t.requesting}
          </p>
        )}

        {startError && (
          <div role="alert" className="ui-banner ui-banner--error items-center">
            <IconAlert size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">{startError}</span>
            <Button size="sm" variant="secondary" icon={<IconRetry size={13} />} onClick={beginFlow}>
              {t.retry}
            </Button>
          </div>
        )}

        {userCode && (
          <ol className="flex flex-col gap-4">
            <Step n={1} label={t.step1}>
              <div className="flex items-stretch gap-2">
                <div
                  className="flex flex-1 items-center justify-center gap-[0.35em] rounded-[12px] border-2 border-line bg-sunken py-3.5 font-mono text-[26px] font-bold text-ink"
                  aria-label={userCode}
                >
                  {userCode.split("").map((ch, i) =>
                    ch === "-" ? (
                      <span key={i} aria-hidden className="text-ink-3">
                        –
                      </span>
                    ) : (
                      <span
                        key={i}
                        aria-hidden
                        className="grid h-11 w-8 place-items-center rounded-[7px] border-2 border-line bg-panel"
                        style={{ boxShadow: "2px 2px 0 var(--shadow-ink)" }}
                      >
                        {ch}
                      </span>
                    ),
                  )}
                </div>
                <Button
                  variant="secondary"
                  className="!h-auto"
                  icon={copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                  onClick={handleCopy}
                >
                  {copied ? t.copied : t.copy}
                </Button>
              </div>
            </Step>

            <Step n={2} label={t.step2}>
              <Button
                variant="primary"
                icon={<IconGithub size={15} />}
                iconRight={<IconArrowUpRight size={14} />}
                onClick={handleOpenGithub}
                disabled={!verificationUri}
                className="self-start"
              >
                <span className="font-mono">{verificationUri ? stripProtocol(verificationUri) : t.linkUnavailable}</span>
              </Button>
            </Step>

            {status.error && (
              <p role="alert" className="ui-banner ui-banner--error">
                {status.error}
              </p>
            )}
          </ol>
        )}
      </div>
    </Modal>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-line bg-mustard font-mono text-[12px] font-bold text-[var(--on-mustard)]"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
        <span className="text-[14px] font-semibold text-ink">{label}</span>
        {children}
      </div>
    </li>
  );
}

function stripProtocol(uri: string): string {
  return uri.replace(/^https?:\/\//, "");
}
