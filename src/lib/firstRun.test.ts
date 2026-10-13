/**
 * firstRun.test.ts — 首次启动检测测试（v9-3 Stage A 任务 A2）
 * vitest 环境（jsdom）= 非 Tauri 分支：验证 localStorage 回退契约。
 * Tauri 分支（plugin-fs 真 appConfigDir）无法在 vitest 内覆盖，交由
 * v9-4 真实应用验收（施工方案 §6.4：二次启动不再显示向导）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isFirstRun, markFirstRunDone, FIRST_RUN_FLAG_FILENAME } from "./firstRun";

// 强制 firstRun.ts 走非 Tauri 分支（jsdom 无 @tauri-apps/api/core 注入，isTauri 本就 false，
// 显式 mock 以防 vitest 环境未来变化导致测试漂移）
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

describe("firstRun（非 Tauri 回退分支）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("isFirstRun：localStorage 无标记 → true（首次）", async () => {
    expect(await isFirstRun()).toBe(true);
  });

  it("markFirstRunDone 后 isFirstRun → false", async () => {
    await markFirstRunDone();
    expect(localStorage.getItem("tts.firstRun.done")).toBe("1");
    expect(await isFirstRun()).toBe(false);
  });

  it("红线：flag 文件名必须是「首次向导.flag」（施工方案钦定）", () => {
    expect(FIRST_RUN_FLAG_FILENAME).toBe("首次向导.flag");
  });
});
