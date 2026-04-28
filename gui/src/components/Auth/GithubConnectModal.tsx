"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  startGithubAuth,
  type GithubAuthStart,
  type GithubAuthStatus,
} from "@/lib/api";
import { useGithubAuth } from "@/hooks/useGithubAuth";

interface GithubConnectModalProps {
  open: boolean;
  onClose: () => void;
  onConnected?: (status: GithubAuthStatus) => void;
}

export function GithubConnectModal({
  open,
  onClose,
  onConnected,
}: GithubConnectModalProps) {
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
  const verificationUri =
    startData?.verificationUri ?? status.verificationUri ?? null;

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
    <Modal open={open} onClose={onClose} title="Connect GitHub">
      <div className="flex flex-col gap-5">
        {startLoading && !userCode && (
          <p className="text-[12px] text-[var(--text-muted)]">
            Requesting code…
          </p>
        )}

        {startError && (
          <div className="flex flex-col gap-2 border border-[var(--status-error)] bg-[var(--status-error-ink)] p-3">
            <p className="text-xs text-[var(--status-error)]">{startError}</p>
            <button
              type="button"
              onClick={beginFlow}
              className="btn-ghost self-start px-3 py-1.5 text-[12px] font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {userCode && (
          <>
            <Step label="Copy this code">
              <div className="flex items-stretch gap-2">
                <div className="flex flex-1 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] py-3 text-center font-mono text-2xl font-bold tracking-[0.4em] text-[var(--text-primary)]">
                  {userCode}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="btn-ghost px-4 text-[12px] font-medium"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </Step>

            <Step label="Open GitHub & paste">
              <button
                type="button"
                onClick={handleOpenGithub}
                disabled={!verificationUri}
                className="btn-ink inline-flex items-center gap-3 px-4 py-2 text-[12px] font-medium disabled:opacity-50"
              >
                {verificationUri
                  ? `${stripProtocol(verificationUri)}`
                  : "Link unavailable"}
                <span aria-hidden>↗</span>
              </button>
            </Step>

            <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3">
              <span className="h-1.5 w-1.5 animate-pulse bg-[var(--accent-primary)]" />
              <span className="text-[12px] text-[var(--text-muted)]">
                Waiting for confirmation…
              </span>
            </div>

            {status.error && (
              <p className="text-xs text-[var(--status-error)]">{status.error}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function Step({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function stripProtocol(uri: string): string {
  return uri.replace(/^https?:\/\//, "");
}
