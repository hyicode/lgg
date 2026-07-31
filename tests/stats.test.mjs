import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePlayerStats, comparePlayerStats, computeLeaderboards, filterMatchesByRange } from "../assets/js/stats-core.js";

function match(id, playedAt, winner, bluePlayer, redPlayer, blueChampion, redChampion) {
  return {
    id,
    playedAt: new Date(playedAt),
    winner,
    participants: [
      { team: "blue", playerId: bluePlayer, playerName: bluePlayer, position: "top", positionLabel: "上单", champion: { slug: blueChampion, name: blueChampion } },
      { team: "red", playerId: redPlayer, playerName: redPlayer, position: "top", positionLabel: "上单", champion: { slug: redChampion, name: redChampion } },
    ],
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

  assert.equal(playerA.games, 3);
  assert.equal(playerA.wins, 2);
  assert.equal(playerA.currentStreak, 0);
  assert.equal(playerA.bestStreak, 2);
  assert.equal(playerA.favoritePosition, "上单");
  assert.equal(playerB.currentStreak, 1);
  assert.equal(garen.picks, 3);
  assert.equal(garen.wins, 2);
  assert.equal(garen.matchesPresent, 3);
});

test("按自定义日期范围筛选正式比赛", () => {
  const matches = [
    match("1", "2026-07-01T12:00:00Z", "blue", "A", "B", "garen", "darius"),
    match("2", "2026-07-15T12:00:00Z", "red", "A", "B", "garen", "darius"),
  ];
  const filtered = filterMatchesByRange(matches, "custom", "2026-07-10", "2026-07-20");
  assert.deepEqual(filtered.map((item) => item.id), ["2"]);
});

test("按最近一周筛选正式比赛", () => {
  const now = new Date("2026-07-31T12:00:00+08:00");
  const matches = [
    match("today", "2026-07-31T10:00:00+08:00", "blue", "A", "B", "garen", "darius"),
    match("within-week", "2026-07-25T12:00:00+08:00", "red", "A", "B", "garen", "darius"),
    match("older", "2026-07-23T23:59:59+08:00", "blue", "A", "B", "garen", "darius"),
  ];
  assert.deepEqual(
    filterMatchesByRange(matches, "7", "", "", now).map((item) => item.id),
    ["today", "within-week"],
  );
});

test("空数据返回稳定的总览", () => {
  const result = computeLeaderboards([]);
  assert.equal(result.summary.matches, 0);
  assert.equal(result.summary.blueWinRate, 0);
  assert.equal(result.summary.mostActive, "—");
  assert.deepEqual(result.players, []);
  assert.deepEqual(result.champions, []);
});

test("兼容使用 lane 字段的旧对局记录", () => {
  const legacyMatch = match("legacy", "2026-06-01T12:00:00Z", "blue", "A", "B", "garen", "darius");
  legacyMatch.participants[0].lane = legacyMatch.participants[0].position;
  legacyMatch.participants[0].laneLabel = legacyMatch.participants[0].positionLabel;
  delete legacyMatch.participants[0].position;
  delete legacyMatch.participants[0].positionLabel;

  const result = computeLeaderboards([legacyMatch]);
  assert.equal(result.players.find((player) => player.playerId === "A").favoritePosition, "上单");
});

test("借号时按实际选手 ID 分别归属战绩", () => {
  const sharedAccount = "shared-account";
  const matches = [
    {
      ...match("1", "2026-07-01T12:00:00Z", "blue", "A", "B", "garen", "darius"),
      participants: [
        { team: "blue", playerId: "A", playerName: "甲", accountName: sharedAccount, stats: { kills: 8, deaths: 2, assists: 4 }, champion: { slug: "garen", name: "garen" } },
      ],
    },
    {
      ...match("2", "2026-07-02T12:00:00Z", "red", "C", "B", "garen", "darius"),
      participants: [
        { team: "red", playerId: "C", playerName: "丙", accountName: sharedAccount, stats: { kills: 3, deaths: 1, assists: 9 }, champion: { slug: "darius", name: "darius" } },
      ],
    },
  ];
  const totals = aggregatePlayerStats(matches);

  assert.equal(totals.size, 2);
  assert.equal(totals.get("A").games, 1);
  assert.equal(totals.get("A").kills, 8);
  assert.equal(totals.get("C").games, 1);
  assert.equal(totals.get("C").kills, 3);
  assert.equal(totals.has(sharedAccount), false);
});

test("校对能发现汇总差异并忽略缺少实际选手 ID 的旧记录", () => {
  const matches = [{
    ...match("1", "2026-07-01T12:00:00Z", "blue", "A", "B", "garen", "darius"),
    participants: [
      { team: "blue", playerId: "A", playerName: "甲", accountName: "borrowed", stats: { kills: 2 }, champion: { slug: "garen", name: "garen" } },
      { team: "red", playerName: "未知", accountName: "borrowed", stats: { kills: 99 }, champion: { slug: "darius", name: "darius" } },
    ],
  }];
  const audit = comparePlayerStats(matches, new Map([["A", { player_id: "A", games: 2, wins: 1, losses: 1, kills: 2, deaths: 0, assists: 0 }]]));

  assert.equal(audit.expected.size, 1);
  assert.equal(audit.discrepancies.length, 1);
  assert.deepEqual(audit.discrepancies[0].changedFields, ["games", "losses"]);
  assert.equal(computeLeaderboards(matches).players.length, 1);
});
