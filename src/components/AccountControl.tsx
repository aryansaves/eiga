"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface AccountUser {
  readonly id: string;
  readonly name: string;
}

type View = "account" | "delete" | null;

export function AccountControl({
  user,
  saving,
  sharedUrl,
  sharedActive = false,
  onLogin,
  onShare,
  onRevoke,
  onDelete,
  onLogout,
  onRetry,
  hasSaved = false,
  canShare = hasSaved,
  notice = "",
}: {
  readonly user: AccountUser | null;
  readonly saving: "idle" | "working" | "failed";
  readonly sharedUrl: string | null;
  readonly sharedActive?: boolean;
  readonly onLogin: () => void;
  readonly onShare: () => Promise<string>;
  readonly onRevoke: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly onLogout: () => Promise<void>;
  readonly onRetry: () => void;
  readonly hasSaved?: boolean;
  readonly canShare?: boolean;
  readonly notice?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [view, setView] = useState<View>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (view) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else dialog.current?.close();
  }, [view]);

  const act = async (operation: () => Promise<void>, done: string): Promise<boolean> => {
    setMessage("");
    setBusy(true);
    try {
      await operation();
      setMessage(done);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not complete that request.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {user ? (
        <>
          <button
            type="button"
            className="eiga-button"
            disabled={busy}
            onClick={() => {
              setMessage("");
              setView("account");
              if (!sharedActive && canShare && saving === "idle")
                void act(async () => {
                  await onShare();
                }, "Share link ready.");
            }}
          >
            Share
          </button>
          <button
            type="button"
            className="eiga-button"
            disabled={busy}
            onClick={() =>
              void act(onLogout, "").then((ok) => {
                if (ok) setView(null);
              })
            }
          >
            Sign out
          </button>
        </>
      ) : (
        <button type="button" className="eiga-button" onClick={onLogin}>
          Sign in
        </button>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setView(null)}
        className="eiga-dialog text-paper backdrop:bg-void/75"
      >
        {user && view === "account" ? (
          <div className="eiga-dialog-content">
            <p className="eiga-mark text-signal text-xs">YOUR ACCOUNT</p>
            <h2 id={titleId} className="font-display mt-3 text-2xl">
              {user.name}
            </h2>
            <p className="eiga-annotation mt-2">
              {saving === "working"
                ? "Saving your atlas…"
                : saving === "failed"
                  ? "Could not save your atlas."
                  : hasSaved
                    ? "Your atlas saves to your account."
                    : "No atlas is saved yet."}
            </p>
            {notice && (
              <p role="status" className="eiga-annotation mt-3">
                {notice}
              </p>
            )}
            {saving === "failed" && (
              <button type="button" className="eiga-button mt-3" onClick={onRetry}>
                Retry save
              </button>
            )}
            {sharedUrl ? (
              <div className="mt-6">
                <p className="eiga-annotation mb-2">Your public link</p>
                <a
                  className="eiga-share-link decoration-signal underline underline-offset-4"
                  href={sharedUrl}
                >
                  {sharedUrl}
                </a>
              </div>
            ) : null}
            {sharedActive && (
              <>
                <button
                  type="button"
                  className="eiga-button mt-3 w-full"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const url = sharedUrl ?? (await onShare());
                      try {
                        await navigator.clipboard.writeText(url);
                      } catch {
                        throw new Error(
                          "Could not copy. Select the link above to copy it.",
                        );
                      }
                    }, "Link copied.")
                  }
                >
                  Copy link
                </button>
                <p className="text-paper-mid mt-4 text-sm leading-relaxed text-balance">
                  New uploads update your atlas at this same link. Stop sharing makes it
                  private again.
                </p>
              </>
            )}
            {message && (
              <p role="status" className="eiga-annotation mt-4">
                {message}
              </p>
            )}
            <div className="eiga-dialog-actions mt-6">
              {!sharedActive && (
                <button
                  type="button"
                  className="eiga-button"
                  disabled={!canShare || saving !== "idle" || busy}
                  onClick={() =>
                    void act(async () => {
                      await onShare();
                    }, "Share link ready.")
                  }
                >
                  Share this atlas
                </button>
              )}
              {sharedActive && (
                <button
                  type="button"
                  className="eiga-button"
                  disabled={saving === "working" || busy}
                  onClick={() =>
                    void act(onRevoke, "Sharing stopped. Your atlas is private.")
                  }
                >
                  Stop sharing
                </button>
              )}
              <button
                type="button"
                className="eiga-button"
                disabled={!hasSaved || saving === "working" || busy}
                onClick={() => {
                  setMessage("");
                  setView("delete");
                }}
              >
                Delete saved atlas
              </button>
            </div>
            {!hasSaved && (
              <p className="eiga-annotation mt-4">
                Import a library and let it save before sharing.
              </p>
            )}
            <div className="border-rule mt-6 border-t pt-6">
              <button
                type="button"
                className="eiga-button w-full"
                onClick={() => dialog.current?.close()}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
        {user && view === "delete" ? (
          <div className="eiga-dialog-content">
            <p className="eiga-mark text-signal text-xs">DELETE ATLAS</p>
            <h2 id={titleId} className="font-display mt-3 text-2xl">
              Delete your saved atlas?
            </h2>
            <p className="text-paper-mid mt-4 text-sm leading-relaxed text-balance">
              This permanently removes the atlas from your account and revokes its public
              link. Your current local view stays open.
            </p>
            {message && (
              <p role="status" className="eiga-annotation mt-4">
                {message}
              </p>
            )}
            <div className="eiga-dialog-actions mt-6">
              <button
                type="button"
                className="eiga-button"
                disabled={busy}
                onClick={() =>
                  void act(onDelete, "Saved atlas deleted.").then((ok) => {
                    if (ok) setView("account");
                  })
                }
              >
                Delete atlas
              </button>
              <button
                type="button"
                className="eiga-button"
                disabled={busy}
                onClick={() => setView("account")}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
