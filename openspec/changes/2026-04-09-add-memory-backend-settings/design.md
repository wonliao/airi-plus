## Context

AIRI 現在已經有記憶相關入口，但實際內容尚未落地：

- [packages/stage-pages/src/pages/settings/memory/index.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/memory/index.vue)
- [packages/stage-pages/src/pages/settings/modules/memory-short-term.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/modules/memory-short-term.vue)
- [packages/stage-pages/src/pages/settings/modules/memory-long-term.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/modules/memory-long-term.vue)

模組列表也已經把短期記憶與長期記憶視為正式設定入口，但目前 `configured` 仍是硬編碼 `false`：

- [packages/stage-ui/src/composables/use-modules-list.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/composables/use-modules-list.ts)

另一方面，repo 內現有 provider 基礎設施主要是為 chat / speech / transcription 類型設計：

- [packages/stage-ui/src/stores/providers.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/providers.ts)

這套設施適合「外部模型或媒體服務提供者」，但不適合直接承接記憶語意。`mem0` 與 `llm-wiki` 的核心差別不只是不同 endpoint，而是不同責任：

- `mem0`：近期事件、偏好、session continuity、短期 recall / capture
- `llm-wiki`：長期知識、整理後的 wiki page、promotion、review gate

在你提供的參考文件裡，這兩者常以 `OpenClaw` orchestration 為上下文被描述，但那些文件本質上是在定義 integration topology，而不是 AIRI 本身的設定模型。這次變更要解決的就是這個邊界：AIRI 應該擁有自己的記憶 backend 設定模型，並把 OpenClaw 視為未來可消費這些設定的 runtime 整合點，而不是設定層的 owner。

## Goals / Non-Goals

**Goals：**
- 讓 AIRI 以原生設定頁配置短期記憶與長期記憶 backend。
- 短期記憶確定使用 `mem0` 技術作為 backend，長期記憶確定使用 `llm-wiki` 技術作為 backend，且首版不提供 backend selector。
- 以模組 store 管理記憶設定、configured 狀態與基本驗證結果。
- 讓記憶設定與既有 chat provider registry 解耦，避免 provider 語意污染。
- 為未來 OpenClaw 或其他 orchestration runtime 保留 adapter 整合點，但不把設定資料掛在 `openclaw.*` 命名空間下。

**Non-Goals：**
- 不在此變更中一次完成 `mem0` 全部 recall/capture/runtime 寫入流程。
- 不在此變更中一次完成 `llm-wiki` 的 ingest、digest、promotion 自動化。
- 不在此變更中重寫既有 provider registry，也不把 `mem0` / `llm-wiki` 變成 chat provider。
- 不在此變更中定義 OpenClaw 如何實際消費這些設定；那是後續 runtime integration 專題。

## Decisions

1. **記憶設定使用獨立模組 store，而不是沿用 provider store**

   建議新增兩個 store：

   - `useShortTermMemoryStore()`
   - `useLongTermMemoryStore()`

   原因是既有 provider store 的 category 與 UI 流程預設為 model provider，若將 `mem0` / `llm-wiki` 混入 `packages/stage-ui/src/stores/providers.ts`，會讓資料模型與使用者心智都誤以為它們是一般模型供應商。

   考慮過的替代方案：
   - 把 `mem0` 與 `llm-wiki` 加到 provider registry，新增 `memory` category。
   - 把兩者都掛在 `openclaw` provider 的 advanced settings 下面。

   第一種會把模型 provider 與記憶 backend 的語意混在一起；第二種則直接違反「不要和 openclaw 綁定」的需求。

2. **短期記憶與長期記憶分頁採用不同 store 與不同 config shape，且首版不暴露 backend selector**

   雖然兩者都屬於「記憶」，但設定需求並不對稱。

   短期記憶 store 建議至少包含：
   - `enabled`
   - `backendId`（固定為 `mem0`）
   - `configured`
   - `validationStatus`
   - `mode`
   - `userId`
   - `baseUrl`
   - `apiKey`
   - `embedder`
   - `vectorStore`
   - `autoRecall`
   - `autoCapture`
   - `topK`
   - `searchThreshold`
   - `lastValidation`

   長期記憶 store 建議至少包含：
   - `enabled`
   - `backendId`（固定為 `llm-wiki`）
   - `configured`
   - `validationStatus`
   - `workspacePath`
   - `indexPath`
   - `overviewPath`
   - `queryMode`
   - `allowPromotion`
   - `manualReviewRequired`
   - `personaReviewRequired`
   - `lastValidation`

   不應強行抽成一個通用 `MemoryProviderConfig`，否則大量欄位會成為另一邊的噪音。首版的頁面語意應是「設定 mem0」與「設定 llm-wiki」，而不是「從多個 backend 中挑一個」。

3. **設定命名與儲存路徑不得依附 OpenClaw**

   建議 local storage / persisted state 路徑如下：

   - `settings/memory/short-term/*`
   - `settings/memory/long-term/*`

   並要求設定欄位與命名避免出現：
   - `openclaw.mem0.*`
   - `openclaw.wiki.*`
   - `memory.openclaw.*`

   與 OpenClaw 的關係應只存在於未來 adapter 配接層，例如：
   - `mem0 adapter for openclaw runtime`
   - `llm-wiki adapter for openclaw runtime`

