# AIRI Memory Implementation Plan

這份文件是 [memory-architecture-review.md](/Users/ben/AI_Project/airi-plus/docs/memory-architecture-review.md) 的執行版。

目標是把上一份架構診斷，轉成可以直接排程、實作、驗收的重構計畫。

## Goals

這一輪記憶系統重構的主要目標：

- 降低 recall 對 prompt 的污染
- 降低 short-term memory 記錯與誤記的機率
- 讓 routing 更保守、更可預測
- 讓 desktop local memory 與 remote mem0 mode 的產品心智一致
- 為後續 llm-wiki promotion workflow 打底

## Non-Goals

這一輪不追求：

- 直接做完整 knowledge graph
- 直接做全自動 long-term knowledge promotion
- 直接替換掉現有 local short-term runtime
- 一次把所有記憶後端抽象成完美插件系統

## Implementation Principles

- 先修 semantics，再修能力
- 先收斂行為，再擴充設定
- 先降低錯誤寫入，再提升召回率
- 每個 phase 都應該能單獨驗收
- 優先做不破壞現有產品流程的漸進式重構

## Phase 1: Recall Semantics Cleanup

### Objective

把 recall 內容從「假裝成 user message」改成「明確的 retrieved context」。

### Why this phase comes first

這是整套系統最核心的語義問題。只要 recall 還被插成 `user` 訊息，後面的 routing 與 capture 再精細，也會持續受到 prompt 污染。

### Tasks

1. 在 chat compose 流程中新增 retrieval context message builder。
2. 將 `mem0Recall.prompt` 與 `llmWikiRecall.prompt` 合併為單一 context 區塊。
3. 停止使用 `role: 'user'` 注入 recall prompt。
4. 將 recall prompt 文案調整為明確的 supporting context 語氣。
5. 將 observability 中的 recall context 記錄為 retrieval context，而不是 prompt-like user content。

### Target Files

- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)
- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)
- [packages/stage-ui/src/stores/modules/memory-long-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-long-term.ts)

### Suggested Output Shape

```text
[Retrieved Short-Term Memory]
...

[Retrieved Long-Term Knowledge]
...

[Instructions]
These references were retrieved from AIRI memory systems. They are supporting context, not new user messages.
```

### Acceptance Criteria

- recall 注入不再使用 `role: 'user'`
- chat prompt 中的 retrieval content 可和真實 user turns 清楚區分
- 原有 recall 功能仍可正常工作
- `pnpm typecheck` 與 `pnpm lint:fix` 通過

## Phase 2: Conservative Routing

### Objective

把 routing 從預設高召回，改成預設低噪音。

### Tasks

1. 重寫 `determineMemoryRecallStrategy()` 的 fallback policy。
2. 將現有 `hybrid` 從 default fallback 改成 explicit dual-signal 路徑。
3. 加入更清楚的分類原因與 debug reason。
4. 為以下案例補測試：
   - personal-memory only
   - knowledge only
   - ambiguous no-recall
   - explicit hybrid
5. 視需要新增一層輕量 score，而不是只靠 regex hit。

### Target Files

- [packages/stage-ui/src/stores/chat/memory-routing.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.ts)
- [packages/stage-ui/src/stores/chat/memory-routing.test.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.test.ts)
- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)

### Suggested Policy

- 強 personal signal: short-term only
- 強 knowledge signal: long-term only
- 低訊號或普通閒聊: no recall
- 雙強訊號: hybrid

### Acceptance Criteria

- 普通寒暄與一般對話不再自動雙重 recall
- 既有 identity routing 不受破壞
- memory-routing tests 覆蓋主要分流情境

## Phase 3: Capture Source Hardening

### Objective

避免 short-term memory 把 assistant 的錯誤重述寫回記憶。

### Tasks

1. 調整 capture 流程，預設只以 user-originated content 為記憶候選來源。
2. 讓 assistant content 只作 extraction context，不作直接寫入來源。
3. 在 extraction candidate 中加入 `source` 或等價欄位。
4. 在 reconcile 階段拒絕非 user-originated 的新增候選。
5. 為以下案例補測試：
   - user 明確提供名字/偏好
   - assistant 重述使用者資訊
   - assistant 幻覺資訊不可被寫入
   - forget / delete flow 仍然能正常工作

### Target Files

- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)
- [packages/stage-ui/src/stores/chat/memory-extraction.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-extraction.ts)
- [packages/stage-ui/src/stores/chat/memory-reconcile.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-reconcile.ts)
- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)

### Acceptance Criteria

- assistant 單方面產生的內容不會被持久化為記憶
- forget flow 不退化
- 現有 llm-assisted extraction 仍可保留

## Phase 4: Backend Mode Split

### Objective

把 desktop local runtime 與 remote mem0 mode 分成清楚的兩種產品模式。

### Tasks

