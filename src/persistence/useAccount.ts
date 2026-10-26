"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Library } from "@/domain/types.ts";
import { snapshotFromLibrary } from "@/domain/snapshot.ts";
import {
  clearPendingLogin,
  consumeLoginReturn,
  createShare,
  deleteSavedMap,
  getSavedMap,
  getSession,
  loginWithGoogle,
  logout,
  revokeShare,
  saveMap,
  takePendingLibrary,
  type SavedMap,
  type Session,
} from "@/persistence/client.ts";
import {
  createPersistenceQueue,
  RevisionLedger,
  type RevisionOwner,
} from "@/persistence/queue.ts";

interface SaveTarget {
  readonly library: Library;
  readonly userId: string;
  readonly allowed: boolean;
}
interface SaveTargetInput {
  readonly library: Library | null;
  readonly userId: string | null;
  readonly allowed: boolean;
}
interface SuccessfulTarget {
  readonly userId: string;
  readonly library: Library;
}

export function useAccount(
  onRestorePending?: (library: Library) => void,
  onSaveConflict?: () => void,
) {
  const [session, setSession] = useState<Session>({ user: null, csrfToken: null });
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<SavedMap | null>(null);
  const [lastSaved, setLastSaved] = useState<SuccessfulTarget | null>(null);
  const [saving, setSaving] = useState<"idle" | "working" | "failed">("idle");
  const [notice, setNotice] = useState("");
  const clearNotice = useCallback(() => setNotice(""), []);
  const sessionRef = useRef(session);
  const readyRef = useRef(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const generation = useRef(0);
  const target = useRef<SaveTarget | null>(null);
  const targetInput = useRef<SaveTargetInput>({
    library: null,
    userId: null,
    allowed: false,
  });
  const timer = useRef<number | null>(null);
  const logoutPending = useRef(false);
  const deletePending = useRef(false);
  const deletedLibrary = useRef<Library | null>(null);
  const lastSavedRef = useRef<SuccessfulTarget | null>(null);
  const queue = useRef(createPersistenceQueue());
  const revisions = useRef(new RevisionLedger());

  const commitSession = useCallback((next: Session) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const cancelPendingSave = useCallback(() => {
    clearTimer();
    ++generation.current;
  }, [clearTimer]);

  const refresh = useCallback(async () => {
    const currentEpoch = ++epoch.current;
    readyRef.current = false;
    setReady(false);
    setLastSaved(null);
    lastSavedRef.current = null;
    revisions.current.clear();
    try {
      const nextSession = await getSession();
      if (!mounted.current || currentEpoch !== epoch.current) return;
      if (nextSession.user) {
        await queue.current.idle();
        const result = await getSavedMap();
        if (!mounted.current || currentEpoch !== epoch.current) return;
        commitSession(nextSession);
        setNotice("");
        setSaved(result);
        revisions.current.reset(
          { epoch: currentEpoch, userId: nextSession.user.id },
          result?.revision ?? 0,
        );
      } else {
        commitSession(nextSession);
        setSaved(null);
      }
    } catch {
      if (mounted.current && currentEpoch === epoch.current) {
        commitSession({ user: null, csrfToken: null });
        setSaved(null);
        revisions.current.clear();
        setNotice("Account services are unavailable. Your local atlas still works.");
      }
    } finally {
      if (mounted.current && currentEpoch === epoch.current) {
        readyRef.current = true;
        setReady(true);
      }
    }
  }, [commitSession]);

  useEffect(() => {
    mounted.current = true;
    const returned = consumeLoginReturn();
    // Restore even after navigating back from Google without a callback.
    const pending = takePendingLibrary();
    if (pending) onRestorePending?.(pending);
    clearPendingLogin();
    if (returned === "failed")
      queueMicrotask(() =>
        setNotice("Sign in did not complete. Your local import is still here."),
      );
    queueMicrotask(() => void refresh());
    return () => {
      mounted.current = false;
      cancelPendingSave();
    };
  }, [refresh, onRestorePending, cancelPendingSave]);

  const login = useCallback(
    (pendingLibrary?: Library | null) =>
      loginWithGoogle(() => {
        setNotice(
          "This browser could not preserve your import for sign-in. Your local atlas is still here.",
        );
      }, pendingLibrary),
    [],
  );

  const resolveSaveConflict = useCallback(
    async (owner: RevisionOwner, requestEpoch: number, requestGeneration: number) => {
      const latest = await getSavedMap();
      if (!mounted.current || epoch.current !== requestEpoch) return;
      setSaved(latest);
      setLastSaved(null);
      lastSavedRef.current = null;
      revisions.current.reset(owner, latest?.revision ?? 0);
      const activeTarget = target.current;
      if (
        requestGeneration === generation.current &&
        activeTarget?.userId === owner.userId &&
        activeTarget.allowed
      ) {
        onSaveConflict?.();
        setNotice(
          "Your saved atlas changed in another session. Choose which atlas to keep.",
        );
      }
    },
    [onSaveConflict],
  );

  const enqueueSave = useCallback(
    (saveTarget: SaveTarget, requestEpoch: number, requestGeneration: number) => {
      return queue.current.enqueue(async () => {
        if (
          !mounted.current ||
          logoutPending.current ||
          deletePending.current ||
          requestEpoch !== epoch.current ||
          requestGeneration !== generation.current ||
          target.current?.allowed !== true ||
          target.current.library !== saveTarget.library ||
          sessionRef.current.user?.id !== saveTarget.userId
        )
          return;

        const owner: RevisionOwner = { epoch: requestEpoch, userId: saveTarget.userId };
        const revision = revisions.current.current(owner);
        if (revision === null) return;
        try {
          const result = await saveMap(saveTarget.library, revision);
          if (!revisions.current.advance(owner, result.revision)) return;
          if (
            requestGeneration !== generation.current ||
            target.current?.library !== saveTarget.library
          )
            return;
          setSaved({
            snapshot: snapshotFromLibrary(saveTarget.library),
            revision: result.revision,
            updatedAt: result.updatedAt,
            shared: result.shared,
            shareUrl: result.shareUrl,
          });
          setLastSaved({ userId: saveTarget.userId, library: saveTarget.library });
          lastSavedRef.current = {
            userId: saveTarget.userId,
            library: saveTarget.library,
          };
          setNotice("");
          setSaving("idle");
        } catch (error) {
          if (!mounted.current || requestEpoch !== epoch.current) return;
          if (error instanceof Error && error.message.startsWith("This map changed")) {
            try {
              await resolveSaveConflict(owner, requestEpoch, requestGeneration);
            } catch {
              /* The retry action can fetch the current revision later. */
            }
          }
          if (requestGeneration === generation.current) setSaving("failed");
        }
      });
    },
    [resolveSaveConflict],
  );

  const setSaveTarget = useCallback(
    (library: Library | null, canSave: boolean) => {
      const userId = sessionRef.current.user?.id ?? null;
      const allowed = Boolean(
        library &&
        userId &&
        canSave &&
        readyRef.current &&
        !logoutPending.current &&
        !deletePending.current &&
        deletedLibrary.current !== library,
      );
      const previous = targetInput.current;
      if (
        previous.library === library &&
        previous.userId === userId &&
        previous.allowed === allowed
      )
        return;

      clearTimer();
      ++generation.current;
      targetInput.current = { library, userId, allowed };
      target.current = library && userId ? { library, userId, allowed } : null;
      if (!allowed || !library || !userId || !readyRef.current) {
        setSaving("idle");
        return;
      }

      setSaving("working");
      const saveTarget = target.current!;
      const requestEpoch = epoch.current;
      const requestGeneration = generation.current;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void enqueueSave(saveTarget, requestEpoch, requestGeneration);
      }, 700);
    },
    [clearTimer, enqueueSave],
  );

  const retry = useCallback(() => {
    const current = target.current;
    if (
      !current?.allowed ||
      !readyRef.current ||
      sessionRef.current.user?.id !== current.userId
    )
      return;
    clearTimer();
    const requestGeneration = ++generation.current;
    setSaving("working");
    void enqueueSave(current, epoch.current, requestGeneration);
  }, [clearTimer, enqueueSave]);

  const share = useCallback(async () => {
    const userId = sessionRef.current.user?.id;
    const requestEpoch = epoch.current;
    if (!userId || !readyRef.current || logoutPending.current)
      throw new Error("Sign in to share an atlas.");
    if (!saved) throw new Error("Save your atlas before sharing it.");
    if (
      target.current?.library &&
      (lastSavedRef.current?.userId !== userId ||
        lastSavedRef.current.library !== target.current.library ||
        target.current.allowed !== true)
    )
      throw new Error("Wait for this atlas to finish saving before sharing it.");
    const result = await queue.current.enqueue(async () => {
      if (
        requestEpoch !== epoch.current ||
        sessionRef.current.user?.id !== userId ||
        logoutPending.current
      ) {
        throw new Error("Your account changed. Try again.");
      }
      return createShare();
    });
    if (requestEpoch === epoch.current && sessionRef.current.user?.id === userId) {
      setSaved((current) =>
        current ? { ...current, shared: true, shareUrl: result.url } : current,
      );
      return result.url;
    }
    throw new Error("Your account changed. Try again.");
  }, [saved]);

  const revoke = useCallback(async () => {
    const userId = sessionRef.current.user?.id;
    const requestEpoch = epoch.current;
    if (!userId || !readyRef.current || logoutPending.current)
      throw new Error("Sign in to manage sharing.");
    await queue.current.enqueue(async () => {
      if (
        requestEpoch !== epoch.current ||
        sessionRef.current.user?.id !== userId ||
        logoutPending.current
      ) {
        throw new Error("Your account changed. Try again.");
      }
      await revokeShare();
      if (requestEpoch === epoch.current && sessionRef.current.user?.id === userId) {
        setSaved((current) =>
          current ? { ...current, shared: false, shareUrl: null } : current,
        );
      }
    });
  }, []);

  const remove = useCallback(
    async (libraryToKeep?: Library | null) => {
      const userId = sessionRef.current.user?.id;
      const requestEpoch = epoch.current;
      if (!userId || !readyRef.current || logoutPending.current)
        throw new Error("Sign in to delete a saved atlas.");
      clearTimer();
      const previous = target.current;
      ++generation.current;
      target.current = null;
      deletePending.current = true;
      try {
        await queue.current.enqueue(async () => {
          if (requestEpoch !== epoch.current || sessionRef.current.user?.id !== userId) {
            throw new Error("Your account changed. Try again.");
          }
          await deleteSavedMap();
          deletedLibrary.current = libraryToKeep ?? previous?.library ?? null;
          setSaved(null);
          setLastSaved(null);
          lastSavedRef.current = null;
          revisions.current.reset({ epoch: requestEpoch, userId }, 0);
        });
      } catch (error) {
        deletePending.current = false;
        if (previous?.allowed && sessionRef.current.user?.id === userId) {
          targetInput.current = previous;
          target.current = { library: previous.library!, userId, allowed: true };
          setSaving("failed");
        }
        throw error;
      }
      deletePending.current = false;
    },
    [clearTimer],
  );

  const signOut = useCallback(async () => {
    if (logoutPending.current) throw new Error("Sign out is already in progress.");
    logoutPending.current = true;
    clearTimer();
    ++generation.current;
    target.current = null;
    const userId = sessionRef.current.user?.id;
    targetInput.current = { library: null, userId: userId ?? null, allowed: false };
    try {
      await queue.current.enqueue(async () => {
        if (sessionRef.current.user?.id !== userId)
          throw new Error("Your account changed. Try again.");
        await logout();
      });
    } catch (error) {
      logoutPending.current = false;
      void refresh();
      throw error;
    }

    logoutPending.current = false;
    ++epoch.current;
    revisions.current.clear();
    commitSession({ user: null, csrfToken: null });
    setSaved(null);
    setLastSaved(null);
    lastSavedRef.current = null;
    setSaving("idle");
    setReady(true);
    readyRef.current = true;
  }, [clearTimer, commitSession, refresh]);

  return {
    session,
    ready,
    saved,
    lastSaved,
    saving,
    shareUrl: saved?.shareUrl ?? null,
    notice,
    clearNotice,
    login,
    refresh,
    setSaveTarget,
    retry,
    share,
    revoke,
    remove,
    signOut,
  };
}
