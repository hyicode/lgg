import assert from "node:assert/strict";
import {
  beijingBpDayKey,
  GLOBAL_BP_RESET_TRIGGERS,
  hasGlobalBpProgress,
  nextGlobalBpRound,
  shouldResetGlobalBp,
} from "../src/domain/globalBp.ts";

assert.equal(beijingBpDayKey(new Date("2026-08-11T23:59:59.000Z")), "2026-08-11");
assert.equal(beijingBpDayKey(new Date("2026-08-12T00:00:00.000Z")), "2026-08-12");

assert.equal(shouldResetGlobalBp(GLOBAL_BP_RESET_TRIGGERS.BEIJING_EIGHT_AM), true);
assert.equal(shouldResetGlobalBp(GLOBAL_BP_RESET_TRIGGERS.MANUAL), true);
assert.equal(shouldResetGlobalBp(GLOBAL_BP_RESET_TRIGGERS.FIVE_ROUNDS), true);
assert.equal(shouldResetGlobalBp("roster-change"), false);
assert.equal(shouldResetGlobalBp("player-change"), false);

assert.equal(hasGlobalBpProgress(new Set(), 0), false);
assert.equal(hasGlobalBpProgress(new Set(), 1), true);
assert.deepEqual(nextGlobalBpRound(3), { rounds: 4, cycleComplete: false });
assert.deepEqual(nextGlobalBpRound(4), { rounds: 0, cycleComplete: true });

console.log("global BP tests passed");
