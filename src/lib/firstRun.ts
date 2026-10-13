/**
 * firstRun.ts — 首次启动检测（施工方案 v0.9.0 §6.2 任务 7/11）
 *
 * 契约（施工方案钦定）：
 *  - 标记文件名必须是 `首次向导.flag`，位于 appConfigDir()（Tauri app config 目录）
 *  - isFirstRun()：文件不存在 = 首次启动（true）
 *  - markFirstRunDone()：写空文件 `首次向导.flag`（注意：是"写标记"，与方案 §6.2 任务 11
 *    的"删除"语义相反——以任务书 A2 钦定的"写文件"契约为准，Stage B1 挂载时读检测）
 *  - 非 Tauri 环境（纯浏览器 dev / vitest）：回退 localStorage
 *    `tts.firstRun.done !== '1'` / `localStorage.setItem('tts.firstRun.done', '1')`
 *
 * 红线：不硬编码 appConfigDir 路径——一律经 @tauri-apps/api/path 的 appConfigDir() 动态取。
 */
import { isTauri } from "@tauri-apps/api/core";
import { appConfigDir } from "@tauri-apps/api/path";
import { exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";

/** 首次向导标记文件名（施工方案 §6.2 任务 7 钦定，不得改动） */
export const FIRST_RUN_FLAG_FILENAME = "首次向导.flag";

/** 非 Tauri 环境的 localStorage 键 */
const LOCALSTORAGE_KEY = "tts.firstRun.done";

/**
 * 是否首次启动。
 * Tauri：appConfigDir() 下 `首次向导.flag` 不存在 → true；
 * 非 Tauri（dev / vitest）：localStorage `tts.firstRun.done` !== '1' → true。
 * 检测失败（异常）按"是首次"处理——宁可多显示一次向导，不可错过首次引导。
 */
export async function isFirstRun(): Promise<boolean> {
  if (!isTauri()) {
    return localStorage.getItem(LOCALSTORAGE_KEY) !== "1";
  }
  try {
    const dir = await appConfigDir();
    return !(await exists(`${dir}${FIRST_RUN_FLAG_FILENAME}`));
  } catch {
    return true;
  }
}

/** 标记首次向导已完成：Tauri 写空文件 `<appConfigDir>/首次向导.flag`；非 Tauri 写 localStorage */
export async function markFirstRunDone(): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(LOCALSTORAGE_KEY, "1");
    return;
  }
  const dir = await appConfigDir();
  // 目录可能不存在（首次运行）：createDir 递归补齐后写空文件
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}${FIRST_RUN_FLAG_FILENAME}`, new Uint8Array());
}
