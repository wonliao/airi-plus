# AIRI Memory Architecture Review

這份文件整理目前 AIRI 記憶系統的架構狀態、設計優點、主要風險，以及建議的優先修正方向。

目標不是否定現有實作，而是幫團隊判斷：

- 目前這套記憶系統是否合理
- 哪些地方已經是正確方向
- 哪些地方還屬於 first-release / experimental 設計
- 下一輪重構應該先做什麼

## Executive Summary

目前 AIRI 的記憶系統，整體方向是合理的。

它已經把幾個容易互相污染的責任拆開：

- `airi-card`: 人格、語氣、身份感
- `mem0` / short-term memory: 使用者個人事實與近期偏好
- `llm-wiki`: 穩定世界知識與長期資料
- routing: 決定一則訊息要查哪一種記憶

這個責任切分本身是對的，而且比很多把 persona、knowledge、memory 全塞進同一層 prompt 的設計成熟。

但目前實作仍偏實驗性，核心問題不在於「有沒有記憶功能」，而在於：

- recall context 的注入語義不夠準
- routing 預設太激進
- short-term capture 來源控制不夠嚴格
- Mem0 deployment mode、identity canonicalization 與 recall / capture policy 還需要持續收斂

如果把目標定義為「先做出可用版本」，這套系統是成立的。

如果把目標定義為「穩定、可信、可擴充的長期記憶架構」，這套系統還需要一輪針對 prompt semantics、capture policy 與 backend mode 的整理。

## Current Architecture

### 1. Persona Layer

人格層由 `airi-card` 負責，定義：

- AIRI 應該怎麼說話
- 如何自我指認
- 語氣、節奏與情緒呈現
- recall 後的內容應該怎麼被表述

它不應該承擔：

- 世界觀知識庫
- 使用者個人記憶
- recall routing

相關位置：

- [packages/stage-ui/src/stores/modules/airi-card.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/airi-card.ts)
- [packages/stage-ui/src/stores/modules/airi-card-presets/README.md](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/airi-card-presets/README.md)

### 2. Short-Term Memory Layer

短期記憶主要負責：

- 使用者名字
- 使用者偏好
- 最近但仍值得保留的個人事實
- 需要跨 turn 持續記住的 user-specific facts

目前 short-term memory 已收斂為 Mem0 HTTP client integration，並固定由 Electron 啟動 AIRI-managed local Mem0 sidecar。

capture 仍保留：

- built-in heuristic capture
- upstream Mem0 端的抽取與寫入決策

相關位置：

- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)
- [packages/stage-ui/src/stores/chat/memory-extraction.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-extraction.ts)
- [packages/stage-ui/src/stores/chat/memory-reconcile.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-reconcile.ts)

Electron 桌面端現在負責：

- validation
- remote API connectivity probe
- local sidecar lifecycle management
- search
- capture
- clear / list

相關位置：

- [apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts)

### 3. Long-Term Knowledge Layer

長期知識層由 `llm-wiki` 承擔，主要負責：

- 世界觀
- 角色背景
- 穩定 lore
- 文件化知識

它比較像「可查詢的 wiki workspace」，而不是一個自動生長的知識圖譜。

目前 AIRI Electron 已能：

- 初始化預設 workspace
- 驗證 workspace
- 查詢 wiki 頁面
- 回傳 excerpt 與 score

相關位置：

- [packages/stage-ui/src/stores/modules/memory-long-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-long-term.ts)
- [apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts)

### 4. Routing Layer

routing 負責決定：

- 這則訊息要不要查 short-term memory
- 這則訊息要不要查 long-term wiki
- 這則訊息是否應該直接交給 role card 回答

目前有兩層：

- character identity routing
- memory routing

相關位置：

- [packages/stage-ui/src/stores/chat/character-routing.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/character-routing.ts)
- [packages/stage-ui/src/stores/chat/memory-routing.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.ts)
- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)

## What Is Good About The Current Design

### Responsibility split is clear

這是目前最大優點。

人格、短期記憶、長期知識與 routing 沒有被揉成一團，這對後續維護、除錯與產品化都非常重要。

### The system is already integrated into real chat flow

這不是停在概念層的記憶系統。

在送出訊息時，chat flow 已經會：

- 判斷 identity routing
- 判斷 memory routing
- 觸發 `llm-wiki` recall
- 觸發 short-term recall
- 在回應完成後做 short-term capture

