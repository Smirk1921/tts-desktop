/**
 * <LayerTiles> 四面状态磁贴 — UI-4 Stage A1（⓪总览右栏，a-deep.html .ftile）
 *
 * 职责：标题「四面状态」+ 四行磁贴（① 代码 / ② 代理 / ③ 卡牌 / ④ 素材），
 *   每行「面名（仿宋）+ 取值（等宽）」，点击 → onNavigate(对应面)。
 * 纯受控展示：全部取值从 OverviewData 派生（本组件不自查、不调 hub）。
 *
 * 四行取值规则（契约 §3，逐条落地）：
 *   ① 代码：diffCount>0 → 红字「N ⇄」（与游戏内不同，--red 唯一语义）；否则「✓ 一致」青
 *   ② 代理：蓝字「● 流水 N」（--blue = 代理活动）
 *   ③ 卡牌：cardCount，未知（null）→「—」
 *   ④ 素材：「N 行」（未知 →「—」）+ deadCount>0 时红字「N✗」（--red = 死链）
 * 符号：⇄ M ✗ ✓ ● 均为已注册字符（§2.4 / 图例条），不引图标库。
 */
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import type { LayerId, OverviewData } from "../state/processStamps";
import "./LayerTiles.css";

export interface LayerTilesProps {
  /** 总览聚合数据（A3 经 useOverviewData 供给） */
  data: OverviewData;
  /** 行点击 → 跳转对应工作面 */
  onNavigate(layer: LayerId): void;
}

/** 取值色调：默认弱色（--wdim）/ 红（差异·死链）/ 蓝（代理活动）/ 青（一致） */
type TileTone = "dim" | "bad" | "blue" | "ok";

interface Tile {
  layer: LayerId;
  label: string;
  tone: TileTone;
  value: ReactNode;
}

/** OverviewData → 四行磁贴（顺序固定 ① 代码 → ④ 素材） */
function buildTiles(data: OverviewData): Tile[] {
  return [
    {
      layer: "code",
      label: "① 代码",
      tone: data.diffCount > 0 ? "bad" : "ok",
      value: data.diffCount > 0 ? `${data.diffCount} ⇄` : "✓ 一致",
    },
    {
      layer: "agent",
      label: "② 代理",
      tone: "blue",
      value: `● 流水 ${data.jobCount}`,
    },
    {
      layer: "cards",
      label: "③ 卡牌",
      tone: "dim",
      value: data.cardCount === null ? "—" : String(data.cardCount),
    },
    {
      layer: "assets",
      label: "④ 素材",
      tone: "dim",
      value: (
        <>
          {data.assetCount === null ? "—" : `${data.assetCount} 行`}
          {data.deadCount > 0 && <span className="layertiles-bad"> {data.deadCount}✗</span>}
        </>
      ),
    },
  ];
}

export default function LayerTiles(props: LayerTilesProps): ReactElement {
  const { data, onNavigate } = props;
  const tiles = buildTiles(data);

  return (
    <section className="layertiles" aria-label="四面状态">
      <div className="layertiles-head">四面状态</div>
      {tiles.map((tile) => (
        <div
          key={tile.layer}
          className="layertiles-tile"
          data-tone={tile.tone}
          role="button"
          tabIndex={0}
          onClick={() => onNavigate(tile.layer)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>): void => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onNavigate(tile.layer);
            }
          }}
        >
          <span className="layertiles-k">{tile.label}</span>
          <span className="layertiles-v tnum">{tile.value}</span>
        </div>
      ))}
    </section>
  );
}
