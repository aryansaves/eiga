import test from "node:test";
import assert from "node:assert/strict";
import { demoLibrary } from "../domain/demo.ts";
import { buildThread } from "../graph/thread.ts";
import { buildGraph, byDecade, byRating } from "../graph/build.ts";
import { createLayout, fitToFrame, FRAME_INSET_BARE, settle } from "./layout.ts";
import { frameAtlas } from "./framing.ts";

for (const [name, graph] of [
  ["journey", buildThread(demoLibrary())],
  ["decade", buildGraph(demoLibrary(), byDecade)],
  ["rating", buildGraph(demoLibrary(), byRating)],
] as const) {
  test(`the complete ${name} map fits inside a phone viewport`, () => {
    const layout = createLayout(graph, 320, 440);
    settle(layout.simulation);
    const fit = frameAtlas(layout.nodes, 320, 440);
    assert.ok(fit.k > 0 && fit.k <= 1);
    for (const node of layout.nodes) {
      const x = fit.x + node.x * fit.k;
      const y = fit.y + node.y * fit.k;
      assert.ok(x >= 24 && x <= 320 - 24);
      assert.ok(y >= 24 && y <= 440 - 24);
    }
  });
}

test("desktop keeps its overview while shared pages use their full framed surface", () => {
  const layout = createLayout(buildThread(demoLibrary()), 1280, 860);
  layout.simulation.stop();
  assert.deepEqual(
    frameAtlas(layout.nodes, 1280, 860),
    fitToFrame(layout.nodes, 1280, 860),
  );
  assert.deepEqual(
    frameAtlas(layout.nodes, 1280, 860, [], true),
    fitToFrame(layout.nodes, 1280, 860, [], FRAME_INSET_BARE),
  );
});

test("empty and tiny maps have finite framing without excessive magnification", () => {
  assert.deepEqual(frameAtlas([], 320, 440), { k: 1, x: 0, y: 0 });
  const layout = createLayout(buildThread(demoLibrary()), 320, 440);
  layout.simulation.stop();
  const fit = frameAtlas(layout.nodes.slice(0, 1), 320, 440);
  assert.equal(fit.k, 1);
  assert.ok(Number.isFinite(fit.x) && Number.isFinite(fit.y));
});
