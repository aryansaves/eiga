import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { demoLibrary } from "../domain/demo.ts";
import { loginWithGoogle, takePendingLibrary, consumeLoginReturn } from "./client.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalStorage)
    Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

function browserFixture(storageFails = false) {
  const values = new Map<string, string>();
  const navigations: string[] = [];
  const history: string[] = [];
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => {
        if (storageFails) throw new Error("Storage unavailable");
        values.set(key, value);
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://eiga.example/?auth=failed",
        assign: (url: string) => navigations.push(url),
      },
      history: {
        replaceState: (_state: unknown, _title: string, url: string) => history.push(url),
      },
    },
  });
  return { values, navigations, history };
}

test("redirect login preserves and consumes the current library even after cancellation", () => {
  const fixture = browserFixture();
  const library = demoLibrary();
  loginWithGoogle(() => assert.fail("Storage should be available"), library);
  assert.deepEqual(fixture.navigations, ["/api/auth/google"]);
  assert.equal(consumeLoginReturn(), "failed");
  assert.deepEqual(fixture.history, ["/"]);
  assert.deepEqual(takePendingLibrary(), library);
  assert.equal(takePendingLibrary(), null);
  assert.equal(fixture.values.size, 0);
});

test("login stays on the current map when tab storage cannot preserve it", () => {
  const fixture = browserFixture(true);
  let failed = false;
  loginWithGoogle(() => {
    failed = true;
  }, demoLibrary());
  assert.equal(failed, true);
  assert.deepEqual(fixture.navigations, []);
  assert.equal(fixture.values.size, 0);
});
