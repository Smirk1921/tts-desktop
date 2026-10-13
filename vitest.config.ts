import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// vitest 配置 — v9-3 首次向导测试（与 vite.config.ts 分离，避免互相牵连 Tauri 专属选项）
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
