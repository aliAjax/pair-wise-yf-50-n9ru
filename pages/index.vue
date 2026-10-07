<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NSelect, NStatistic, NSwitch, NTag } from "naive-ui";
import { useOnline } from "@vueuse/core";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useAssessmentStore, type NeedLevel } from "~/stores/assessment";
import { probeCache } from "~/utils/api";

const store = useAssessmentStore();
const browserOnline = useOnline();
const panel = ref("需求记录");
const selectedId = ref(store.households[0]?.id ?? "");
const cacheProbe = ref<{ cachedAt: string; source: string } | null>(null);
const syncMessage = ref("");
const levelOptions = [{ value: "紧急", label: "紧急" }, { value: "高", label: "高" }, { value: "一般", label: "一般" }];
const schema = toTypedSchema(z.object({ head: z.string().min(2, "请输入户主姓名"), community: z.string().min(2), address: z.string().min(4), members: z.coerce.number().min(1).max(30), needLevel: z.enum(["紧急", "高", "一般"]), needs: z.string().min(2), note: z.string().min(2) }));
const { defineField, errors, handleSubmit, resetForm } = useForm({ validationSchema: schema, initialValues: { head: "", community: "河湾社区", address: "", members: 1, needLevel: "一般" as NeedLevel, needs: "", note: "" } });
const [head] = defineField("head");
const [community] = defineField("community");
const [address] = defineField("address");
const [members] = defineField("members");
const [needLevel] = defineField("needLevel");
const [needs] = defineField("needs");
const [note] = defineField("note");
const selected = computed(() => store.households.find((item) => item.id === selectedId.value) ?? store.households[0]);
const taskAssignee = ref("救援一组");
const taskTitle = ref("现场复核");
const editAddress = ref("");
const editMembers = ref("1");
const editNeedLevel = ref<NeedLevel>("一般");
const editNeeds = ref("");
const editVulnerable = ref("");
const editNote = ref("");
const editMessage = ref("");

watch(selected, (household) => {
  editAddress.value = household?.address ?? "";
  editMembers.value = String(household?.members ?? 1);
  editNeedLevel.value = household?.needLevel ?? "一般";
  editNeeds.value = household?.needs.join("，") ?? "";
  editVulnerable.value = household?.vulnerable.join("，") ?? "";
  editNote.value = household?.note ?? "";
}, { immediate: true, deep: true });

onMounted(async () => {
  cacheProbe.value = await probeCache();
  store.online = browserOnline.value;
});
const submit = handleSubmit((values) => {
  store.addHousehold({ head: values.head, community: values.community, address: values.address, members: Number(values.members), vulnerable: [], needLevel: values.needLevel as NeedLevel, needs: values.needs.split(/[，,]/).map((item) => item.trim()).filter(Boolean), note: values.note });
  resetForm();
});
function saveEdit() {
  if (!selected.value) return;
  store.updateHousehold(selected.value.id, {
    address: editAddress.value,
    members: Number(editMembers.value) || selected.value.members,
    needLevel: editNeedLevel.value,
    needs: editNeeds.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    vulnerable: editVulnerable.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    note: editNote.value
  });
  editMessage.value = `已保存到本机（v${selected.value.version}），回传时按字段与服务端合并。`;
}
function assignTask() {
  if (!selected.value) return;
  store.addTask({ householdId: selected.value.id, title: taskTitle.value, assignee: taskAssignee.value, priority: selected.value.needLevel, due: "2026-09-30 18:00" });
}
async function sync() {
  if (!store.online) { syncMessage.value = "仍在弱网状态，队列保留在设备中。"; return; }
  syncMessage.value = "正在回传离线改动，按字段与服务端合并…";
  const summary = await store.syncNow();
  const parts = [
    summary.created ? `新建 ${summary.created} 条` : "",
    summary.pushed ? `整户写回 ${summary.pushed} 条` : "",
    summary.fieldMerged ? `字段合并 ${summary.fieldMerged} 项` : "",
    summary.retargeted ? `重复记录落位 ${summary.retargeted} 条（迁移任务 ${summary.tasksMigrated} 项）` : "",
    summary.conflicts ? `${summary.conflicts} 个字段冲突待处理` : ""
  ].filter(Boolean);
  syncMessage.value = parts.length ? `同步完成：${parts.join("，")}。` : "同步完成：本机与服务端已一致。";
  if (summary.conflicts) syncMessage.value += " 冲突未处理完前，相关户的任务分派停在待复核。";
}
function teammateEdit() {
  const result = store.simulateTeammateEdit();
  syncMessage.value = result ? `队友在服务端修改了 ${result.head} 的「${result.field}」，下次同步将按字段合并或结成冲突。` : "暂无可模拟的远端记录。";
}
</script>

