import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";

export type HouseholdStatus = "待评估" | "待复核" | "已分派" | "已完成";
export type NeedLevel = "紧急" | "高" | "一般";
export type TaskStatus = "待接收" | "进行中" | "已完成";

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
  baseVersion: number;
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
  field: keyof Household;
  baseValue: string;
  localValue: string;
  remoteValue: string;
  status: "待处理" | "采用本地" | "采用远端";
}

export interface SyncSummary {
  created: number;
  pushed: number;
  fieldMerged: number;
  conflicts: number;
  retargeted: number;
  tasksMigrated: number;
}

const MERGEABLE_FIELDS = ["head", "community", "address", "members", "vulnerable", "needLevel", "needs", "note"] as const;
type MergeableField = (typeof MERGEABLE_FIELDS)[number];

const KEY = "pair-wise-yf-50/assessment-v2";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

const seedHouseholds: Household[] = [
  { id: "h1", head: "王建国", community: "河湾社区", address: "河湾路18号2单元（东侧入口）", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], status: "待复核", version: 3, baseVersion: 2, deviceUpdatedAt: minutesAgo(12), note: "一层受淹，老人行动不便，已联系临时安置点" },
  { id: "h2", head: "赵敏", community: "新城社区", address: "新城三街9号", members: 2, vulnerable: [], needLevel: "一般", needs: ["饮用水"], status: "已分派", version: 1, baseVersion: 1, deviceUpdatedAt: minutesAgo(35), note: "饮水库存不足" },
  { id: "h3", head: "王建国", community: "河湾社区", address: "河湾路18号2幢2单元", members: 5, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], status: "待评估", version: 2, baseVersion: 1, deviceUpdatedAt: minutesAgo(5), note: "疑似重复登记" }
];
const seedTasks: FieldTask[] = [
  { id: "k1", householdId: "h2", title: "配送饮用水", assignee: "后勤二组", priority: "一般", status: "进行中", due: "2026-09-29 16:00" },
  { id: "k2", householdId: "h3", title: "核实重复登记", assignee: "评估三组", priority: "高", status: "待接收", due: "2026-09-30 12:00" }
];
const seedQueue: PendingChange[] = [
  { id: "seed-q2", entity: "家庭需求记录", action: "修改", detail: "王建国（重复登记）：家庭人数", time: minutesAgo(5) },
  { id: "seed-q1", entity: "家庭需求记录", action: "修改", detail: "王建国：地址、现场说明", time: minutesAgo(12) }
];
// 各记录回传基线：上次与服务端一致时的字段快照
const seedBaselines: Record<string, Partial<Household>> = {
  h1: { head: "王建国", community: "河湾社区", address: "河湾路18号2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], note: "一层受淹，老人行动不便" },
  h2: { head: "赵敏", community: "新城社区", address: "新城三街9号", members: 2, vulnerable: [], needLevel: "一般", needs: ["饮用水"], note: "饮水库存不足" },
  h3: { head: "王建国", community: "河湾社区", address: "河湾路18号2幢2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], note: "疑似重复登记" }
};
// 模拟服务端当前版本：h1 被队友改过地址（v3），h3 已在服务端并入 h1
const seedServerHouseholds: Household[] = [
  { id: "h1", head: "王建国", community: "河湾社区", address: "河湾路18号2栋2单元", members: 4, vulnerable: ["老人"], needLevel: "紧急", needs: ["临时安置", "慢病用药"], status: "待复核", version: 3, baseVersion: 3, deviceUpdatedAt: minutesAgo(8), note: "一层受淹，老人行动不便" },
  { id: "h2", head: "赵敏", community: "新城社区", address: "新城三街9号", members: 2, vulnerable: [], needLevel: "一般", needs: ["饮用水"], status: "已分派", version: 1, baseVersion: 1, deviceUpdatedAt: minutesAgo(35), note: "饮水库存不足" }
];
const seedServerMerges: Record<string, string> = { h3: "h1" };

export const useAssessmentStore = defineStore("assessment", () => {
  const initial = typeof window !== "undefined" && localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY)!) : null;
  const households = ref<Household[]>(initial?.households ?? seedHouseholds);
  const tasks = ref<FieldTask[]>(initial?.tasks ?? seedTasks);
  const queue = ref<PendingChange[]>(initial?.queue ?? seedQueue);
  const conflicts = ref<FieldConflict[]>(initial?.conflicts ?? []);
  const baselines = ref<Record<string, Partial<Household>>>(initial?.baselines ?? seedBaselines);
  const serverHouseholds = ref<Household[]>(initial?.serverHouseholds ?? seedServerHouseholds);
  const serverMerges = ref<Record<string, string>>(initial?.serverMerges ?? seedServerMerges);
  const online = ref(true);
  const lastSyncedAt = ref(initial?.lastSyncedAt ?? minutesAgo(20));
  const syncing = ref(false);

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const display = (value: unknown) => (Array.isArray(value) ? value.join("、") : String(value ?? ""));
  const readField = (source: Partial<Household> | undefined, field: MergeableField) => (source as Record<string, unknown> | undefined)?.[field];
  const writeField = (target: Partial<Household>, field: MergeableField, value: unknown) => {
    (target as unknown as Record<string, unknown>)[field] = value;
  };
  const pickFields = (source: Partial<Household>): Partial<Household> => {
    const snapshot: Partial<Household> = {};
    MERGEABLE_FIELDS.forEach((field) => writeField(snapshot, field, clone(readField(source, field))));
    return snapshot;
  };

  // 旧缓存兼容：补齐基线版本与基线快照，缺失时按服务端当前版本对齐
  households.value.forEach((household) => {
    if (household.baseVersion == null) household.baseVersion = household.version ?? 1;
    if (!baselines.value[household.id]) {
      const server = serverHouseholds.value.find((item) => item.id === household.id);
      if (server) {
        baselines.value[household.id] = pickFields(server);
        household.baseVersion = server.version;
      }
    }
  });

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

  const pendingConflictCount = computed(() => conflicts.value.filter((item) => item.status === "待处理").length);

  function hasPendingConflicts(householdId: string) {
    return conflicts.value.some((item) => item.householdId === householdId && item.status === "待处理");
  }

  // 冲突未处理完时，该户任务分派停在待复核
  function statusOf(household: Household): HouseholdStatus {
    return hasPendingConflicts(household.id) ? "待复核" : household.status;
  }

  // 本机改过且未挂冲突的字段（相对回传基线）
  function dirtyFields(household: Household): MergeableField[] {
    const baseline = baselines.value[household.id];
    if (!baseline) return [...MERGEABLE_FIELDS];
    const held = new Set(conflicts.value.filter((item) => item.householdId === household.id && item.status === "待处理").map((item) => item.field));
    return MERGEABLE_FIELDS.filter((field) => !held.has(field) && !isEqual(readField(household, field), readField(baseline, field)));
  }

  function enqueue(entity: string, action: string, detail: string) {
    queue.value.unshift({ id: crypto.randomUUID(), entity, action, detail, time: new Date().toISOString() });
  }

  function addHousehold(input: Omit<Household, "id" | "status" | "version" | "baseVersion" | "deviceUpdatedAt">) {
    households.value.unshift({ ...input, id: crypto.randomUUID(), status: "待评估", version: 1, baseVersion: 0, deviceUpdatedAt: new Date().toISOString() });
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
    target.deviceUpdatedAt = new Date().toISOString();
    tasks.value.forEach((task) => {
      if (task.householdId === sourceId) task.householdId = targetId;
    });
    conflicts.value.forEach((item) => {
      if (item.householdId === sourceId) item.householdId = targetId;
    });
    households.value = households.value.filter((item) => item.id !== sourceId);
    delete baselines.value[sourceId];
    enqueue("重复记录", "合并", `${source.head} → ${target.address}，名下任务已迁移`);
  }

  function addTask(input: Omit<FieldTask, "id" | "status">) {
    tasks.value.unshift({ ...input, id: crypto.randomUUID(), status: "待接收" });
    const household = households.value.find((item) => item.id === input.householdId);
    if (!household) return;
    if (hasPendingConflicts(household.id)) {
      enqueue("任务", "分派挂起", `${input.title}：字段冲突未处理完，停在待复核`);
      return;
    }
    if (household.status !== "已完成") household.status = "已分派";
    enqueue("任务", "分派", `${input.title} / ${input.assignee}`);
  }

  function advanceTask(id: string) {
    const task = tasks.value.find((item) => item.id === id);
    if (!task) return;
    if (hasPendingConflicts(task.householdId)) {
      enqueue("任务", "待复核", `${task.title}：字段冲突未处理完，分派停在待复核`);
      return;
    }
    task.status = task.status === "待接收" ? "进行中" : "已完成";
    if (task.status === "已完成") {
      const open = tasks.value.some((item) => item.householdId === task.householdId && item.status !== "已完成");
      const household = households.value.find((item) => item.id === task.householdId);
      if (household && !open) household.status = "已完成";
    }
    enqueue("任务", "状态流转", `${task.title} → ${task.status}`);
  }

  async function syncNow(): Promise<SyncSummary> {
    syncing.value = true;
    await new Promise((resolve) => setTimeout(resolve, 650));
    const summary: SyncSummary = { created: 0, pushed: 0, fieldMerged: 0, conflicts: 0, retargeted: 0, tasksMigrated: 0 };
    queue.value = [];

    // ① 服务端已并成重复记录的户：本机改动落到保留那条，名下任务分派一并迁移
    for (const [mergedId, retainedId] of Object.entries(serverMerges.value)) {
      const duplicate = households.value.find((item) => item.id === mergedId);
      if (!duplicate) continue;
      let retained = households.value.find((item) => item.id === retainedId);
      if (!retained) {
        const serverRetained = serverHouseholds.value.find((item) => item.id === retainedId);
        if (!serverRetained) continue;
        retained = clone(serverRetained);
        households.value.push(retained);
        baselines.value[retained.id] = pickFields(serverRetained);
        retained.baseVersion = serverRetained.version;
      }
      const retainedBaseline = baselines.value[retained.id];
      let applied = 0;
      dirtyFields(duplicate).forEach((field) => {
        if (isEqual(readField(retained, field), readField(retainedBaseline, field))) {
          writeField(retained, field, clone(readField(duplicate, field)));
          applied += 1;
        }
      });
      if (applied) {
        retained.version += 1;
        retained.deviceUpdatedAt = new Date().toISOString();
      }
      let migrated = 0;
      tasks.value.forEach((task) => {
        if (task.householdId === mergedId) {
          task.householdId = retainedId;
          migrated += 1;
        }
      });
      conflicts.value.forEach((item) => {
        if (item.householdId === mergedId) item.householdId = retainedId;
      });
      households.value = households.value.filter((item) => item.id !== mergedId);
      delete baselines.value[mergedId];
      enqueue("重复记录", "服务端已合并", `${duplicate.head} 的本机改动落到保留记录，迁移任务 ${migrated} 项`);
      summary.retargeted += 1;
      summary.tasksMigrated += migrated;
    }

    // ② 逐户回传：先取服务端当前版本，再按字段三路合并
    for (const household of [...households.value]) {
      const server = serverHouseholds.value.find((item) => item.id === household.id);
      const baseline = baselines.value[household.id];
      if (!server) {
        const created = { ...clone(household), version: 1, baseVersion: 1 };
        serverHouseholds.value.push(created);
        baselines.value[household.id] = pickFields(created);
        household.version = 1;
        household.baseVersion = 1;
        summary.created += 1;
        continue;
      }
      const dirty = dirtyFields(household);
      if (!dirty.length) {
        if (server.version !== household.baseVersion) {
          MERGEABLE_FIELDS.forEach((field) => writeField(household, field, clone(readField(server, field))));
          baselines.value[household.id] = pickFields(server);
          household.baseVersion = server.version;
        }
        continue;
      }
      if (server.version === household.baseVersion) {
        dirty.forEach((field) => writeField(server, field, clone(readField(household, field))));
        server.version += 1;
        server.deviceUpdatedAt = new Date().toISOString();
        baselines.value[household.id] = pickFields(server);
        household.baseVersion = server.version;
        summary.pushed += 1;
        continue;
      }
      // 双方都改过：只写回本机改过而对方没动的字段，都改过的挂冲突、先不入库
      const merged: MergeableField[] = [];
      let conflictCount = 0;
      dirty.forEach((field) => {
        const remoteChanged = !isEqual(readField(server, field), readField(baseline, field));
        if (!remoteChanged) {
          writeField(server, field, clone(readField(household, field)));
          merged.push(field);
        } else {
          conflicts.value.unshift({
            id: crypto.randomUUID(),
            householdId: household.id,
            field,
            baseValue: display(readField(baseline, field)),
            localValue: display(readField(household, field)),
            remoteValue: display(readField(server, field)),
            status: "待处理"
          });
          conflictCount += 1;
        }
      });
      if (merged.length) {
        server.version += 1;
        server.deviceUpdatedAt = new Date().toISOString();
        summary.fieldMerged += merged.length;
      }
      // 基线对齐：已合并字段用服务端新值，冲突字段保留旧基线（仍算本机改动）
      const nextBaseline = { ...(baseline ?? {}) };
      merged.forEach((field) => writeField(nextBaseline, field, clone(readField(server, field))));
      baselines.value[household.id] = nextBaseline;
      household.baseVersion = server.version;
      MERGEABLE_FIELDS.forEach((field) => {
        if (!dirty.includes(field) && !isEqual(readField(household, field), readField(server, field))) {
          writeField(household, field, clone(readField(server, field)));
          writeField(baselines.value[household.id], field, clone(readField(server, field)));
        }
      });
      summary.conflicts += conflictCount;
      if (merged.length || conflictCount) enqueue("家庭需求记录", "字段合并", `${household.head}：写回 ${merged.length} 个字段，${conflictCount} 个冲突待处理`);
    }

    lastSyncedAt.value = new Date().toISOString();
    syncing.value = false;
    return summary;
  }

  // 模拟队友在服务端改动同一户，用于演示三路合并与冲突
  function simulateTeammateEdit() {
    const household = households.value.find((item) => serverHouseholds.value.some((server) => server.id === item.id));
    if (!household) return null;
    const server = serverHouseholds.value.find((item) => item.id === household.id)!;
    const dirty = dirtyFields(household);
    const field: MergeableField = (["address", "note", "members"] as MergeableField[]).find((item) => dirty.includes(item)) ?? "address";
    const stamp = new Date().toLocaleTimeString("zh-CN");
    if (field === "members") writeField(server, field, Number(readField(server, field) ?? 0) + 1);
    else if (field === "note") writeField(server, field, `${readField(server, field)}；队友${stamp}电话核实`);
    else writeField(server, field, `${readField(server, field)}（队友${stamp}修订）`);
    server.version += 1;
    server.deviceUpdatedAt = new Date().toISOString();
    return { head: server.head, field };
  }

  function resolveConflict(id: string, resolution: "采用本地" | "采用远端") {
    const conflict = conflicts.value.find((item) => item.id === id);
    if (!conflict || conflict.status !== "待处理") return;
    const household = households.value.find((item) => item.id === conflict.householdId);
    const server = serverHouseholds.value.find((item) => item.id === conflict.householdId);
    const field = conflict.field as MergeableField;
    if (household && server && MERGEABLE_FIELDS.includes(field)) {
      baselines.value[household.id] ??= {};
      if (resolution === "采用本地") {
        writeField(server, field, clone(readField(household, field)));
        server.version += 1;
        server.deviceUpdatedAt = new Date().toISOString();
        writeField(baselines.value[household.id], field, clone(readField(household, field)));
      } else {
        writeField(household, field, clone(readField(server, field)));
        writeField(baselines.value[household.id], field, clone(readField(server, field)));
      }
      household.baseVersion = server.version;
      household.version += 1;
      household.deviceUpdatedAt = new Date().toISOString();
    }
    conflict.status = resolution;
    enqueue("字段冲突", resolution, `${household?.head ?? conflict.householdId} · ${conflict.field}`);
    // 冲突处理完，任务分派恢复
    if (household && !hasPendingConflicts(household.id)) {
      const open = tasks.value.some((item) => item.householdId === household.id && item.status !== "已完成");
      if (open && household.status !== "已完成") household.status = "已分派";
      enqueue("任务分派", "恢复", `${household.head} 的冲突已处理完，任务分派恢复`);
    }
  }

  if (typeof window !== "undefined") {
    watch([households, tasks, queue, conflicts, baselines, serverHouseholds, serverMerges, lastSyncedAt], () => {
      localStorage.setItem(KEY, JSON.stringify({
        households: households.value,
        tasks: tasks.value,
        queue: queue.value,
        conflicts: conflicts.value,
        baselines: baselines.value,
        serverHouseholds: serverHouseholds.value,
        serverMerges: serverMerges.value,
        lastSyncedAt: lastSyncedAt.value
      }));
    }, { deep: true });
  }

  return { households, tasks, queue, conflicts, online, lastSyncedAt, syncing, metrics, duplicates, pendingConflictCount, hasPendingConflicts, statusOf, dirtyFields, addHousehold, updateHousehold, mergeDuplicate, addTask, advanceTask, syncNow, simulateTeammateEdit, resolveConflict, enqueue };
});
