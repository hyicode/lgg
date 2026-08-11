export const GLOBAL_BP_RESET_TRIGGERS = {
  BEIJING_EIGHT_AM: "beijing-eight-am",
  MANUAL: "manual",
  FIVE_ROUNDS: "five-rounds",
} as const;

const ALLOWED_RESET_TRIGGERS = new Set<string>(Object.values(GLOBAL_BP_RESET_TRIGGERS));

export function shouldResetGlobalBp(trigger: string) {
  return ALLOWED_RESET_TRIGGERS.has(trigger);
}

export function beijingBpDayKey(now = new Date()) {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  if (beijing.getUTCHours() < 8) {
    beijing.setUTCDate(beijing.getUTCDate() - 1);
  }
  return [
    beijing.getUTCFullYear(),
    String(beijing.getUTCMonth() + 1).padStart(2, "0"),
    String(beijing.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function hasGlobalBpProgress(used: Set<string>, rounds: number) {
  return used.size > 0 || rounds > 0;
}

export function nextGlobalBpRound(rounds: number) {
  const nextRounds = Math.max(0, Math.trunc(Number(rounds) || 0)) + 1;
  return {
    rounds: nextRounds >= 5 ? 0 : nextRounds,
    cycleComplete: nextRounds >= 5,
  };
}
