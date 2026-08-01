import test from "node:test";
import assert from "node:assert/strict";
import { publishActiveView, subscribeActiveView } from "../src/navigation/viewState.ts";

test("视图状态桥立即同步当前页面并支持取消订阅", () => {
  const received = [];
  const unsubscribe = subscribeActiveView((view) => received.push(view));

  publishActiveView("historyView");
  unsubscribe();
  publishActiveView("rollView");

  assert.deepEqual(received, ["rollView", "historyView"]);
});
