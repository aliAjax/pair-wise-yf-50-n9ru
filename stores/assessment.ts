import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { fetchServerState, MERGE_FIELDS, type MergeField, type ServerHousehold } from "~/utils/server";

export type HouseholdStatus = "待评估" | "待复核" | "已分派" | "已完成";
export type NeedLevel = "紧急" | "高" | "一般";
export type TaskStatus = "待接收" | "待复核" | "进行中" | "已完成";

export interface HouseholdBaseline {
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

export interface Household {
  id: string;
  head: string;
  community: string;
  address: string;
  members: number;
  vulnerable: string[];
  needLevel: NeedLevel;
  needs: string[];
  status: HouseholdStatus;
  version: number;
  /** 本机基线版本：上次回传时服务端确认的版本号 */
  baselineVersion: number;
  /** 本机基线快照：上次回传时各字段的服务端值，用于离线字段级三方合并 */
  baseline: HouseholdBaseline;
  deviceUpdatedAt: string;
  note: string;
}

export interface FieldTask {
  id: string;
  householdId: string;
  title: string;
  assignee: string;
  priority: NeedLevel;
  status: TaskStatus;
  /** 冲突挂起前的任务状态，冲突处理完后据此恢复 */
  heldFrom?: Exclude<TaskStatus, "待复核">;
  due: string;
}

export interface PendingChange {
  id: string;
  entity: string;
  action: string;
  detail: string;
  time: string;
}

export interface FieldConflict {
  id: string;
  householdId: string;
  field: MergeField;
  baseValue: string;
  localValue: string;
  remoteValue: string;
  status: "待处理" | "采用本地" | "采用远端";
}

const KEY = "pair-wise-yf-50/assessment";

function snapshotOf(household: Household): HouseholdBaseline {
  return {
    version: household.version,
    head: household.head,
    community: household.community,
    address: household.address,
    members: household.members,
    vulnerable: [...household.vulnerable],
    needLevel: household.needLevel,
    needs: [...household.needs],
    note: household.note
  };
}

function emptyBaseline(): HouseholdBaseline {
  return { version: 0, head: "", community: "", address: "", members: 1, vulnerable: [], needLevel: "一般", needs: [], note: "" };
}

function displayValue(field: MergeField, value: string | number | string[]): string {
  if (Array.isArray(value)) return value.length ? value.join("、") : "（无）";
  return String(value);
}

function splitList(raw: string): string[] {
  return raw.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
}

function isMergeField(key: string): key is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(key);
}

function equalValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => value === b[index]);
  return a === b;
}

/** 把字符串/数组形式的合并值按字段类型写回记录 */
function applyFieldValue(household: Household, field: MergeField, raw: string | number | string[]) {
  switch (field) {
    case "members":
      household.members = Number(raw) || 1;
      break;
    case "vulnerable":
      household.vulnerable = Array.isArray(raw) ? raw : splitList(String(raw));
      break;
    case "needs":
      household.needs = Array.isArray(raw) ? raw : splitList(String(raw));
      break;
    default:
      (household as unknown as Record<string, unknown>)[field] = Array.isArray(raw) ? raw.join("、") : String(raw);
  }
}

const seedBaseline = (over: Partial<HouseholdBaseline> & { version: number }): HouseholdBaseline => ({
  version: over.version,
  head: over.head ?? "",
  community: over.community ?? "",
  address: over.address ?? "",
  members: over.members ?? 1,
  vulnerable: over.vulnerable ?? [],
  needLevel: over.needLevel ?? "一般",
  needs: over.needs ?? [],
  note: over.note ?? ""
});

const seedHouseholds: Household[] = [
  { id: "h1", head: "王建国", community: "河湾社区", address: "河湾路18号2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], status: "待复核", version: 3, baselineVersion: 2, baseline: seedBaseline({ version: 2, head: "王建国", community: "河湾社区", address: "河湾路18号2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], note: "一层受淹，老人行动不便" }), deviceUpdatedAt: new Date(Date.now() - 12 * 60000).toISOString(), note: "一层受淹，老人行动不便；左侧房屋倾斜" },
  { id: "h2", head: "赵敏", community: "新城社区", address: "新城三街9号", members: 2, vulnerable: [], needLevel: "一般", needs: ["饮用水"], status: "已分派", version: 1, baselineVersion: 1, baseline: seedBaseline({ version: 1, head: "赵敏", community: "新城社区", address: "新城三街9号", members: 2, vulnerable: [], needLevel: "一般", needs: ["饮用水"], note: "饮水库存不足" }), deviceUpdatedAt: new Date(Date.now() - 35 * 60000).toISOString(), note: "饮水库存不足" },
  { id: "h3", head: "王建国", community: "河湾社区", address: "河湾路18号2幢2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], status: "待评估", version: 1, baselineVersion: 1, baseline: seedBaseline({ version: 1, head: "王建国", community: "河湾社区", address: "河湾路18号2幢2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], note: "疑似重复登记" }), deviceUpdatedAt: new Date().toISOString(), note: "疑似重复登记" }
];

