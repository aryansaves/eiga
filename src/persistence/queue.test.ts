import assert from "node:assert/strict";
import test from "node:test";
import { createPersistenceQueue, RevisionLedger } from "./queue.ts";

test("all queued mutations run in order and never overlap", async () => {
  const queue = createPersistenceQueue();
  const order: string[] = [];
  let active = 0;
  let peak = 0;
  const mutation = (name: string) =>
    queue.enqueue(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      order.push(name);
      active -= 1;
    });

  await Promise.all([
    mutation("save"),
    mutation("retry"),
    mutation("share"),
    mutation("delete"),
    mutation("logout"),
  ]);
  assert.deepEqual(order, ["save", "retry", "share", "delete", "logout"]);
  assert.equal(peak, 1);
});

test("a failed mutation does not block the next queued operation", async () => {
  const queue = createPersistenceQueue();
  const failure = queue.enqueue(async () => {
    throw new Error("failed");
  });
  const next = queue.enqueue(async () => "completed");
  await assert.rejects(failure, /failed/);
  assert.equal(await next, "completed");
});

test("a response advances only the revision for its authenticated epoch", () => {
  const ledger = new RevisionLedger();
  const original = { epoch: 4, userId: "user-a" } as const;
  ledger.reset(original, 3);
  assert.equal(ledger.advance(original, 4), true);
  assert.equal(ledger.current(original), 4);
  assert.equal(ledger.advance({ epoch: 5, userId: "user-a" }, 5), false);
  assert.equal(ledger.advance({ epoch: 4, userId: "user-b" }, 5), false);
  assert.equal(ledger.current(original), 4);
});
