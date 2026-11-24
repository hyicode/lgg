import { useRef, useState } from "react";
import { emptyBackup, LOCAL_DATA_KEY, readLocalBackup, saveLocalBackup, validateBackup } from "../data/localStore";

function download(text: string, label: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LocalBackupControls() {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  function exportData() {
    try {
      // Preserve even malformed data so the user can recover it offline.
      download(localStorage.getItem(LOCAL_DATA_KEY) ?? JSON.stringify(emptyBackup(), null, 2), "lgg-backup");
      setMessage("已导出当前浏览器数据。");
    } catch { setMessage("无法访问浏览器存储，导出失败。"); }
  }
  async function importData(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("文件超过 30 MB，请先检查备份内容。");
      const backup = validateBackup(JSON.parse(await file.text()));
      const current = readLocalBackup();
      const hasData = current.tables.players.length || current.tables.matches.length || current.tables.riot_accounts.length;
      if (!window.confirm(`导入 ${backup.tables.players.length} 名选手、${backup.tables.matches.length} 场比赛。${hasData ? "将替换当前浏览器数据；替换前会自动下载旧备份。" : "仅保存到当前浏览器。"}`)) return;
      if (hasData) download(JSON.stringify(current, null, 2), "lgg-before-import");
      saveLocalBackup(backup);
      setMessage(`导入成功：${backup.tables.players.length} 名选手、${backup.tables.matches.length} 场比赛。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "导入失败，原数据保持不变。");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section className="local-backup-panel" aria-label="本地数据备份">
      <p>游客模式 · 数据仅保存在当前浏览器，不自动同步。清理浏览器数据前请导出备份。</p>
      <div className="toolbar-actions">
        <button className="mini" type="button" onClick={exportData} disabled={busy}>导出数据</button>
        <button className="mini" type="button" onClick={() => input.current?.click()} disabled={busy}>{busy ? "导入中…" : "导入数据"}</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => void importData(event.currentTarget.files?.[0])} />
      </div>
      <div role="status">{message}</div>
    </section>
  );
}
