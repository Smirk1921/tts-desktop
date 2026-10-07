/**
 * HubClient（fetch 版）— UI-1b，施工方案 v0.8.0 §8.5-2
 *
 * 覆盖控制通道全部 16 条 JSON 路由（14 条既有 + /v1/files/read + /v1/files/write，
 * 契约：tts-toolkit/docs/schemas/hub-control.md §4 + v0.8.0 §8.4；接口签名见本窗口任务书）。
 * SSE 不在本类（见 ./sse.ts）——与 tts-toolkit 的 HubClient（src/mcp/client.ts）同构但面向浏览器。
 *
 * 错误约定：所有方法只抛 HubError（./errors.ts）。
 *  - fetch reject / AbortController 超时 / 响应体读取中断 → NETWORK_ERROR（无 httpStatus）
 *  - 非 2xx 且 body 为 {error:{code,message,details?}} → 透传服务端 code / httpStatus / details
 *    （details.userAction 提升为 userAction，appMode==="app" 时 hub 下发）
 *  - 其余（非 2xx body 非标准错误形 / 2xx body 非法 JSON）→ PARSE_ERROR
 *
 * 超时：fetch + AbortController，默认 10s；exec 缺省 30s（Lua timeoutMs 更大时取其 + 5s 余量）。
 */
import { HubError } from "./errors";

/** 控制通道缺省地址（只绑回环，契约 §8） */
export const HUB_BASE_URL = "http://127.0.0.1:39995";
/** 单请求缺省超时（发起请求 + 读取响应体全程） */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** GET /v1/status 响应（hub.version / hub.appMode 为 v0.8.0 新增字段） */
export interface HubStatus {
  ok: boolean;
  hub: {
    editor: number;
    tcpClients: number;
    wsClients: number;
    inprocClients: number;
    startedAt: number;
    uptimeMs: number;
    version: string;
    appMode: "standalone" | "app";
  };
  tts: { connected: boolean; version?: string; objects?: number };
}

/** {ok:true} 通用成功形（save-and-play / shutdown） */
export interface HubOk {
  ok: true;
}

export interface ScriptState {
  name: string;
  guid: string;
  script?: string;
  ui?: string;
}

export interface ExecOptions {
  guid?: string;
  timeoutMs?: number;
}

export interface PushOptions {
  dryRun?: boolean;
  forceScriptsOnly?: boolean;
  skipBackup?: boolean;
  skipBaselineCheck?: boolean;
  backupRetention?: number;
}

export interface TestRunOptions {
  root: string;
  targetGuid?: string;
  timeoutMs?: number;
  bail?: boolean;
  bundle?: boolean;
  include?: string[];
}

export interface PackBuildOptions {
  root: string;
  outPath?: string;
  dryRun?: boolean;
}

export interface SliceOptions {
  sheetPath: string;
  savePath: string;
  outDir: string;
  deckKey?: string;
  deckGuid?: string;
}

export interface ReplaceRule {
  from: string;
  to: string;
  mode?: "exact" | "regex" | "prefix";
}

export interface PlanOptions {
  savePath: string | Record<string, unknown>;
  rules: ReplaceRule[];
}

/** POST /v1/files/read 成功响应 */
export interface FilesReadResult {
  base64: string;
  mime: string;
  size: number;
}

/** PUT /v1/files/write 成功响应 */
export interface FilesWriteResult {
  sha256: string;
  size: number;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

export class HubClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = HUB_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // ---- GET ----

  status(): Promise<HubStatus> {
    return this.request("GET", "/v1/status");
  }

  packs(packsRoot?: string): Promise<unknown> {
    return this.request("GET", "/v1/packs", {
      query: packsRoot ? { packsRoot } : undefined,
    });
  }

  // ---- POST ----

  pullScripts(root: string): Promise<unknown> {
    return this.request("POST", "/v1/scripts/pull", { body: { root } });
  }

  saveAndPlay(scriptStates: ScriptState[]): Promise<HubOk> {
    return this.request("POST", "/v1/scripts/save-and-play", {
      body: { scriptStates },
    });
  }

  exec(lua: string, opts?: ExecOptions): Promise<unknown> {
    return this.request("POST", "/v1/exec", {
      body: { lua, ...(opts ?? {}) },
      // Lua 可能长时间执行：HTTP 超时缺省 30s，随 timeoutMs 放宽 +5s 余量
      timeoutMs: Math.max(30_000, (opts?.timeoutMs ?? 0) + 5_000),
    });
  }

