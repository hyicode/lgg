import test from "node:test";
import assert from "node:assert/strict";
import { computeLeaderboards, filterMatchesByRange } from "../assets/js/stats-core.js";

function match(id, playedAt, winner, bluePlayer, redPlayer, blueChampion, redChampion) {
  return {
    id,
    playedAt: new Date(playedAt),
    winner,
    lineup: [
      { team: "blue", playerId: bluePlayer, playerName: bluePlayer, lane: "top", laneLabel: "上单", champion: { slug: blueChampion, name: blueChampion } },
      { team: "red", playerId: redPlayer, playerName: redPlayer, lane: "top", laneLabel: "上单", champion: { slug: redChampion, name: redChampion } },
    ],
    bans: [{ slug: "annie", name: "安妮" }],
  };
}

test("计算选手胜负、连胜与英雄统计", () => {
  const matches = [
    match("1", "2026-07-01T12:00:00Z", "blue", "A", "B", "garen", "darius"),
    match("2", "2026-07-02T12:00:00Z", "blue", "A", "B", "garen", "darius"),
    match("3", "2026-07-03T12:00:00Z", "red", "A", "B", "garen", "darius"),
  ];
  const result = computeLeaderboards(matches);
  const playerA = result.players.find((player) => player.playerId === "A");
  const playerB = result.players.find((player) => player.playerId === "B");
  const garen = result.champions.find((champion) => champion.slug === "garen");
  const annie = result.champions.find((champion) => champion.slug === "annie");

  assert.equal(playerA.games, 3);
  assert.equal(playerA.wins, 2);
  assert.equal(playerA.currentStreak, 0);
  assert.equal(playerA.bestStreak, 2);
  assert.equal(playerB.currentStreak, 1);
  assert.equal(garen.picks, 3);
  assert.equal(garen.wins, 2);
  assert.equal(annie.bans, 3);
  assert.equal(annie.matchesPresent, 3);
});

test("按自定义日期范围筛选正式比赛", () => {
  const matches = [
    match("1", "2026-07-01T12:00:00Z", "blue", "A", "B", "garen", "darius"),
    match("2", "2026-07-15T12:00:00Z", "red", "A", "B", "garen", "darius"),
  ];
  const filtered = filterMatchesByRange(matches, "custom", "2026-07-10", "2026-07-20");
  assert.deepEqual(filtered.map((item) => item.id), ["2"]);
});

test("空数据返回稳定的总览", () => {
  const result = computeLeaderboards([]);
  assert.equal(result.summary.matches, 0);
  assert.equal(result.summary.blueWinRate, 0);
  assert.equal(result.summary.mostActive, "—");
  assert.deepEqual(result.players, []);
  assert.deepEqual(result.champions, []);
});
