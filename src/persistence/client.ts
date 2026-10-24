import {
  libraryFromSnapshot,
  snapshotFromLibrary,
  type Snapshot,
} from "../domain/snapshot.ts";
import type { Library } from "../domain/types.ts";

export interface Session {
  readonly user: { readonly id: string; readonly name: string } | null;
  readonly csrfToken: string | null;
}
export interface SavedMap {
  readonly snapshot: Snapshot;
  readonly revision: number;
  readonly updatedAt: number;
  readonly shared: boolean;
  readonly shareUrl: string | null;
}
let csrfToken: string | null = null;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "This map changed in another session. Reload your saved map to continue."
        : "The request could not be completed.",
    );
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getSession(): Promise<Session> {
  const session = await request<Session>("/api/auth/session");
  csrfToken = session.csrfToken;
  return session;
}
export async function getSavedMap() {
  return request<SavedMap | null>("/api/map");
}
export async function saveMap(library: Library, revision: number) {
  return request<Omit<SavedMap, "snapshot">>("/api/map", {
    method: "PUT",
    body: JSON.stringify({ snapshot: snapshotFromLibrary(library), revision }),
  });
}
export async function createShare() {
  return request<{ url: string }>("/api/share", { method: "POST" });
}
export async function revokeShare() {
  return request<void>("/api/share", { method: "DELETE" });
}
export async function deleteSavedMap() {
  return request<void>("/api/map", { method: "DELETE" });
}
export async function logout() {
  return request<void>("/api/auth/logout", { method: "POST" });
}
export async function getSharedMap(token: string) {
  const response = await request<{ snapshot: Snapshot; updatedAt: number }>(
    `/api/share/${encodeURIComponent(token)}`,
  );
  return {
    library: libraryFromSnapshot(response.snapshot),
    updatedAt: response.updatedAt,
  };
}

export function loginWithGoogle(
  onFailure: () => void,
  pendingLibrary?: Library | null,
): void {
  clearPendingLogin();
  try {
    if (pendingLibrary)
      sessionStorage.setItem(
        "eiga-pending-library",
        JSON.stringify(snapshotFromLibrary(pendingLibrary)),
      );
  } catch {
    if (pendingLibrary) {
      clearPendingLogin();
      onFailure();
      return;
    }
  }
  // Keep a single redirect flow; tab storage preserves the current import.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/api/auth/google");
}

export function consumeLoginReturn(): "success" | "failed" | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get("auth");
  if (value !== "success" && value !== "failed") return null;
  url.searchParams.delete("auth");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  return value;
}

export function clearPendingLogin() {
  try {
    sessionStorage.removeItem("eiga-pending-login");
    sessionStorage.removeItem("eiga-pending-library");
  } catch {
    /* optional */
  }
}
export function takePendingLibrary(): Library | null {
  try {
    const value = sessionStorage.getItem("eiga-pending-library");
    sessionStorage.removeItem("eiga-pending-library");
    return value ? libraryFromSnapshot(JSON.parse(value)) : null;
  } catch {
    clearPendingLogin();
    return null;
  }
}
