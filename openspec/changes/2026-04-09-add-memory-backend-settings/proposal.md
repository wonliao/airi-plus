## Why

AIRI 目前已經有 `設定 -> 記憶`、`設定 -> 記憶 -> 短期記憶`、`設定 -> 記憶 -> 長期記憶` 的路由與模組入口，但實際頁面仍是 `WIP`。這讓 `mem0` 與 `llm-wiki` 雖然在架構討論中已經被視為重要能力，卻還沒有一個清楚、穩定、可擴充的 AIRI 原生設定模型可供後續實作。

現有參考整合文件多以 `OpenClaw + Mem0 + llm-wiki` 的 orchestration 拓樸描述三者關係，但那代表的是一條整合路線，而不是 AIRI UI 與設定層必須接受的耦合方式。若把 `mem0` 與 `llm-wiki` 直接建模成 `openclaw.*` 設定，會造成幾個問題：

- `openclaw` 是聊天與 orchestration 入口，不等於記憶 backend 本身。
- `mem0` 與 `llm-wiki` 的能力邊界不同，前者偏短期事件記憶，後者偏長期知識編譯，直接掛在同一個 provider 名下會讓 UI 與資料模型語意混亂。
- 未來若 AIRI 要直接驅動本地 adapter、CLI、檔案工作流或其他 runtime，而不是透過 OpenClaw，中間會出現不必要的資料遷移與命名負擔。

因此，AIRI 需要一套原生的記憶 backend 設定模型，將：

- 確立短期記憶使用 `mem0` 技術作為 backend
- 確立長期記憶使用 `llm-wiki` 技術作為 backend
- 與 `openclaw` 的整合保留在 runtime adapter 層，而不是綁死在設定模型內

## What Changes

- 將 AIRI 的 `Memory` 設定由 `WIP` 規劃為正式功能，包含總覽頁、短期記憶設定頁與長期記憶設定頁。
- 新增短期記憶設定模型，首版固定配置 `mem0` 技術，不提供 backend selector。
- 新增長期記憶設定模型，首版固定配置 `llm-wiki` 技術，不提供 backend selector。
- 將記憶設定建模為模組 store，而不是沿用既有 chat / speech / transcription provider registry。
- 定義 `mem0` 與 `llm-wiki` 的健康檢查、configured 狀態、validated 狀態與基本驗證欄位，但首版不要求一次接上完整 recall/capture/promotion 全流程。
- 明確要求記憶設定命名與資料路徑不得依附 `openclaw`，例如避免 `openclaw.mem0.*`、`openclaw.wiki.*` 之類的 schema。
- 保留未來的 runtime 整合點，允許 OpenClaw 或其他 orchestration 層消費這些設定，但不反向佔有其資料模型。
- 要求新的記憶模組接入既有 module reset / data maintenance 流程，避免使用者重設模組設定時留下殘存記憶配置。
- 此 capability 的驗收將以 example-driven spec 進行，覆蓋設定建模、UI 分頁、configured 狀態、驗證邊界與與 OpenClaw 的解耦規則。

## Capabilities

### New Capabilities
- `memory-backend-settings`: 讓 AIRI 以原生設定模型配置短期記憶與長期記憶 backend，首版分別固定採用 `mem0` 與 `llm-wiki` 技術。

### Modified Capabilities
- `settings-memory-pages`: 將現有記憶設定頁從 `WIP` 提升為可配置的正式模組頁面。

## Impact

- 影響 [packages/stage-pages/src/pages/settings/memory/index.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/memory/index.vue)、[packages/stage-pages/src/pages/settings/modules/memory-short-term.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/modules/memory-short-term.vue)、[packages/stage-pages/src/pages/settings/modules/memory-long-term.vue](/Users/ben/AI_Project/airi-plus/packages/stage-pages/src/pages/settings/modules/memory-long-term.vue) 的資訊架構與內容。
- 影響 `packages/stage-ui/src/stores/modules/` 下的模組 state，因為需要新增短期記憶與長期記憶 store。
- 影響 [packages/stage-ui/src/composables/use-modules-list.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/composables/use-modules-list.ts) 的 configured 狀態來源。
- 影響 [packages/stage-ui/src/composables/use-data-maintenance.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/composables/use-data-maintenance.ts) 的模組重設路徑，因為新的記憶模組也應被納入 reset flow。
- 影響 `packages/stage-ui/src/components/scenarios/` 下的設定 UI 組件，因為需要新增記憶專用的 scenario components。
- 影響 [packages/i18n/src/locales/en/settings.yaml](/Users/ben/AI_Project/airi-plus/packages/i18n/src/locales/en/settings.yaml) 與其他語系文案，因為需要補齊記憶 backend 的設定欄位與說明。
- 不影響既有 chat / speech / transcription provider registry 的分類語意，也不要求將 `mem0` 或 `llm-wiki` 註冊成一般模型 provider。
- 回滾策略為保留 route 與模組入口、停用新記憶 store 與設定畫面，恢復為 `WIP` 頁面，不需回滾 OpenClaw 或現有 provider 功能。