這表示整體設計已經落到產品路徑上，而不是只在獨立 prototype 中存在。

### HTTP-first sidecar mode simplifies the product model

把 short-term memory 收斂成「HTTP-first Mem0 client」模式，並固定落到 AIRI-managed local Mem0 sidecar。

它的好處是：

- AIRI 仍以 client 身分透過 HTTP 使用 Mem0，而不是把短期記憶邏輯散落在 renderer / main / store
- UI 欄位能對應到真正生效的 backend 行為
- sidecar 的 provider、embedding 與儲存責任被關進獨立 runtime，而不是滲進整個 Electron app

### The team already recognizes source separation

從文件與程式結構看得出來，系統已經明確意識到：

- role card 不等於 wiki
- wiki 不等於 personal memory
- memory routing 不等於 speaking style

這代表設計方向是有架構意識的，而不是純靠 prompt 疊加。

## Main Architecture Risks

### Risk 1: Recalled memory is injected as `user` messages

目前 recall 結果會被組成 `role: 'user'` 的 prompt injection，插在 system 後面。

相關位置：

- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts#L373)

這在語義上不夠準確，因為這些資料其實不是新的 user utterance，而是檢索到的上下文。

風險：

- 模型把 recall 內容誤認為使用者剛剛說的話
- 模型把 retrieved facts 當成對話歷史，而不是參考資料
- assistant 對 recalled facts 過度自信
- 多輪後更難分析 prompt 污染來源

這是目前最值得優先修的問題。

### Risk 2: Routing fallback is too aggressive

目前 `memory-routing` 的 fallback 是 `hybrid`。

相關位置：

- [packages/stage-ui/src/stores/chat/memory-routing.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.ts#L88)

這代表只要訊息沒有被 regex 明確分流，就會同時查：

- short-term memory
- long-term wiki

風險：

- token 成本增加
- 延遲增加
- recall 噪音增加
- 一般閒聊也被過度檢索
- 更容易出現答非所問

在記憶系統中，保守 recall 往往比全面 recall 更穩。

### Risk 3: Short-term capture includes assistant output

聊天完成後，系統會把：

- user message
- assistant full response

一起送進 short-term capture。

相關位置：

- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts#L535)

這代表記憶候選不只可能來自使用者原始陳述，也可能來自 assistant 的重述、推論或誤解。

風險：

- hallucinated facts 被反向固化
- assistant 誤解使用者偏好後，錯誤資訊被當成記憶
- 使用者一旦被誤記，之後 recall 會持續放大錯誤

這不是不能做，但需要更嚴格的 source policy。

### Risk 4: Mem0 contract drift between AIRI and the sidecar

UI、store 與 Electron service 現在都已經改成 HTTP-first Mem0 client 模式，但後續仍要注意 AIRI 與 sidecar 契約不要漂移。

相關位置：

- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts#L342)
- [apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts#L1178)

風險：

- sidecar 若升級 `mem0ai` 後改變 response shape，AIRI 也要同步驗證
- 若 scope 或 sidecar startup contract 調整，UI 驗證文案可能失真
- debug panel 顯示的是 AIRI 端觀察到的 request / result，不是 backend 端完整內部狀態

### Risk 5: llm-wiki is a query layer, but not yet a full knowledge workflow

目前 `llm-wiki` 比較像一個文件 workspace 的檢索器，而不是完整 knowledge lifecycle。

系統已經有：

- `allowPromotion`
- `manualReviewRequired`
- `personaReviewRequired`

但這些比較像設計意圖，還沒有完全形成真實工作流。

風險：

- long-term memory 難以持續擴充
- 記憶 promotion 缺少可追蹤流程
- 世界知識與 persona 資料的維護會逐漸分裂

## Reasonableness Assessment

如果問題是：

「這個記憶系統設計是否合理？」

答案是：

**合理，但目前還不是穩定版架構，而是合理的第一代架構。**

更精確地說：

- 架構分層合理
- 產品方向合理
- 實作策略仍需收斂

它已經具備成長為穩定系統的基礎，但還需要把 recall semantics、capture source policy、routing default 這幾塊收緊。

## Priority Fix List

### Priority 1: Replace `user`-role recall injection with retrieval context injection

#### Problem

recalled memory / wiki 內容目前被插成 `user` 訊息，語義錯誤。

#### Refactor Direction

- 將 recalled context 改成專用 retrieval context
- 至少先改成 `system`
- 更理想是與現有 context prompt 機制整合成同一層

#### Expected Shape

建議統一成單一訊息：

```text
[Retrieved Short-Term Memory]
...

[Retrieved Long-Term Knowledge]
...

[Instructions]
These references were retrieved from memory systems. They are supporting context, not new user messages.
```

#### Target Files

- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)

### Priority 2: Make routing conservative by default

#### Problem

目前 fallback 太常進 `hybrid`。

#### Refactor Direction

- `personal-memory` signal 明確時，只查 short-term
- `knowledge` signal 明確時，只查 long-term
- ambiguous 訊息時，預設不 recall 或只查單一來源
- hybrid 只在明確雙訊號下使用

#### Suggested Policy

- strong personal signal -> short-term only
- strong knowledge signal -> long-term only
- weak / no signal -> no recall
- dual strong signals -> hybrid

#### Target Files

- [packages/stage-ui/src/stores/chat/memory-routing.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.ts)
- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)

