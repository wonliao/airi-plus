---
title: opencode 串接 Codex 訂閱用戶研究
description: 說明 opencode 如何正確接入 ChatGPT / Codex 訂閱用戶，以及何時應改用 OpenAI API key
---

# opencode 串接 Codex 訂閱用戶研究

更新日期：2026-04-11

## 結論

如果你要讓 `https://github.com/anomalyco/opencode` 支援「Codex 訂閱用戶」，目前最正確的做法不是自建 OpenAI-compatible proxy，也不是要求使用者輸入 OpenAI API key，而是直接走 opencode 內建的 **OpenAI -> ChatGPT Plus/Pro 登入流程**。

研究後的核心結論如下：

1. opencode 官方文件已明確把 **OpenAI** 列為內建 provider，並且在 `/connect` 流程中提供 **`ChatGPT Plus/Pro`** 這個登入選項。
2. opencode 目前的 provider 實作裡，`openai` 是內建特殊 provider，不是單純靠自訂 `opencode.json` 的 OpenAI-compatible API 模板拼起來的。
3. OpenAI 官方也明確說明：**ChatGPT 訂閱與 API 計費是分開的**。所以如果你的目標是「讓 Codex 訂閱用戶登入」，就不應把這件事設計成「輸入 API key」。
4. 換句話說，對「訂閱用戶」來說，正確整合點是 **ChatGPT account sign-in flow**；對「API 用戶」來說，才是 **OpenAI API key flow**。

## 這代表什麼

### 1. 如果你只是想讓使用者在 opencode 內使用 Codex 訂閱

直接使用 opencode 內建流程即可：

1. 啟動 `opencode`
2. 執行 `/connect`
3. 選擇 `OpenAI`
4. 選擇 `ChatGPT Plus/Pro`
5. 依提示在瀏覽器登入 ChatGPT
6. 登入完成後回到 opencode
7. 執行 `/models` 選擇 OpenAI / Codex 相關模型

這是目前最短、最穩、也是最符合官方產品邏輯的路線。

### 2. 如果你是在做自己的包裝層、安裝器或桌面整合

你的產品應該把「連接 Codex 訂閱」設計成：

- 顯示「使用 ChatGPT 帳號登入」
- 呼叫或引導使用者進入 opencode 的 `/connect -> OpenAI -> ChatGPT Plus/Pro`
- 登入成功後再引導使用者選模型

而不是：

- 要求使用者貼 `sk-...` API key
- 假設 ChatGPT Plus/Pro 可以換成 API credits
- 把訂閱權益偽裝成通用 OpenAI-compatible token

## 官方與 repo 證據

### opencode 官方文件

Context7 抓到的 `providers.mdx` 顯示：

- OpenAI 是 opencode 的內建 provider
- `/connect` 後可選 `ChatGPT Plus/Pro`
- 也仍然保留「手動輸入 API key」作為另一條路

對應意思是：

- `ChatGPT Plus/Pro` 是給訂閱用戶的登入方式
- `Manually enter API Key` 是給 API 用戶的登入方式
- 兩條路徑是並列的，不應混用

### opencode 實作

目前 repo 的 `packages/opencode/src/provider/provider.ts` 中，`openai` 被列在內建 provider 集合，並且對 OpenAI 模型走特殊 `responses(...)` 載入路徑。這代表 OpenAI 支援是 opencode 核心能力的一部分，不只是文件示意。

### OpenAI 官方說明

OpenAI Help Center 目前明確說：

- Codex 包含在 ChatGPT Plus / Pro / Business / Enterprise / Edu 方案中
- 使用 Codex 客戶端時，可以直接以 ChatGPT 帳號登入
- 若先前用 API key 使用 Codex CLI，切換到訂閱登入時應先 `codex logout` 再重新登入
- ChatGPT subscription 不能直接搬到 API；API billing 與 ChatGPT subscription 是分開管理的

這點非常重要，因為它直接決定你的產品 UX 與帳務模型。

## 建議的產品設計

### 方案 A：直接依賴 opencode 內建 OpenAI 登入

適合：

- 你只是想讓使用者在 opencode 裡使用 Codex 訂閱
- 你不打算自行接管 OpenAI 身份驗證
- 你希望跟隨 opencode 官方支援面

做法：

1. 文件與 UI 都寫成「使用 ChatGPT 帳號登入」
2. 首次啟動時引導使用者執行 `/connect`
3. provider 預設選 `OpenAI`
4. auth method 預設選 `ChatGPT Plus/Pro`
5. 完成後再做 `/models` 選型

