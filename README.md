# pair-wise-yf-50 灾后需求评估与任务分派离线前端

源提示词摘要：评估员在弱网环境离线记录家庭需求、特殊照护和现场说明，团队负责人合并重复记录、分派复核任务并追踪进展；多人修改同一记录时提供字段级冲突展示，不静默覆盖。

## 技术栈

Nuxt3、TypeScript、Naive UI、Pinia、Nuxt路由、Axios、VueUse、VeeValidate、Zod、Vue I18n。

## 本地运行

```bash
npm install
npm run dev
npm run build
```

开发端口：62015

## 离线字段级合并

- 每条家庭需求记录保存时携带 `baselineVersion`（本机基线版本）与基线快照（上次回传时的服务端值）。
- 回传时先取服务端当前版本，按字段三方合并：仅本机改过的字段自动写回；仅对方改过的字段采用远端；双方都改过且不一致的字段结成「待处理」冲突，先不入库，不静默覆盖。
- 服务端已并入保留记录的重复户：本机改动落到保留户，名下任务分派一并迁移到保留户。
- 冲突未处理完时，该户任务分派停在「待复核」（原状态记入 `heldFrom`），期间新派任务也直接进入「待复核」；冲突处理完后自动恢复原状态。
- 相关逻辑：`stores/assessment.ts` 的 `syncChanges` / `resolveConflict` / `applyTaskHolds`，服务端模拟见 `utils/server.ts`。