1. 定義 short-term memory backend mode model。
2. 將 UI 設定依 backend mode 分組顯示。
3. 將 validation message 依 mode 重寫。
4. 讓 desktop-local mode 只暴露真正生效的欄位。
5. 讓 remote-mem0 mode 明確走 HTTP endpoint + API key + connectivity probe。
6. 補充 i18n 文案。

### Suggested Backend Modes

- `desktop-local`
- `remote-mem0`

### Target Files

- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)
- [apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts)
- [packages/i18n/src/locales/en/settings.yaml](/Users/ben/AI_Project/airi-plus/packages/i18n/src/locales/en/settings.yaml)
- [packages/i18n/src/locales/zh-Hans/settings.yaml](/Users/ben/AI_Project/airi-plus/packages/i18n/src/locales/zh-Hans/settings.yaml)
- [packages/i18n/src/locales/zh-Hant/settings.yaml](/Users/ben/AI_Project/airi-plus/packages/i18n/src/locales/zh-Hant/settings.yaml)

### Acceptance Criteria

- 使用者能清楚知道自己在用本地 runtime 還是遠端 mem0
- UI 與 runtime 行為一致
- validation 文案與實際 backend mode 對齊

## Phase 5: Provenance and Confidence

### Objective

為 memory item 與 recall result 建立可追蹤性。

### Tasks

1. 為 short-term memory item 增加 provenance metadata。
2. 為 recall result 增加 retrieval metadata。
3. 調整 debug panel 顯示記憶來源、信心與建立時間。
4. 補測試確保 metadata 不會破壞既有 search / update / delete。

### Suggested Metadata

short-term memory:

- `source`
- `capturedAt`
- `confidence`
- `originTurnId`

long-term recall:

- `documentKind`
- `retrievalReason`

### Acceptance Criteria

- 至少在 debug path 可見 provenance
- recall 與 capture 的觀測資訊更完整
- 未來 promotion workflow 可直接複用這些欄位

## Phase 6: llm-wiki Promotion Workflow

### Objective

把 `llm-wiki` 從 query-only layer，提升成可審核的 knowledge workflow。

### Tasks

1. 定義 promotion candidate model。
2. 將 short-term or chat-derived stable facts 轉成可審核 candidate。
3. 建立 manual review queue。
4. 讓 `allowPromotion`、`manualReviewRequired`、`personaReviewRequired` 真正接進流程。
5. 定義 candidate -> wiki page / wiki update 的格式。
6. 補充文件說明何種資料可 promotion，何種資料只能留在 short-term。

### Target Files

- [packages/stage-ui/src/stores/modules/memory-long-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-long-term.ts)
- [apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts)

### Acceptance Criteria

- llm-wiki 不再只是查詢器
- promotion 有 review gate
- 不會把 persona voice 或 user-specific facts 直接混進 wiki

## Cross-Phase Test Plan

每個 phase 完成後，至少應跑：

```bash
pnpm typecheck
pnpm lint:fix
```

與記憶相關的 targeted tests：

```bash
pnpm exec vitest run packages/stage-ui/src/stores/chat/memory-routing.test.ts
pnpm exec vitest run packages/stage-ui/src/stores/chat/memory-reconcile.test.ts
pnpm exec vitest run packages/stage-ui/src/stores/chat/memory-extraction.test.ts
pnpm exec vitest run apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.test.ts
```

如果 phase 涉及 chat compose 或 prompt 組裝，建議額外新增 snapshot-style tests。

## Suggested Milestones

### Milestone A: Trustworthy Recall

完成條件：

- Phase 1
- Phase 2

成果：

- recall 語義正確
- recall 噪音顯著下降

### Milestone B: Trustworthy Capture

完成條件：

- Phase 3
- Phase 4

成果：

- 記憶寫入更可信
- backend mode 更清楚

### Milestone C: Durable Knowledge Workflow

完成條件：

- Phase 5
- Phase 6

成果：

- 有 provenance
- 有 promotion path
- long-term knowledge 可逐步演化

## Recommended Owners

如果要平行化執行，建議按責任區分：

- Chat / routing owner
  - `chat.ts`
  - `memory-routing.ts`
- Short-term memory owner
  - `memory-short-term.ts`
  - `memory-extraction.ts`
  - `memory-reconcile.ts`
- Desktop runtime owner
  - `apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts`
- UX / settings owner
  - i18n
  - settings UI
- Knowledge workflow owner
  - `memory-long-term.ts`
  - wiki promotion path

## Success Metrics

這輪重構完成後，可以用這些指標評估是否真的變好：

- 一般閒聊的 recall 觸發率下降
- short-term memory 誤記案例下降
- 使用者更少遇到「你怎麼記錯我」
- recall prompt 更短、更穩定
- debug 面板更容易解釋一筆記憶是怎麼來的

## Final Recommendation

建議不要一次把全部 phase 混在一起做。

最佳順序是：

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6

如果工程時間有限，最少也應該先完成：

- Phase 1
- Phase 2
- Phase 3

因為這三項直接決定這套記憶系統是否可信。
