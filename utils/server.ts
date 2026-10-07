import type { NeedLevel } from "~/stores/assessment";

/** 参与离线字段级合并的字段（不含 status/version 等元信息） */
export const MERGE_FIELDS = ["head", "community", "address", "members", "vulnerable", "needLevel", "needs", "note"] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export interface ServerHousehold {
  id: string;
  version: number;
  head: string;
  community: string;
  address: string;
  members: number;
  vulnerable: string[];
  needLevel: NeedLevel;
  needs: string[];
  note: string;
}

/**
 * 服务端当前状态（模拟）：
 * - h1 已被对方评估员离线更新（地址、现场说明），当前版本 v3
 * - h2 与本机基线一致，无改动
 * - h3 是重复登记，服务端已并入保留记录 h1
 */
const serverHouseholds: Record<string, ServerHousehold> = {
  h1: { id: "h1", version: 3, head: "王建国", community: "河湾社区", address: "河湾路18号2栋2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], note: "一层受淹，老人行动不便；已发放应急食品" },
  h2: { id: "h2", version: 1, head: "赵敏", community: "新城社区", address: "新城三街9号", members: 2, vulnerable: [], needLevel: "一般", needs: ["饮用水"], note: "饮水库存不足" }
};

/** 服务端已完成的重复合并：被并入记录 id → 保留记录 id */
const serverMerges: Record<string, string> = { h3: "h1" };

export function fetchServerState(): { households: Record<string, ServerHousehold>; merges: Record<string, string>; fetchedAt: string } {
  return { households: { ...serverHouseholds }, merges: { ...serverMerges }, fetchedAt: new Date().toISOString() };
}