  assetsCheck(urls: string[], timeoutMs?: number): Promise<unknown> {
    return this.request("POST", "/v1/assets/check", {
      body: { urls, timeoutMs },
    });
  }

  deckSlice(opts: SliceOptions): Promise<unknown> {
    return this.request("POST", "/v1/deck/slice", { body: opts });
  }

  deckPlan(opts: PlanOptions): Promise<unknown> {
    return this.request("POST", "/v1/deck/plan", { body: opts });
  }

  importAssets(
    root: string,
    manifestPath: string,
    dryRun?: boolean,
  ): Promise<unknown> {
    return this.request("POST", "/v1/import", {
      body: { root, manifestPath, dryRun },
    });
  }

  diff(root: string): Promise<unknown> {
    return this.request("POST", "/v1/diff", { body: { root } });
  }

  push(root: string, confirm: true, opts?: PushOptions): Promise<unknown> {
    return this.request("POST", "/v1/push", {
      body: { root, confirm, ...(opts ?? {}) },
    });
  }

  testRun(opts: TestRunOptions): Promise<unknown> {
    return this.request("POST", "/v1/test/run", { body: opts });
  }

  packBuild(opts: PackBuildOptions): Promise<unknown> {
    return this.request("POST", "/v1/pack/build", { body: opts });
  }

  shutdown(): Promise<HubOk> {
    return this.request("POST", "/v1/hub/shutdown");
  }

  /** v0.8.0 新增：读 root 内本地文件（≤20MB，防路径穿越）——UI 专用，不加 MCP 工具 */
  filesRead(root: string, path: string): Promise<FilesReadResult> {
    return this.request("POST", "/v1/files/read", { body: { root, path } });
  }

  /** v0.8.0 新增：写 root 内文本文件（≤1MB，baseSha256 乐观锁，不符 409 HUB_CONFLICT） */
  filesWrite(
    root: string,
    path: string,
    content: string,
    baseSha256?: string,
  ): Promise<FilesWriteResult> {
    return this.request("PUT", "/v1/files/write", {
      body: { root, path, content, baseSha256 },
    });
  }

  // ---- 内部 ----

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    init?: { body?: unknown; timeoutMs?: number; query?: Record<string, string> },
  ): Promise<T> {
    const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(init?.query ?? {})) {
      url.searchParams.set(k, v);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers:
          init?.body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      throw new HubError({
        code: "NETWORK_ERROR",
        message: ctrl.signal.aborted
          ? `hub 请求超时（${timeoutMs}ms）：${url.pathname}`
          : `无法连接 hub（${cause}）`,
        details: cause,
      });
    } finally {
      clearTimeout(timer);
    }

    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      throw new HubError({
        code: "NETWORK_ERROR",
        message: `hub 响应体读取中断：${cause}`,
      });
    }

    if (!res.ok) {
      const body = safeParse(text) as ErrorBody | null;
      const err =
        body !== null && typeof body === "object" ? body.error : undefined;
      if (
        err !== undefined &&
        typeof err === "object" &&
        typeof (err as { code?: unknown }).code === "string"
      ) {
        const details = (err as { details?: unknown }).details;
        throw new HubError({
          code: (err as { code: string }).code,
          message:
            typeof (err as { message?: unknown }).message === "string"
              ? (err as { message: string }).message
              : `HTTP ${res.status}`,
          httpStatus: res.status,
          userAction: pickUserAction(details),
          details,
        });
      }
      throw new HubError({
        code: "PARSE_ERROR",
        message: `HTTP ${res.status}：响应体不是标准错误格式`,
        httpStatus: res.status,
        details: text.slice(0, 500),
      });
    }

    const parsed = safeParse(text);
    if (parsed === null) {
      throw new HubError({
        code: "PARSE_ERROR",
        message: `HTTP ${res.status}：响应体不是合法 JSON`,
        httpStatus: res.status,
        details: text.slice(0, 500),
      });
    }
    return parsed as T;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function pickUserAction(details: unknown): string | undefined {
  if (details === null || typeof details !== "object") return undefined;
  const ua = (details as { userAction?: unknown }).userAction;
  return typeof ua === "string" ? ua : undefined;
}
