/**
 * <CardFacePreview> 卡牌面·卡面预览（工作区右下） — UI-3 Stage A2
 *
 * 职责：显示当前选中卡的卡面图。数据经 POST /v1/files/read（hub ≥ 0.8.0，
 * caps.canReadFiles）读 root 内本地文件 → data URL 等比展示；命中 LRU 缓存
 * （./fileCache 的上一级 ../hub/fileCache）则不发请求。
 *
 * 关键设计：
 *  - 数据流：useHub() 取 client；useEffect 监听 [card?.face, root] 变化——
 *    先查缓存，未命中才 useJobTracker().track("POST /v1/files/read", …) 登记
 *    Job 后请求（缓存命中不登记：没有发生 hub 调用）；
 *  - 状态优先级：card 未选中 > 外部 props.error / props.loading（路由层可强制
 *    状态，如 hub 降级提示）> 内部加载 / 错误 > 图片；
 *  - caps.canReadFiles=false 时不发请求，直接提示版本不足（与 Code.tsx 降级
 *    行为一致）；
 *  - 只读展示：无写操作，不经 ConfirmGate（红线 1 不适用）；
 *  - 本组件不判断死链（死链是 SliceGrid / DeadLinkContext 的职责）。
 */
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { SliceCard } from "./SliceGrid";
import { useHub } from "../hub/HubContext";
import { useJobTracker } from "../hub/useJobTracker";
import { getCachedFile, setCachedFile } from "../hub/fileCache";
import "./CardFacePreview.css";

export interface CardFacePreviewProps {
  /** 当前选中卡（undefined = 未选中） */
  card?: SliceCard;
  /** 图包 root，用于 /v1/files/read；null/undefined = 未连接图包 */
  root?: string | null;
  /** 外部强制加载态（路由层传入，优先于内部状态） */
  loading?: boolean;
  /** 外部错误（路由层传入，优先于内部状态） */
  error?: string;
}

/** 已加载的一张卡面（缓存命中 / 请求成功的归一形） */
interface LoadedImage {
  base64: string;
  mime: string;
  size?: number;
}

/** 字节数 → 展示串（B / KB / MB） */
function fmtSize(n: number | undefined): string | null {
  if (n === undefined) return null;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default function CardFacePreview(
  props: CardFacePreviewProps,
): ReactElement {
  const { card, root = null, loading = false, error } = props;
  const { client, caps } = useHub();
  const { track } = useJobTracker();

  const [img, setImg] = useState<LoadedImage | null>(null);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 依赖取原始值：caps 对象引用不稳定时不会误触发重取
  const face = card?.face;
  const canRead = caps.canReadFiles;
  const hubVersion = caps.version;

  useEffect(() => {
    // 未选卡 / 卡无卡面：清空回 idle
    if (face === undefined) {
      setImg(null);
      setErr(null);
      setFetching(false);
      return;
    }
    if (root === null || root === "") {
      setImg(null);
      setFetching(false);
      setErr("未连接图包（root 缺失），无法读取卡面。");
      return;
    }
    if (!canRead) {
      setImg(null);
      setFetching(false);
      setErr(
        `hub ${hubVersion === "" ? "（旧版）" : hubVersion} 无 /v1/files/read 路由（需 ≥ 0.8.0），卡面预览不可用。`,
      );
      return;
    }

    const packRoot = root;
    const path = face;

    // 缓存命中：不发请求、不登记 Job（没有发生 hub 调用）
    const hit = getCachedFile(packRoot, path);
    if (hit !== undefined) {
      setImg({ base64: hit.base64, mime: hit.mime, size: hit.size });
      setErr(null);
      setFetching(false);
      return;
    }

    let cancelled = false;
    setImg(null);
    setErr(null);
    setFetching(true);
    void (async () => {
      try {
        const res = await track("POST /v1/files/read", `path=${path}`, () =>
          client.filesRead(packRoot, path),
        );
        if (cancelled) return;
        setCachedFile(packRoot, path, res.base64, res.mime);
        setImg({ base64: res.base64, mime: res.mime, size: res.size });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [face, root, canRead, hubVersion, client, track]);

  // ---- 渲染状态机（优先级见文件头） ----
  let body: ReactElement;
  if (card === undefined) {
    body = <div className="cardface-empty">— 选择卡牌</div>;
  } else if (error !== undefined && error !== "") {
    body = <div className="cardface-error">✗ {error}</div>;
  } else if (loading) {
    body = <div className="cardface-loading">◌ 加载卡面…</div>;
  } else if (face === undefined) {
    body = <div className="cardface-empty">— 无卡面文件</div>;
  } else if (err !== null) {
    body = <div className="cardface-error">✗ {err}</div>;
  } else if (fetching) {
    body = <div className="cardface-loading">◌ 加载卡面…</div>;
  } else if (img !== null) {
    body = (
      <img
        className="cardface-img"
        src={`data:${img.mime};base64,${img.base64}`}
        alt={card.name ?? card.face ?? "卡面"}
      />
    );
  } else {
    body = <div className="cardface-empty">— 选择卡牌</div>;
  }

  const sizeText = fmtSize(img?.size);

  return (
    <section className="cardface" aria-label="卡面预览">
      <div className="cardface-stage">{body}</div>
      <div className="cardface-meta">
        <span className="cardface-meta-name">{card?.name ?? "—"}</span>
        {card?.face !== undefined && (
          <span className="cardface-meta-path" title={card.face}>
            {card.face}
          </span>
        )}
        {sizeText !== null && (
          <span className="cardface-meta-size tnum">{sizeText}</span>
        )}
      </div>
    </section>
  );
}
