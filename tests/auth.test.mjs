import test from "node:test";
import assert from "node:assert/strict";
import { publishAuthSnapshot, subscribeAuthSnapshot } from "../src/auth/authState.ts";

test("认证状态桥立即同步当前状态并支持取消订阅", () => {
  const received = [];
  const unsubscribe = subscribeAuthSnapshot((snapshot) => received.push(snapshot.status));

  publishAuthSnapshot({ status: "anonymous", user: null, member: null, error: null });
  unsubscribe();
  publishAuthSnapshot({ status: "loading", user: null, member: null, error: null });

  assert.deepEqual(received, ["loading", "anonymous"]);
});
