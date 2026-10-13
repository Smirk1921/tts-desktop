/**
 * FirstRunWizard.test.tsx — 首次向导组件测试（v9-3 Stage A 任务 A2）
 * 覆盖任务钦定五项：默认选中 example / 切换 radio / 回车携带当前选中 / 开始 / 跳过；
 * 另加一条红线验证：施工方案钦定的 flag 文件名必须是「首次向导.flag」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FirstRunWizard from "./FirstRunWizard";
import type { FirstRunChoice } from "./FirstRunWizard";
import { FIRST_RUN_FLAG_FILENAME } from "../lib/firstRun";

/** onDone 回调 mock（vitest 5：vi.fn 单泛型，运行期再断言实参） */
function makeOnDone(): (choice: FirstRunChoice) => void {
  return vi.fn((_choice: FirstRunChoice) => undefined);
}

describe("FirstRunWizard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("默认选中「打开示例图包」（example）", () => {
    render(<FirstRunWizard onDone={() => {}} />);
    const example = screen.getByRole("radio", { name: "打开示例图包（推荐新手）" });
    const existing = screen.getByRole("radio", { name: "打开现有图包" });
    const tutorial = screen.getByRole("radio", { name: "查看 5 分钟上手教程" });
    expect(example).toBeChecked();
    expect(existing).not.toBeChecked();
    expect(tutorial).not.toBeChecked();
  });

  it("切换 radio 到 existing / tutorial", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    const existing = screen.getByRole("radio", { name: "打开现有图包" });
    const tutorial = screen.getByRole("radio", { name: "查看 5 分钟上手教程" });
    await user.click(existing);
    expect(existing).toBeChecked();
    await user.click(tutorial);
    expect(tutorial).toBeChecked();
    expect(existing).not.toBeChecked();
  });

  it("回车触发 onDone 且携带当前选中项", async () => {
    const user = userEvent.setup();
    const onDone = makeOnDone();
    render(<FirstRunWizard onDone={onDone} />);

    // 默认 example：回车 → example
    await user.keyboard("{Enter}");
    expect(onDone).toHaveBeenLastCalledWith("example");

    // 切到 tutorial：回车 → tutorial
    await user.click(screen.getByRole("radio", { name: "查看 5 分钟上手教程" }));
    await user.keyboard("{Enter}");
    expect(onDone).toHaveBeenLastCalledWith("tutorial");
  });

  it("点击「开始」触发 onDone(当前选中)", async () => {
    const user = userEvent.setup();
    const onDone = makeOnDone();
    render(<FirstRunWizard onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: "开始" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("example");

    // 切到 existing 再点开始 → existing
    await user.click(screen.getByRole("radio", { name: "打开现有图包" }));
    await user.click(screen.getByRole("button", { name: "开始" }));
    expect(onDone).toHaveBeenLastCalledWith("existing");
  });

  it("点击「跳过，直接进入」触发 onDone('skip')", async () => {
    const user = userEvent.setup();
    const onDone = makeOnDone();
    render(<FirstRunWizard onDone={onDone} />);

    await user.click(screen.getByRole("button", { name: "跳过，直接进入" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("skip");
  });

  it("红线：施工方案钦定的 flag 文件名必须是「首次向导.flag」", () => {
    expect(FIRST_RUN_FLAG_FILENAME).toBe("首次向导.flag");
  });
});