### Priority 3: Restrict short-term capture to user-originated facts

#### Problem

assistant output 目前也參與記憶抽取。

#### Refactor Direction

- 第一階段先只對 `user` content 做 extraction
- assistant content 只作上下文，不可直接成為可寫入記憶的來源
- extraction candidate 增加 source / provenance
- reconcile 僅允許 user-originated candidates 進入 write path

#### Target Files

- [packages/stage-ui/src/stores/chat.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)
- [packages/stage-ui/src/stores/chat/memory-extraction.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-extraction.ts)
- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)

### Priority 4: Remove the old desktop-local memory mode split

#### Problem

當時的 embedded local runtime 與現在的 AIRI-managed local sidecar 心智一度混在一起。

#### Refactor Direction

- 收斂為單一 Mem0 HTTP client mode
- 只展示真正會生效的 backend connection 欄位
- sidecar 維持單一 capture / recall / clear / list 契約
- validation message 依 mode 呈現

#### Target Files

- [packages/stage-ui/src/stores/modules/memory-short-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)
- [apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/airi/memory-validation/index.ts)
- [packages/i18n/src/locales/en/settings.yaml](/Users/ben/AI_Project/airi-plus/packages/i18n/src/locales/en/settings.yaml)

### Priority 5: Add provenance and confidence to memory items

#### Problem

目前 recall 雖然有 score，但 prompt 端與資料結構端都缺少完整 provenance。

#### Refactor Direction

short-term memory item 建議增加：

- `source`
- `capturedAt`
- `confidence`
- `originTurnId`

long-term recall item 建議增加：

- `documentKind`
- `retrievalReason`

#### Benefits

- 更容易除錯
- 更容易做衝突處理
- 更容易避免模型過度相信低品質記憶

### Priority 6: Turn llm-wiki into a full promotion workflow

#### Problem

目前 llm-wiki 已能查，但尚未形成完整知識升級流程。

#### Refactor Direction

- short-term / chat facts -> candidate
- review queue
- manual review
- promote to wiki page or wiki update
- keep persona review as explicit gate

#### Target Files

- [packages/stage-ui/src/stores/modules/memory-long-term.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-long-term.ts)

## Recommended Implementation Order

建議順序如下：

1. 修 recall 注入方式
2. 收斂 routing 預設策略
3. 限制 short-term capture 的來源
4. 拆分 local / remote memory backend mode
5. 補 provenance / confidence
6. 建立 llm-wiki promotion workflow

這個順序的原因是：

- 前三項直接影響回答品質與記憶可信度
- 第四項影響產品理解與設定一致性
- 後兩項屬於中期可擴充性建設

## Recommended Success Criteria

完成上述調整後，記憶系統應至少滿足這些條件：

- recalled context 不再被模型視為新的 user utterance
- 大多數普通閒聊不會自動觸發雙來源 recall
- short-term memory 的新增來源可追溯，且不會主要依賴 assistant 自述
- local mode 與 remote mode 的 UI / runtime / validation 一致
- long-term knowledge promotion 有可觀察、可審核的流程

## Final Verdict

目前 AIRI 的記憶系統不是失敗設計。

相反地，它已經具備一個好系統最重要的條件：**責任切分是對的。**

真正需要修的，是那些會讓正確架構在實務上失真的策略層細節：

- prompt injection semantics
- routing defaults
- capture provenance
- backend mode clarity

只要把這幾項收緊，這套設計很有機會從「合理的第一版」進化成「穩定可信的長期架構」。
