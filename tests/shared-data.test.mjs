import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySharedData,
  publishSharedData,
  requestSharedDataRefresh,
  subscribeSharedData,
  subscribeSharedDataRefresh,
} from "../src/data/sharedData.ts";

test("共享数据桥同步快照并等待刷新完成", async () => {
  const playerCounts = [];
  const unsubscribeData = subscribeSharedData((snapshot) => playerCounts.push(snapshot.players.length));
  publishSharedData({ ...emptySharedData(), players: [{ id: "p1" }] });

  let refreshed = false;
  const unsubscribeRefresh = subscribeSharedDataRefresh(async () => {
    await Promise.resolve();
    refreshed = true;
  });
  await requestSharedDataRefresh();

  unsubscribeData();
  unsubscribeRefresh();
  assert.deepEqual(playerCounts, [0, 1]);
  assert.equal(refreshed, true);
});
