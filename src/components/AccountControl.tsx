"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface AccountUser {
  readonly id: string;
  readonly name: string;
}

type View = "account" | "share" | "delete" | null;

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
  readonly onShare: () => Promise<void>;
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
        <button type="button" className="eiga-button" onClick={() => setView("account")}>
          Share
        </button>
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
            ) : sharedActive ? (
              <p className="eiga-annotation mt-5">A public link is active.</p>
            ) : null}
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
                  onClick={() => {
                    setMessage("");
                    setView("share");
                  }}
                >
                  Share this atlas
                </button>
              )}
              {sharedActive && !sharedUrl && (
                <button
                  type="button"
                  className="eiga-button"
                  disabled={!canShare || saving !== "idle" || busy}
                  onClick={() => void act(onShare, "Share link ready.")}
                >
                  Get share link
                </button>
              )}
              {sharedActive && (
                <button
                  type="button"
                  className="eiga-button"
                  disabled={saving === "working" || busy}
                  onClick={() => void act(onRevoke, "Share link revoked.")}
                >
                  Revoke link
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
            <div className="eiga-dialog-actions border-rule mt-6 border-t pt-6">
              <button
                type="button"
                className="eiga-button"
                disabled={busy}
                onClick={() =>
                  void act(onLogout, "Signed out.").then((ok) => {
                    if (ok) dialog.current?.close();
                  })
                }
              >
                Sign out
              </button>
              <button
                type="button"
                className="eiga-button"
                onClick={() => dialog.current?.close()}
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
        {user && view === "share" ? (
          <div className="eiga-dialog-content">
            <p className="eiga-mark text-signal text-xs">PUBLIC SHARE</p>
            <h2 id={titleId} className="font-display mt-3 text-2xl">
              Share your saved atlas?
            </h2>
            <p className="text-paper-mid mt-4 text-sm leading-relaxed text-balance">
              Anyone with the link can view your saved films, watch dates, ratings, likes,
              and review text. Reviews can be personal. The link stays available until you
              revoke it or delete your saved atlas.
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
                disabled={!canShare || busy}
                onClick={() =>
                  void act(onShare, "Share link created.").then((ok) => {
                    if (ok) setView("account");
                  })
                }
              >
                Publish link
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