const seedTasks: FieldTask[] = [
  { id: "k1", householdId: "h2", title: "配送饮用水", assignee: "后勤二组", priority: "一般", status: "进行中", due: "2026-09-29 16:00" },
  { id: "k2", householdId: "h1", title: "入户复核", assignee: "救援一组", priority: "紧急", status: "进行中", due: "2026-09-30 10:00" },
  { id: "k3", householdId: "h3", title: "摸排登记", assignee: "救援一组", priority: "紧急", status: "待接收", due: "2026-09-30 11:00" }
];

export const useAssessmentStore = defineStore("assessment", () => {
  const initial = typeof window !== "undefined" && localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY)!) : null;
  const households = ref<Household[]>(initial?.households ?? seedHouseholds);
  const tasks = ref<FieldTask[]>(initial?.tasks ?? seedTasks);
  const queue = ref<PendingChange[]>(initial?.queue ?? []);
  const conflicts = ref<FieldConflict[]>(initial?.conflicts ?? []);
  const online = ref(true);
  const lastSyncedAt = ref(initial?.lastSyncedAt ?? new Date().toISOString());
  const syncing = ref(false);

  const metrics = computed(() => ({
    households: households.value.length,
    urgent: households.value.filter((item) => item.needLevel === "紧急").length,
    openTasks: tasks.value.filter((item) => item.status !== "已完成").length,
    queued: queue.value.length
  }));

  const duplicates = computed(() => {
    const groups = new Map<string, Household[]>();
    households.value.forEach((household) => {
      const key = `${household.head}-${household.community}`;
      groups.set(key, [...(groups.get(key) ?? []), household]);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  });

  function enqueue(entity: string, action: string, detail: string) {
    queue.value.unshift({ id: crypto.randomUUID(), entity, action, detail, time: new Date().toISOString() });
  }

  function addHousehold(input: Omit<Household, "id" | "status" | "version" | "baselineVersion" | "baseline" | "deviceUpdatedAt">) {
    households.value.unshift({ ...input, id: crypto.randomUUID(), status: "待评估", version: 1, baselineVersion: 0, baseline: emptyBaseline(), deviceUpdatedAt: new Date().toISOString() });
    enqueue("家庭需求记录", "新增", input.head);
  }

  function updateHousehold(id: string, patch: Partial<Household>) {
    const household = households.value.find((item) => item.id === id);
    if (!household) return;
    Object.assign(household, patch, { version: household.version + 1, deviceUpdatedAt: new Date().toISOString() });
    enqueue("家庭需求记录", "修改", `${household.head}：${Object.keys(patch).join("、")}`);
  }

  function mergeDuplicate(sourceId: string, targetId: string) {
    const source = households.value.find((item) => item.id === sourceId);
    const target = households.value.find((item) => item.id === targetId);
    if (!source || !target) return;
    target.needs = Array.from(new Set([...target.needs, ...source.needs]));
    target.vulnerable = Array.from(new Set([...target.vulnerable, ...source.vulnerable]));
    target.note = `${target.note}；已合并重复记录 ${source.address}`;
    target.version += 1;
    // 名下任务分派随记录一并迁移到保留户
    tasks.value.forEach((task) => {
      if (task.householdId === sourceId) task.householdId = targetId;
    });
    households.value = households.value.filter((item) => item.id !== sourceId);
    enqueue("重复记录", "合并", `${source.head} → ${target.address}`);
  }

  function heldHouseholdIds(): Set<string> {
    return new Set(conflicts.value.filter((item) => item.status === "待处理").map((item) => item.householdId));
  }

  /** 冲突未处理完：该户任务分派停在「待复核」；处理完再恢复原状态 */
  function applyTaskHolds() {
    const held = heldHouseholdIds();
    for (const task of tasks.value) {
      if (held.has(task.householdId)) {
        if (task.status !== "待复核" && task.status !== "已完成") {
          task.heldFrom = task.status;
          task.status = "待复核";
        }
      } else if (task.status === "待复核") {
        task.status = task.heldFrom ?? "待接收";
        task.heldFrom = undefined;
      }
    }
  }

  function addTask(input: Omit<FieldTask, "id" | "status" | "heldFrom">) {
    const held = heldHouseholdIds().has(input.householdId);
    tasks.value.unshift({ ...input, id: crypto.randomUUID(), status: held ? "待复核" : "待接收", heldFrom: held ? "待接收" : undefined });
    const household = households.value.find((item) => item.id === input.householdId);
    if (household && household.status !== "已完成") household.status = "已分派";
    enqueue("任务", "分派", `${input.title} / ${input.assignee}${held ? "（冲突待处理，任务停在待复核）" : ""}`);
  }

  function advanceTask(id: string) {
    const task = tasks.value.find((item) => item.id === id);
    if (!task || task.status === "待复核") return;
    task.status = task.status === "待接收" ? "进行中" : "已完成";
    if (task.status === "已完成") {
      const open = tasks.value.some((item) => item.householdId === task.householdId && item.status !== "已完成");
      const household = households.value.find((item) => item.id === task.householdId);
      if (household && !open) household.status = "已完成";
    }
    enqueue("任务", "状态流转", `${task.title} → ${task.status}`);
  }

  function pushConflict(householdId: string, field: MergeField, base: string | number | string[], local: string | number | string[], remote: string | number | string[]): boolean {
    const exists = conflicts.value.some((item) => item.householdId === householdId && item.field === field && item.status === "待处理");
    if (exists) return false;
    conflicts.value.unshift({ id: crypto.randomUUID(), householdId, field, baseValue: displayValue(field, base), localValue: displayValue(field, local), remoteValue: displayValue(field, remote), status: "待处理" });
    return true;
  }

  /**
   * 离线回传：先取服务端当前版本，再按字段三方合并（基线 / 本机 / 服务端）。
   * - 仅本机改过：回传本机值
   * - 仅服务端改过：采用服务端值
   * - 双方都改且不一致：结成待处理冲突，先不入库
   * - 服务端已并入保留记录：本机改动落到保留户，任务一并迁移
   */
  function syncChanges(): { merged: number; conflicts: number } {
    if (syncing.value) return { merged: 0, conflicts: 0 };
    syncing.value = true;
    const server = fetchServerState();
    let merged = 0;
    let newConflicts = 0;
    const removedIds: string[] = [];

    for (const local of [...households.value]) {
      const remote: ServerHousehold | undefined = server.households[local.id];
      const retainedId = server.merges[local.id];

      if (remote) {
        for (const field of MERGE_FIELDS) {
          const base = local.baseline[field];
          const cur = local[field];
          const srv = remote[field];
          const localChanged = !equalValue(cur, base);
          const remoteChanged = !equalValue(srv, base);
          if (localChanged && remoteChanged && !equalValue(cur, srv)) {
            if (pushConflict(local.id, field, base, cur, srv)) newConflicts += 1;
          } else if (remoteChanged && !localChanged) {
            applyFieldValue(local, field, srv);
            merged += 1;
          } else if (localChanged && !remoteChanged) {
            merged += 1;
          }
        }
        local.baseline = snapshotOf(local);
        local.baselineVersion = remote.version;
        local.version = remote.version;
        enqueue("家庭需求记录", "字段合并", `${local.head}：自动合并 ${merged} 项`);
      } else if (retainedId) {
        const retained = households.value.find((item) => item.id === retainedId);
        for (const field of MERGE_FIELDS) {
          const base = local.baseline[field];
          const cur = local[field];
          if (!equalValue(cur, base)) {
            if (retained && equalValue(retained[field], base)) {
              // 服务端未动该字段：本机改动落到保留户
              applyFieldValue(retained, field, cur);
              merged += 1;
            } else if (retained) {
              // 保留户也改过同一字段：在保留户上结成冲突
              if (pushConflict(retained.id, field, base, cur, retained[field])) newConflicts += 1;
            }
          }
        }
        // 名下任务分派一并迁移到保留户
        tasks.value.forEach((task) => {
          if (task.householdId === local.id) task.householdId = retainedId;
        });
        removedIds.push(local.id);
        enqueue("重复记录", "服务端合并迁移", `${local.head} → 保留记录 ${retainedId}`);
      } else {
        // 本机新增、服务端尚无记录：整户回传并建立基线
        local.baseline = snapshotOf(local);
        local.baselineVersion = local.version;
        merged += 1;
        enqueue("家庭需求记录", "回传新增", local.head);
      }
    }

    if (removedIds.length) households.value = households.value.filter((item) => !removedIds.includes(item.id));

    applyTaskHolds();
    queue.value = [];
    lastSyncedAt.value = new Date().toISOString();
    syncing.value = false;
    return { merged, conflicts: newConflicts };
  }

  function resolveConflict(id: string, resolution: "采用本地" | "采用远端") {
    const conflict = conflicts.value.find((item) => item.id === id);
    if (!conflict || conflict.status !== "待处理") return;
    const household = households.value.find((item) => item.id === conflict.householdId);
    if (household) {
      const raw = resolution === "采用远端" ? conflict.remoteValue : conflict.localValue;
      applyFieldValue(household, conflict.field, raw);
      (household.baseline as unknown as Record<string, unknown>)[conflict.field] = household[conflict.field];
      household.version += 1;
    }
    conflict.status = resolution;
    applyTaskHolds();
  }

  if (typeof window !== "undefined") {
    watch([households, tasks, queue, conflicts, lastSyncedAt], () => {
      localStorage.setItem(KEY, JSON.stringify({ households: households.value, tasks: tasks.value, queue: queue.value, conflicts: conflicts.value, lastSyncedAt: lastSyncedAt.value }));
    }, { deep: true });
  }

  return { households, tasks, queue, conflicts, online, lastSyncedAt, syncing, metrics, duplicates, addHousehold, updateHousehold, mergeDuplicate, addTask, advanceTask, syncChanges, resolveConflict, enqueue };
});
