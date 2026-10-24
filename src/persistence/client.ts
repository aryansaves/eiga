import {
  libraryFromSnapshot,
  snapshotFromLibrary,
  type Snapshot,
} from "@/domain/snapshot.ts";
import type { Library } from "@/domain/types.ts";

export interface Session {
  readonly user: { readonly id: string; readonly name: string } | null;
  readonly csrfToken: string | null;
}
export interface SavedMap {
  readonly snapshot: Snapshot;
  readonly revision: number;
  readonly updatedAt: number;
  readonly shared: boolean;
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
  return request<{ revision: number; updatedAt: number; shared: boolean }>("/api/map", {
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
  onResult?: (ok: boolean) => void,
  pendingLibrary?: Library | null,
): void {
  const popup = window.open(
    "/api/auth/google?popup=1",
    "eiga-google-login",
    "popup,width=520,height=680",
  );
  if (popup) {
    const origin = window.location.origin;
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== popup ||
        event.data?.type !== "eiga-auth"
      )
        return;
      cleanup();
      popup.close();
      onResult?.(Boolean(event.data.ok));
    };
    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        onResult?.(false);
      }
    }, 400);
    const cleanup = () => {
      window.removeEventListener("message", listener);
      window.clearInterval(poll);
    };
    window.addEventListener("message", listener);
    return;
  }
  try {
    if (pendingLibrary)
      sessionStorage.setItem(
        "eiga-pending-library",
        JSON.stringify(snapshotFromLibrary(pendingLibrary)),
      );
    sessionStorage.setItem("eiga-pending-login", "1");
  } catch {
    if (pendingLibrary) {
      clearPendingLogin();
      onResult?.(false);
      return;
    }
  }
  // OAuth must begin as a full-page navigation when the popup is blocked.
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
