/**
 * HubError — UI-1b 唯一错误类型（施工方案 v0.8.0 §8.5-3，审批意见 §8）
 *
 * 约定：UI 组件只 catch 这一种。hub 侧错误（4xx/5xx 响应体 {error:{code,message,details?}}）
 * 原样透传 code / httpStatus / details；网络层失败统一归 NETWORK_ERROR；响应体不合规归 PARSE_ERROR。
 *
 * code 取值（非封闭联合：服务端新码透传不截断）：
 *  - 服务端：HUB_BAD_REQUEST / HUB_CONFLICT / HUB_PATH_ESCAPE / HUB_FILE_TOO_LARGE /
 *           HUB_NOT_FOUND / HUB_METHOD_NOT_ALLOWED / HUB_PAYLOAD_TOO_LARGE /
 *           HUB_UNSUPPORTED_MEDIA_TYPE / HUB_CONFIRM_REQUIRED / HUB_PACK_ERROR /
 *           HUB_LUA_ERROR / HUB_INTERNAL_ERROR / ...
 *  - 客户端：NETWORK_ERROR（fetch reject / 超时中止 / 响应体读取中断）、PARSE_ERROR（响应体不合规）
 */
export class HubError extends Error {
  /** 机器可读错误码（服务端透传或客户端分类，见模块头注释） */
  readonly code: string;
  /** HTTP 状态码；网络层失败（NETWORK_ERROR）时缺省 */
  readonly httpStatus?: number;
  /** appMode === "app" 时 hub 随 details.userAction 下发的用户可操作提示 */
  readonly userAction?: string;
  /** 错误细节（hub 的 details 原样；客户端补充时为 string 摘要） */
  readonly details?: unknown;

  constructor(init: {
    code: string;
    message: string;
    httpStatus?: number;
    userAction?: string;
    details?: unknown;
  }) {
    super(init.message);
    this.name = "HubError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.userAction = init.userAction;
    this.details = init.details;
  }
}

/** 类型守卫：UI 组件 `catch (e) { if (isHubError(e)) ... }` */
export function isHubError(e: unknown): e is HubError {
  return e instanceof HubError;
}
