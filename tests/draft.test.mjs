import assert from "node:assert/strict";
import { bindDraftChampions, draftSlotKey } from "../src/domain/draft.ts";

const heroDraft = [
  { team: "blue", position: "top", champion: { slug: "aatrox" } },
  { team: "blue", position: "middle", champion: { slug: "ahri" } },
  { team: "red", position: "top", champion: { slug: "garen" } },
  { team: "red", position: "middle", champion: { slug: "zed" } },
];

const randomizedPlayers = [
  { team: "red", position: "middle", player: { id: "p4" }, champion: null },
  { team: "blue", position: "top", player: { id: "p2" }, champion: null },
  { team: "red", position: "top", player: { id: "p1" }, champion: null },
  { team: "blue", position: "middle", player: { id: "p3" }, champion: null },
];

const bound = bindDraftChampions(randomizedPlayers, heroDraft);
assert.deepEqual(
  bound.map((slot) => [slot.player.id, slot.champion.slug]),
  [["p4", "zed"], ["p2", "aatrox"], ["p1", "garen"], ["p3", "ahri"]],
  "confirmed heroes should remain attached to their side and position after players are randomized",
);
assert.equal(draftSlotKey(bound[0]), "red:middle");

assert.throws(
  () => bindDraftChampions(randomizedPlayers, heroDraft.slice(1)),
  /英雄阵容缺少槽位：blue:top/,
);

assert.throws(
  () => bindDraftChampions(randomizedPlayers, [...heroDraft, heroDraft[0]]),
  /英雄阵容存在重复槽位：blue:top/,
);

console.log("draft tests passed");