<template>
  <div class="shell">
    <aside class="side"><div class="brand"><b>FIELD OPS</b><span>灾后评估</span></div><nav><button v-for="item in ['需求记录', '重复合并', '任务分派', '同步队列', '冲突处理']" :key="item" :class="{ active: panel === item }" @click="panel = item">{{ item }} <span v-if="item === '同步队列' && store.queue.length">({{ store.queue.length }})</span><span v-if="item === '冲突处理' && store.pendingConflictCount">({{ store.pendingConflictCount }})</span></button></nav><div class="network"><small>设备与网络</small><b>{{ browserOnline && store.online ? '在线' : '弱网 / 离线' }}</b><NSwitch v-model:value="store.online" /><small>最近同步 {{ new Date(store.lastSyncedAt).toLocaleTimeString('zh-CN') }}</small></div></aside>
    <main>
      <header><div><small>评估批次 2026-09-29 · 河湾片区</small><h1>灾后需求评估与任务分派</h1><p>离线改动按字段合并回传，双方都改过的字段结成冲突，不静默覆盖。</p></div><div class="status-chip"><NProgress type="circle" :percentage="100 - store.queue.length * 8" :stroke-width="8" :width="42" /><span>{{ store.queue.length ? `${store.queue.length} 项待同步` : '数据已同步' }}</span></div></header>
      <section class="metrics"><NCard><NStatistic label="评估家庭" :value="store.metrics.households" /></NCard><NCard><NStatistic label="紧急需求" :value="store.metrics.urgent" /></NCard><NCard><NStatistic label="未完成任务" :value="store.metrics.openTasks" /></NCard><NCard><NStatistic label="待处理冲突" :value="store.pendingConflictCount" /></NCard></section>
      <NAlert v-if="!browserOnline || !store.online" type="warning" show-icon>当前网络不可用。新增记录与任务仍可操作，所有变更会写入IndexedDB兼容的本地缓存与待同步队列。</NAlert>
      <NAlert v-if="store.pendingConflictCount" type="error" show-icon style="margin-top:12px">有 {{ store.pendingConflictCount }} 个字段冲突待处理，相关家庭的任务分派停在待复核，处理完后自动恢复。</NAlert>
      <div v-if="panel === '需求记录'" class="page-grid">
        <NCard title="家庭走访记录" :bordered="false"><div class="households"><article v-for="item in store.households" :key="item.id" class="household" :class="{ selected: selectedId === item.id }" @click="selectedId = item.id"><div><b>{{ item.head }} · {{ item.members }}人</b><small>{{ item.community }} / {{ item.address }}</small><p>{{ item.needs.join('、') }} · {{ item.note }}</p></div><div><NTag :type="item.needLevel === '紧急' ? 'error' : item.needLevel === '高' ? 'warning' : 'success'">{{ item.needLevel }}</NTag><NTag v-if="store.hasPendingConflicts(item.id)" type="error" size="small">冲突待处理</NTag><small>{{ store.statusOf(item) }} · v{{ item.version }} · 基线v{{ item.baseVersion }}</small></div></article></div></NCard>
        <div class="side-stack">
          <NCard title="修改选中记录（离线）" :bordered="false"><template v-if="selected"><p class="edit-head"><b>{{ selected.head }}</b> · 本机 v{{ selected.version }} / 基线 v{{ selected.baseVersion }}<template v-if="store.dirtyFields(selected).length"> · 待回传字段：{{ store.dirtyFields(selected).join('、') }}</template><template v-else> · 本机无未回传改动</template></p><div class="field-grid"><label class="field wide"><span>地址描述</span><NInput v-model:value="editAddress" /></label><label class="field"><span>家庭人数</span><NInput v-model:value="editMembers" type="number" /></label><label class="field"><span>需求等级</span><NSelect v-model:value="editNeedLevel" :options="levelOptions" /></label><label class="field wide"><span>主要需求（逗号分隔）</span><NInput v-model:value="editNeeds" /></label><label class="field wide"><span>特殊照护（逗号分隔）</span><NInput v-model:value="editVulnerable" /></label><label class="field wide"><span>现场说明</span><NInput v-model:value="editNote" type="textarea" /></label><div class="actions wide"><NButton type="primary" @click="saveEdit">保存本机修改</NButton><small>{{ editMessage }}</small></div></div></template><p v-else class="empty">请先在左侧选择一户。</p></NCard>
          <NCard title="新增需求记录" :bordered="false"><form class="field-grid" @submit.prevent="submit"><label class="field"><span>户主姓名</span><NInput v-model:value="head" /><small>{{ errors.head }}</small></label><label class="field"><span>社区</span><NInput v-model:value="community" /></label><label class="field wide"><span>地址描述</span><NInput v-model:value="address" placeholder="不使用地图坐标时可描述楼栋与单元" /><small>{{ errors.address }}</small></label><label class="field"><span>家庭人数</span><NInput v-model:value="members" type="number" /></label><label class="field"><span>需求等级</span><NSelect v-model:value="needLevel" :options="levelOptions" /></label><label class="field wide"><span>主要需求（逗号分隔）</span><NInput v-model:value="needs" placeholder="临时安置，饮用水" /><small>{{ errors.needs }}</small></label><label class="field wide"><span>现场说明</span><NInput v-model:value="note" type="textarea" /><small>{{ errors.note }}</small></label><div class="actions wide"><NButton attr-type="submit" type="primary">保存本地记录</NButton><NButton @click="sync">尝试同步</NButton></div></form></NCard>
        </div>
      </div>
      <NCard v-if="panel === '重复合并'" title="疑似重复记录"><div v-for="group in store.duplicates" :key="group.map((item) => item.id).join('-')" class="duplicate"><b>{{ group[0].head }} · {{ group[0].community }}</b><p>{{ group.map((item) => `${item.address} / ${item.note}`).join('；') }}</p><NButton type="primary" size="small" @click="store.mergeDuplicate(group[1].id, group[0].id)">合并为一条并保留需求并集</NButton></div><p v-if="!store.duplicates.length" class="empty">没有检测到疑似重复记录。</p></NCard>
      <div v-if="panel === '任务分派'" class="page-grid"><NCard title="任务列表" :bordered="false"><div v-for="task in store.tasks" :key="task.id" class="task-row"><div><b :class="{ complete: task.status === '已完成' }">{{ task.title }}</b><small>{{ store.households.find((item) => item.id === task.householdId)?.head }} · {{ task.due }}</small></div><NTag>{{ task.priority }}</NTag><span>{{ task.assignee }} · {{ task.status }}<NTag v-if="store.hasPendingConflicts(task.householdId)" type="error" size="small" style="margin-left:6px">待复核</NTag></span><NButton size="small" :disabled="task.status === '已完成' || store.hasPendingConflicts(task.householdId)" @click="store.advanceTask(task.id)">推进状态</NButton></div></NCard><NCard title="分派新任务" :bordered="false"><p>当前家庭：<b>{{ selected?.head }}</b></p><NAlert v-if="selected && store.hasPendingConflicts(selected.id)" type="warning" show-icon style="margin-bottom:12px">该户有待处理字段冲突，任务分派停在待复核，处理完冲突后恢复。</NAlert><label class="field"><span>任务内容</span><NInput v-model:value="taskTitle" /></label><label class="field"><span>执行人/小组</span><NInput v-model:value="taskAssignee" /></label><NButton type="primary" block :disabled="!selected" @click="assignTask">加入任务并本地排队</NButton></NCard></div>
      <NCard v-if="panel === '同步队列'" title="待同步操作"><p>{{ syncMessage || '恢复连接后按顺序提交，冲突不会自动覆盖。' }}</p><div v-for="item in store.queue" :key="item.id" class="queue-row"><NTag>{{ item.action }}</NTag><span>{{ item.entity }} · {{ item.detail }}</span><small>{{ new Date(item.time).toLocaleTimeString('zh-CN') }}</small></div><p v-if="!store.queue.length" class="empty">待同步队列为空。</p><div class="actions"><NButton type="primary" :loading="store.syncing" @click="sync">人工确认并同步</NButton><NButton @click="teammateEdit">模拟队友远端改动</NButton></div><small v-if="cacheProbe"> 数据缓存时间：{{ new Date(cacheProbe.cachedAt).toLocaleTimeString('zh-CN') }}</small></NCard>
      <NCard v-if="panel === '冲突处理'" title="字段级冲突"><div v-for="item in store.conflicts" :key="item.id" class="conflict"><b>{{ store.households.find((household) => household.id === item.householdId)?.head }} · {{ item.field }}</b><div class="conflict-values"><div><small>基线版本</small><span>{{ item.baseValue }}</span></div><div><small>本机记录</small><span>{{ item.localValue }}</span></div><div><small>远端记录</small><span>{{ item.remoteValue }}</span></div></div><div class="actions"><NButton size="small" :disabled="item.status !== '待处理'" @click="store.resolveConflict(item.id, '采用本地')">采用本机</NButton><NButton size="small" type="primary" :disabled="item.status !== '待处理'" @click="store.resolveConflict(item.id, '采用远端')">采用远端</NButton><NTag>{{ item.status }}</NTag></div></div><p v-if="!store.conflicts.length" class="empty">暂无字段冲突。离线改动同一户后点击“人工确认并同步”，双方都改过的字段会在这里结成冲突。</p></NCard>
    </main>
  </div>
</template>