優點：

- 跟官方文件一致
- 不需要維護敏感 token 交換邏輯
- 升級成本最低

風險：

- 你受 opencode 上游登入流程變動影響
- 需要在文檔中明確標示最低支援版本或「請使用最新版 opencode」

### 方案 B：同時支援訂閱登入與 API key

適合：

- 你的使用者有兩群
- 一群是 ChatGPT/Codex 訂閱用戶
- 一群是 OpenAI API 用戶

建議 UX：

- 選項 1：`使用 ChatGPT Plus/Pro 登入`
- 選項 2：`使用 OpenAI API Key`

不要把這兩個選項合併成同一個表單，也不要寫成「如果你有 ChatGPT Plus，請貼 API key」。

### 方案 C：自建 custom provider

只適合：

- 你接的是自己的 proxy
- 你接的是 OpenAI-compatible gateway
- 你接的是企業內部中介層

不適合：

- 想直接承接 ChatGPT/Codex 訂閱權益

原因很簡單：opencode 的 custom provider 機制本質上是給 API endpoint、header、apiKey 這類標準 provider 參數，不是給 ChatGPT 訂閱登入用的。

## 實作建議

### 對終端使用者的文檔應該這樣寫

```md
1. 在終端啟動 `opencode`
2. 執行 `/connect`
3. 選擇 `OpenAI`
4. 選擇 `ChatGPT Plus/Pro`
5. 在瀏覽器完成 ChatGPT 登入
6. 回到 opencode 執行 `/models`
7. 選擇你要使用的 OpenAI/Codex 模型
```

### 對產品程式的引導邏輯建議

```text
if user_wants_subscription_access:
  show "使用 ChatGPT 帳號登入"
  route_to_opencode_connect_openai_chatgpt_flow()
else if user_has_api_key:
  show "輸入 OpenAI API Key"
  route_to_opencode_connect_openai_api_key_flow()
```

### 對錯誤處理的建議

請明確區分以下錯誤：

- 沒有 ChatGPT 訂閱
- opencode 版本過舊，沒有內建 ChatGPT Plus/Pro 登入
- 使用者其實想走 API key，但選錯登入方式
- 使用者以前用 API key，現在要切換成訂閱登入但尚未清掉舊登入狀態

對最後一種情況，應提示：

```bash
codex logout
```

然後再重新登入。

## 不建議的做法

以下做法都不建議：

1. 把 ChatGPT Plus/Pro 說成「某種 OpenAI API key」
2. 把訂閱用戶導向 custom provider + `@ai-sdk/openai-compatible`
3. 自行 reverse engineer ChatGPT web token 流程後長期依賴
4. 在產品文檔裡混淆「Codex 訂閱可用」與「OpenAI API 可用」

原因：

- 這些做法不是目前官方建議路線
- 帳務模型不同
- 長期維護成本高
- 很容易在版本升級後壞掉

## 建議你在 AIRI 內怎麼落地

如果你要在 AIRI 裡提供「使用 opencode + Codex 訂閱」能力，我建議直接做成兩條明確入口：

1. `使用 ChatGPT / Codex 訂閱登入`
2. `使用 OpenAI API Key`

第一條入口文案聚焦在：

- 需要有效的 ChatGPT 訂閱
- 會跳轉瀏覽器登入
- 登入後即可在 opencode 中使用對應模型

第二條入口文案聚焦在：

- 需要 API billing
- Token usage 另計
- 與 ChatGPT subscription 無關

這樣最不容易讓使用者混淆，也最符合 opencode 與 OpenAI 目前的產品切分。

## 參考來源

- opencode Providers 文件（Context7 對應來源）
  https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/providers.mdx
- opencode provider 實作
  https://github.com/anomalyco/opencode/blob/fb26308bc70a3d515480edf435994e43752c72c8/packages/opencode/src/provider/provider.ts
- OpenAI Help Center: Using Codex with your ChatGPT plan
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- OpenAI Help Center: How can I move my ChatGPT subscription to the API?
  https://help.openai.com/en/articles/8156019

## 一句話總結

要串接 opencode 的 Codex 訂閱用戶，優先採用 **opencode 內建的 OpenAI -> ChatGPT Plus/Pro 登入流程**；只有在使用者本來就是 API 用戶時，才走 API key 路線。
