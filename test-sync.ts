import { createPinia, setActivePinia } from "pinia";
import { useAssessmentStore } from "./stores/assessment";

setActivePinia(createPinia());
const store = useAssessmentStore();

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`}`);
}

const h1 = () => store.households.find((h: any) => h.id === "h1");
const h3 = () => store.households.find((h: any) => h.id === "h3");

// 种子状态：h1 本机改过地址+说明（基线 v2），h3 本机改过人数
check("h1 待回传字段", store.dirtyFields(h1()), ["address", "note"]);
check("h3 待回传字段", store.dirtyFields(h3()), ["members"]);
check("h2 无改动", store.dirtyFields(store.households.find((h: any) => h.id === "h2")), []);

const summary = await store.syncNow();

// ① 服务端已合并的 h3：本机人数改动落到保留的 h1，任务 k2 一并迁移
check("h3 已移除", !!h3(), false);
check("h1 人数落位", h1().members, 5);
check("k2 迁移到 h1", store.tasks.find((t: any) => t.id === "k2").householdId, "h1");
check("迁移统计", [summary.retargeted, summary.tasksMigrated], [1, 1]);

// ② 三路合并：note/members 对方没动→写回；address 双方都改→冲突
const serverH1 = (store as any).serverHouseholds?.find?.((s: any) => s.id === "h1");
check("字段合并数", summary.fieldMerged, 2);
check("冲突数", summary.conflicts, 1);
check("h1 基线推进到服务端新版本", h1().baseVersion, 4);
check("本机地址保持本机值（冲突未入库）", h1().address, "河湾路18号2单元（东侧入口）");
check("冲突字段", store.conflicts[0].field, "address");
check("冲突三方值", [store.conflicts[0].baseValue, store.conflicts[0].localValue, store.conflicts[0].remoteValue], ["河湾路18号2单元", "河湾路18号2单元（东侧入口）", "河湾路18号2栋2单元"]);

// ③ 冲突未处理完：任务分派停在待复核
check("h1 状态挂起", store.statusOf(h1()), "待复核");
store.advanceTask("k2");
check("k2 推进被阻塞", store.tasks.find((t: any) => t.id === "k2").status, "待接收");
store.addTask({ householdId: "h1", title: "临时送水", assignee: "后勤一组", priority: "紧急", due: "2026-09-30 18:00" });
check("挂起中分派不置已分派", h1().status, "待复核");

// 再次同步：冲突字段不重复挂、不覆盖
const summary2 = await store.syncNow();
check("二次同步无新冲突", summary2.conflicts, 0);
check("冲突仍只有 1 个", store.conflicts.filter((c: any) => c.status === "待处理").length, 1);

// ④ 处理冲突（采用远端）后：任务分派恢复
store.resolveConflict(store.conflicts[0].id, "采用远端");
check("采用远端回本机", h1().address, "河湾路18号2栋2单元");
check("冲突已处理", store.pendingConflictCount, 0);
check("任务分派恢复", store.statusOf(h1()), "已分派");
store.advanceTask("k2");
check("k2 恢复后可推进", store.tasks.find((t: any) => t.id === "k2").status, "进行中");

// ⑤ 采用本地：本机值写回服务端
store.updateHousehold("h1", { note: "复查：老人需上门送药" });
store.simulateTeammateEdit(); // 队友也改 note → 冲突
const summary3 = await store.syncNow();
check("队友改动结成冲突", summary3.conflicts, 1);
check("冲突字段为 note", store.conflicts[0].field, "note");
store.resolveConflict(store.conflicts[0].id, "采用本地");
check("采用本地后本机值保留", h1().note, "复查：老人需上门送药");
const summary4 = await store.syncNow();
check("冲突处理后同步无新冲突", summary4.conflicts, 0);

// ⑥ 只改对方没动的字段：干净合并，不产生冲突
store.updateHousehold("h1", { vulnerable: ["老人", "残障"] });
const summary5 = await store.syncNow();
check("单边改动干净写回", [summary5.pushed, summary5.conflicts], [1, 0]);
check("写回后无待回传字段", store.dirtyFields(h1()), []);

console.log(failures ? `\n${failures} 项失败` : "\n全部通过");
process.exit(failures ? 1 : 0);
