import { useState } from "react";

export type DateRangePrefix = "history" | "rank" | "adminMatch";
type DateRangeValue = "all" | "7" | "30" | "custom";

export function DateRangeFilters({ prefix }: { prefix: DateRangePrefix }) {
  const [range, setRange] = useState<DateRangeValue>("all");
  const customRange = range === "custom";

  return (
    <>
      <select
        id={`${prefix}Range`}
        value={range}
        onChange={(event) => setRange(event.currentTarget.value as DateRangeValue)}
      >
        <option value="all">全部时间</option>
        <option value="7">最近 1 周</option>
        <option value="30">最近 30 天</option>
        <option value="custom">自定义</option>
      </select>
      <input className={customRange ? undefined : "hidden"} id={`${prefix}From`} type="date" aria-label="开始日期" />
      <input className={customRange ? undefined : "hidden"} id={`${prefix}To`} type="date" aria-label="结束日期" />
    </>
  );
}
