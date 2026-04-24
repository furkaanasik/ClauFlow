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
    <Modal open={open} onClose={onClose} title="GitHub'a Bağlan">
      <div className="flex flex-col gap-5">
        {startLoading && !userCode && (
          <p className="text-sm text-zinc-400">Kod alınıyor...</p>
        )}

        {startError && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-red-400">{startError}</p>
            <button
              type="button"
              onClick={beginFlow}
              className="self-start rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition"
            >
              Tekrar Dene
            </button>
          </div>
        )}

        {userCode && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-300">
                1. Aşağıdaki kodu kopyala:
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest text-zinc-100">
                  {userCode}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-zinc-700 px-3 py-3 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition"
                >
                  {copied ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-300">
                2. GitHub'ı aç ve kodu gir:
              </p>
              <button
                type="button"
                onClick={handleOpenGithub}
                disabled={!verificationUri}
                className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
              >
                {verificationUri
                  ? `${stripProtocol(verificationUri)} aç →`
                  : "Bağlantı hazır değil"}
              </button>
            </div>

            <div className="flex items-center gap-2 border-t border-zinc-800 pt-4">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-400" />
              <span className="text-xs text-zinc-400">
                Bağlantı bekleniyor...
              </span>
            </div>

            {status.error && (
              <p className="text-xs text-red-400">{status.error}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function stripProtocol(uri: string): string {
  return uri.replace(/^https?:\/\//, "");
}
