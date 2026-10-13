/**
 * App.test.tsx — App.tsx 首次向导接线测试（v9-3 Stage B1）
 *
 * vitest（jsdom）= 非 Tauri 分支：firstRun 走 localStorage 回退、plugin-dialog /
 * opener / path 全部 vi.mock（A2 firstRun.test.ts 同一约定——强制 isTauri:false 防漂移）。
 * global fetch 统一 stub 500：HubLauncher 的 probeHttp 必失败 → 稳定落在 guide 态
 * （不靠真实 127.0.0.1:39995 连接拒绝的时序），用例只验证 HubLauncher 已挂载。
 *
 * Tauri 真实分支（flag 文件 / resolveResource / 原生 dialog）无法在 vitest 覆盖，
 * 留待 v9-4 真机验收（施工方案 §6.4）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// —— 模块级 mock（须在 import App 之前；vi.mock 会提升，mock 函数在工厂内创建，
//    测试内经 vi.mocked(导入) 取回句柄——避免工厂引用未初始化的顶层变量）——

// firstRun：非 Tauri 分支（localStorage），与 firstRun.test.ts 同约定
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

// path：resolveResource / documentDir / join / dirname / basename
// （jsdom 无 Tauri IPC，这两个测试用例也不触达真实路径层）
vi.mock("@tauri-apps/api/path", () => ({
  resolveResource: vi.fn(async (p: string) => `C:\\res\\${p}`),
  documentDir: vi.fn(async () => "C:\\Users\\u\\Documents"),
  join: vi.fn(async (...parts: string[]) => parts.join("\\")),
  dirname: vi.fn(async (p: string) => p.split("\\").slice(0, -1).join("\\")),
  basename: vi.fn(async (p: string) => p.split("\\").pop() ?? p),
}));

// plugin-dialog：open 返回「用户选中的解开目录」（各用例可覆盖返回值）
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => "C:\\Users\\u\\Documents\\tts-packs\\sample"),
}));

// plugin-opener：记录教程链接
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

// hub client：importTtsmod 直接 spy（避免真实 fetch 路由分支）；status 走 fetch stub
vi.mock("./hub/HubContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("./hub/HubContext")>();
  return {
    ...original,
    hubClient: {
      status: vi.fn(async () => {
        throw new Error("status not expected in these tests");
      }),
      importTtsmod: vi.fn(async () => ({
        ok: true as const,
        warnings: [],
        objectsImported: 3,
      })),
    },
  };
});

import App from "./App";
import { hubClient } from "./hub/HubContext";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

const openMock = vi.mocked(open);
const openUrlMock = vi.mocked(openUrl);

/** userEvent.click 需要先 await 检测完成的 loading 态消失 */
async function renderApp(): Promise<void> {
  render(<App />);
  await waitFor(() => {
    // loading 态（role=status）消失 = firstRun 检测已定
    expect(screen.queryByRole("status", { name: /启动/ })).toBeNull();
  });
}

/** firstRun=false 后 HubLauncher 已挂载且落在 guide 态（fetch stub 500 → probeHttp 必失败，确定性） */
async function expectHubLauncherGuide(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText(/请在终端先启动/)).toBeInTheDocument();
  });
}

beforeEach(() => {
  localStorage.clear();
  // probeHttp 的 fetch 一律 500：HubLauncher 稳定走 guide 态，不依赖真实端口拒绝时序
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  openMock.mockClear();
  openUrlMock.mockClear();
  vi.mocked(hubClient.importTtsmod).mockClear();
  vi.mocked(hubClient.status).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App 首次向导接线（Stage B1）", () => {
  it("首次启动（无标记）→ 渲染向导，跳过后进入 HubLauncher 并写 localStorage 标记", async () => {
    const user = userEvent.setup();
    await renderApp();
    // 向导面板出现（aria-label 与 FirstRunWizard PANEL_LABEL 一致）
    expect(screen.getByRole("dialog", { name: "首次启动向导" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "跳过，直接进入" }));

    await expectHubLauncherGuide();
    expect(localStorage.getItem("tts.firstRun.done")).toBe("1");
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(hubClient.importTtsmod).not.toHaveBeenCalled();
  });

  it("'tutorial' 分支：openUrl 打开 README 快速上手锚点 + 标记完成 + 进 HubLauncher", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("radio", { name: "查看 5 分钟上手教程" }));
    await user.click(screen.getByRole("button", { name: "开始" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://github.com/Smirk1921/tts-desktop#快速上手",
      );
    });
    expect(localStorage.getItem("tts.firstRun.done")).toBe("1");
    await expectHubLauncherGuide();
  });

  it("'example' 分支：resolveResource → open 目录 → importTtsmod(modsParentDir, modSaveLocation) → 提示条 → 进入 HubLauncher", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "开始" }));

    // resolveResource 拿打包内示例图包、open 弹目录选择（B1 任务书三步链路）
    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1);
    });
    expect(openMock.mock.calls[0]?.[0]).toMatchObject({
      directory: true,
      defaultPath: "C:\\Users\\u\\Documents\\tts-packs\\sample",
    });
    // 请求体契约（hub-control.md §4.17）：modsParentDir=选目录父目录、modSaveLocation=选目录名
    // （file = resolveResource 原样返回值，mock 拼接保留资源路径自身的 `/` 分隔符）
    await waitFor(() => {
      expect(hubClient.importTtsmod).toHaveBeenCalledWith(
        "C:\\res\\resources/examples/sample.ttsmod",
        "C:\\Users\\u\\Documents\\tts-packs",
        "sample",
      );
    });
    // busy 态出现（禁重按）后到完成提示条
    expect(await screen.findByText(/示例图包已解开到/)).toBeInTheDocument();
    expect(screen.getByText(/3 个文件/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "进入工作台" }));
    await expectHubLauncherGuide();
    expect(localStorage.getItem("tts.firstRun.done")).toBe("1");
  });

  it("'example' 取消选目录：留在向导页、不写标记、不导入", async () => {
    openMock.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "开始" }));

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1);
    });
    // 取消后回到向导（面板仍在）
    expect(await screen.findByRole("dialog", { name: "首次启动向导" })).toBeInTheDocument();
    expect(hubClient.importTtsmod).not.toHaveBeenCalled();
    expect(localStorage.getItem("tts.firstRun.done")).toBeNull();
  });

  it("导入失败：错误提示条 + 「返回向导重试」回到向导、不写标记", async () => {
    vi.mocked(hubClient.importTtsmod).mockRejectedValueOnce(
      new Error("fetch failed"),
    );
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "开始" }));
    // 提示条出现（aria-label 精确定位，正文 /导入失败/ 与标题重复会命中双元素）
    expect(
      await screen.findByRole("alertdialog", { name: "导入失败" }),
    ).toBeInTheDocument();
    // 非 HubError 的普通异常走兜底文案（isHubError 分支的 hub 文案透传由 buildImportErrorText 分支覆盖）
    expect(screen.getByText(/导入失败：/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回向导重试" }));
    expect(await screen.findByRole("dialog", { name: "首次启动向导" })).toBeInTheDocument();
    expect(localStorage.getItem("tts.firstRun.done")).toBeNull();
  });

  it("二次启动（标记存在）→ 不出向导，直接 HubLauncher", async () => {
    localStorage.setItem("tts.firstRun.done", "1");
    await renderApp();
    await expectHubLauncherGuide();
    expect(screen.queryByRole("dialog", { name: "首次启动向导" })).toBeNull();
  });
});