4. **記憶頁使用記憶專用 scenario components**

   不建議直接重用 provider edit 頁：

   - [packages/stage-pages/src/pages/settings/providers/chat/[providerId].vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/providers/chat/%5BproviderId%5D.vue)

   因為該頁明顯以 API key、base URL、provider validator 為中心，且假設最終要回到 provider/model selection 流程。記憶頁則應更接近「模組設定」，因此建議建立獨立的 scenario components：

   - `packages/stage-ui/src/components/scenarios/memory/memory-overview.vue`
   - `packages/stage-ui/src/components/scenarios/memory/short-term-memory-settings.vue`
   - `packages/stage-ui/src/components/scenarios/memory/long-term-memory-settings.vue`
   - `packages/stage-ui/src/components/scenarios/memory/memory-validation-alerts.vue`

5. **第一版先完成設定持久化、configured 判定與健康檢查 contract**

   首版不應被 runtime 全流程阻塞。優先順序應為：

   - 設定頁能輸入與保存
   - `configured` 狀態能正確反映是否完成最小必要欄位
   - 能執行最小驗證或 health check
   - 模組列表與總覽頁能顯示狀態

   之後再接：
   - `mem0` recall / write smoke test
   - `llm-wiki` workspace / query smoke test
   - promotion gate
   - orchestration integration

6. **記憶總覽頁做導覽與狀態聚合，不承擔全部設定表單**

   [packages/stage-pages/src/pages/settings/memory/index.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/memory/index.vue) 應該是總覽頁，而不是把所有短期與長期欄位堆在同一頁。它的責任應包括：

   - 顯示短期記憶卡片
   - 顯示長期記憶卡片
   - 顯示 `configured` / `enabled` / `health` 狀態
   - 提供前往子頁的入口
   - 補充角色說明：
     - `mem0` 管近期記憶
     - `llm-wiki` 管長期知識

7. **configured 與 validated 由記憶 store 顯式提供，而不是在 UI 端臨時推導**

   [packages/stage-ui/src/composables/use-modules-list.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/composables/use-modules-list.ts) 現在對兩個記憶模組都寫死 `configured: false`。實作時應改為由新 store 暴露：

   - `shortTermMemoryStore.configured`
   - `longTermMemoryStore.configured`

   另外也應由 store 保存獨立的 `validationStatus` 與 `lastValidation`。這樣 configured 不會被誤當成已驗證可用，詳細頁也能顯示最近一次健康檢查結果。

8. **新的記憶模組必須接入既有 module reset / data maintenance 流程**

   AIRI 現在已經有既有的模組重設入口：

   - [packages/stage-ui/src/composables/use-data-maintenance.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/composables/use-data-maintenance.ts)

   `resetModulesSettings()` 目前只會清 hearing、speech、consciousness、twitter、discord、factorio、minecraft 等模組，還不包含新的記憶模組。既然本變更已經明確把短期記憶與長期記憶建模為 module store，就應把它們納入同一條 reset path，避免使用者在「Reset module settings」後仍保留舊的記憶設定。

## Risks / Trade-offs

- [過早抽象成超通用記憶框架，導致首版複雜度上升] → 首版只正式支援 `mem0` 與 `llm-wiki`，不暴露 backend selector，只保留未來 adapter 擴充位置。
- [把記憶 backend 塞進 provider registry，造成 UI 與術語污染] → 將其留在 module store 與記憶頁專用 components。
- [與 OpenClaw 參考架構文件看起來不一致] → 在文檔中明確區分「設定模型」與「runtime orchestration topology」兩個層次。
- [configured 判定太鬆，讓使用者以為系統已可運作] → 將 `configured` 與 `validated` 分開建模，避免只填欄位就誤判為完全可用。
- [第一版要求接太多 runtime 細節，拖慢落地] → 先以設定、驗證與狀態聚合為主，將 recall/query/promotion 放到後續階段。

## Migration Plan

1. 將現有 `WIP` 記憶頁替換為正式總覽頁與兩個子頁配置畫面。
2. 新增短期記憶與長期記憶 store，定義 persisted keys、default values 與 configured 規則。
3. 新增記憶專用 scenario components，將 UI 與 provider settings flows 解耦。
4. 更新模組列表 configured 狀態來源，並為詳細頁補上 validation state 呈現。
5. 將新記憶 store 接入既有 module reset / data maintenance 路徑。
6. 新增 i18n 文案與欄位說明。
7. 第二階段再接入具體 runtime validators 與 smoke checks。

## Confirmed First-Release Decisions

- **短期記憶 backend**：確定採用 `mem0` 技術。首版頁面不提供 backend selector；若實作需要識別欄位，應以固定 `backendId=mem0` 表達，而不是暴露可切換 provider。
- **長期記憶 backend**：確定採用 `llm-wiki` 技術。首版頁面不提供 backend selector；若實作需要識別欄位，應以固定 `backendId=llm-wiki` 表達，而不是暴露可切換 provider。
- **與 OpenClaw 的關係**：OpenClaw 不是設定 owner；它僅是未來可消費這些設定的 runtime 整合方之一。
- **validated 狀態**：`configured` 與 `validated` 必須分開建模；首版至少要有顯式 validation state 與最近一次檢查結果。
- **首版交付邊界**：設定持久化、configured 狀態、validated 狀態、基本 health check contract、記憶總覽與子頁 UI。

## Open Questions

- **`validated` 是否要作為獨立狀態顯示在模組列表** — owner: settings implementer；狀態：**non-blocking**。validated state 本身是首版必要資料模型，但模組列表是否額外露出圖示或文案可延後決定。
- **`llm-wiki` 的 query / ingest / digest 操作是以命令模板還是 adapter service 表達** — owner: long-term memory implementer；狀態：**non-blocking**。首版只需先固定資料模型與驗證入口，不必先定死 runtime transport。
- **是否需要立即補齊所有 locale** — owner: i18n maintainer；狀態：**non-blocking**。首版至少應補英文 keys，其他語系可採漸進補齊策略。
