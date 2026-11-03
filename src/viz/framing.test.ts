import test from "node:test";
import assert from "node:assert/strict";
import { demoLibrary } from "../domain/demo.ts";
import { buildThread } from "../graph/thread.ts";
import { buildGraph, byDecade } from "../graph/build.ts";
import { createLayout, fitToFrame, FRAME_INSET_BARE, settle } from "./layout.ts";
import { frameAtlas } from "./framing.ts";

test("a phone opens a long journey at readable scale around its latest viewing", () => {
  const layout = createLayout(buildThread(demoLibrary()), 375, 560);
  layout.simulation.stop();
  const overview = frameAtlas(layout.nodes, 375, 560, [], false, true);
  const reading = frameAtlas(layout.nodes, 375, 560);
  assert.ok(overview.k < 0.5, "fixture reproduces the titleless overview");
  assert.ok(reading.k >= 0.8);
  const latest = layout.nodes.filter((node) => node.order !== null).at(-1)!;
  assert.ok(reading.x + latest.x * reading.k >= 24);
  assert.ok(reading.x + latest.x * reading.k <= 375 - 24);
  assert.ok(Math.abs(reading.y + latest.y * reading.k - 560 * 0.7) < 1);
  for (const node of layout.nodes) {
    assert.ok(reading.x + node.x * reading.k >= 0);
    assert.ok(reading.x + node.x * reading.k <= 375);
  }
});

test("Fit all keeps every stop reachable in the phone overview", () => {
  const layout = createLayout(buildThread(demoLibrary()), 320, 440);
  layout.simulation.stop();
  const fit = frameAtlas(layout.nodes, 320, 440, [], false, true);
  for (const node of layout.nodes) {
    assert.ok(fit.x + node.x * fit.k >= 24);
    assert.ok(fit.x + node.x * fit.k <= 320 - 24);
    assert.ok(fit.y + node.y * fit.k >= 24);
    assert.ok(fit.y + node.y * fit.k <= 440 - 24);
  }
});

test("a phone attribute map opens around a populated hub", () => {
  const layout = createLayout(buildGraph(demoLibrary(), byDecade), 375, 560);
  settle(layout.simulation);
  const fit = frameAtlas(layout.nodes, 375, 560);
  const largest = layout.nodes
    .filter((node) => node.kind === "hub")
    .sort((a, b) => b.degree - a.degree)[0];
  assert.ok(fit.k >= 0.8);
  assert.ok(Math.abs(fit.x + largest.x * fit.k - 375 / 2) < 1);
});

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
