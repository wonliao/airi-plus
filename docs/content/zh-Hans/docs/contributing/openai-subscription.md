---
title: 串接 OpenAI 订阅
description: 在 AIRI 桌面版中集成与维护 OpenAI 订阅 provider 的开发说明
---

# 串接 OpenAI 订阅

更新日期：2026-04-11

这篇文档面向开发者，说明 AIRI 桌面版是如何串接 `OpenAI 订阅` provider 的，以及后续维护时应该注意什么。

如果你要看的只是用户操作说明，请改看：

- [使用 OpenAI 订阅](/zh-Hans/docs/manual/tamagotchi/openai-subscription)

## 先讲结论

`OpenAI 订阅` 不能直接复用现有 `OpenAI API` provider。

原因不是名字不同，而是底层能力不同：

- `OpenAI` provider 走 API key
- `OpenAI 订阅` provider 走 ChatGPT 订阅登录
- 后端入口不是同一个
- 请求格式与流式响应兼容处理也不是同一个

所以在 AIRI 中，它必须是一个独立 provider。

## 适用范围

当前实现只适用于：

- `apps/stage-tamagotchi`
- Electron 桌面运行时
- 浏览器登录 + 本地 loopback 回调

当前不适用于：

- `stage-web`
- 单纯把 renderer 直接连到 `chatgpt.com`

## 整体架构

目前的串接分成三层：

1. Renderer provider 层
2. Electron 主程序认证与代理层
3. ChatGPT / Codex 后端兼容层

整体流程如下：

1. 用户在设置页点击登录。
2. Renderer 通过 Eventa 调用 Electron main 的登录事件。
3. Electron main 启动本地 loopback server，并打开系统浏览器。
4. 用户在浏览器完成 OpenAI 登录。
5. 回调带着 authorization code 回到本地 loopback。
6. Electron main 交换 token，并把结果发回 renderer。
7. Renderer 把 token 存到本地，并将 provider 标记为已配置。
8. 实际聊天请求时，renderer 不直接请求 ChatGPT 后端，而是走 Electron main 代理。
9. Electron main 负责 refresh token、改写请求、转发到 ChatGPT 订阅后端，并把 SSE 流转换成 xsAI 能吃的格式。

## 为什么一定要走 Electron main 代理

不要把 `OpenAI 订阅` 理解成一个普通的 OpenAI-compatible endpoint。

这里必须让 Electron main 介入，主要原因有四个：

- renderer 直接打 `chatgpt.com` 会遇到 CORS 问题
- 我们不希望为了这个 provider 去放宽 renderer 的 web security
- refresh token 放在 Electron 桌面整合路径里更安全
- 请求格式和响应流都需要一层兼容转换

如果把这些逻辑塞回 renderer，后续维护成本会明显变高。

## 关键文件

### Provider 定义

- [index.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/libs/providers/providers/openai-subscription/index.ts)

这里负责：

- 注册 `openai-subscription` provider
- 定义 provider 名称、描述、模型能力
- 用自定义 `fetch` 替换默认 OpenAI fetch

### Renderer 认证与桌面桥接

- [openai-subscription-auth.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/libs/openai-subscription-auth.ts)

这里负责：

- 读取本地 token
- 提供 renderer 侧认证工具
- 封装转发到 Electron main 的 subscription fetch

### Electron main 认证与代理

- [auth.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/electron/auth.ts)

这里是最核心的地方，负责：

- 打开浏览器开始 OAuth 登录
- 启动 loopback server 接回调
- 交换 access token / refresh token
- 请求发出前检查并 refresh token
- 代理 `openai-subscription` 请求
- 规范化 Responses API 请求
- 把后端 SSE 流转换回 xsAI 当前需要的格式

### Eventa 事件定义

- [eventa.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/shared/eventa.ts)

这里定义了桌面登录与代理所需的事件，例如：

- `electronOpenAISubscriptionAuthStartLogin`
- `electronOpenAISubscriptionAuthCallback`
- `electronOpenAISubscriptionAuthLogout`

## 登录流程怎么接

`OpenAI 订阅` 走的是浏览器登录，不是 API key 表单。

当前实现大致是：

1. 在 renderer 点击登录按钮。
2. 调用 `electronOpenAISubscriptionAuthStartLogin`。
3. Electron main 生成：
   - `state`
   - `code_verifier`
   - `code_challenge`
4. Electron main 启动本地 loopback server。
5. Electron main 组装 OpenAI OAuth authorize URL。
6. 用 `shell.openExternal()` 打开系统浏览器。
7. 浏览器登录完成后回调到：

```text
http://localhost:1455/auth/callback
```

8. Electron main 用 authorization code 换 token。
9. 成功后通过 Eventa 把 token 回传给 renderer。

## Token 在哪里

当前 renderer 会把登录结果保存到本地存储键：

```text
auth/v1/providers/openai-subscription
```

常见字段包括：

- `accessToken`
- `refreshToken`
- `idToken`
- `expiresAt`
- `accountId`

真正请求前仍应以 Electron main 的 refresh 逻辑为准，不要假设 renderer 中的 token 一定没过期。

## 请求代理怎么接

表面上看，renderer 仍然像在创建一个 OpenAI-compatible provider，但它实际不会直接请求 OpenAI API。

当前策略是：

1. renderer 组装与 xsAI 相容的请求
2. 自定义 `fetch` 把请求转交 Electron main
3. Electron main 决定是否 refresh token
4. Electron main 把请求改写到 ChatGPT 订阅后端

当前目标端点是：

```text
https://chatgpt.com/backend-api/codex/responses
```

## 为什么需要请求规范化

ChatGPT 订阅后端虽然看起来接近 Responses API，但不是所有 OpenAI API 风格的输入都能原样通过。

当前代理层会做这些规范化：

- 在缺少时，从 `system` message 推导 `instructions`
- 强制 `store: false`
- 把聊天历史转成 Responses 风格 `input`
- 把 `user` 文本内容映射成后端接受的输入内容类型
- 把 `assistant` 文本内容映射成输出内容类型
- 把 tool 结果映射成 `function_call_output`
- 把 tool 定义压平成后端接受的函数格式
- 处理 `tool_choice`

如果这里有任何一个字段不符合后端预期，就很容易出现先前我们遇过的 400 错误，例如：

- `Instructions are required`
- `Store must be set to false`
- `Missing required parameter: 'tools[0].name'`
- `Invalid value: 'input_text'`

所以这里不要追求“看起来像 OpenAI 就直接透传”，而要明确维护一份兼容子集。

## 为什么还要做 SSE 转换

目前 xsAI 的消费路径仍偏向 Chat Completions 风格的流。

但 `OpenAI 订阅` 这边后端返回的是 Responses API 风格事件流，所以 Electron main 还需要做一次转换，把后端事件整理成 `@xsai/stream-text` 能正常消费的 SSE chunk。

这层转换坏掉时，常见表现会是：

- 能发请求，但前端一直没内容
- `Stream steps` / `Stream messages` / `Stream usage` 报错
- 服务端明明返回 200，但 AIRI 没法渲染回复

## 开发时建议怎么改

如果你要继续维护这个 provider，建议按下面顺序改：

1. 先确认改的是认证问题、请求问题，还是流转换问题
2. 优先从 Electron main 代理层下手，不要先改 renderer UI
3. 修改请求结构时，同时检查：
   - payload normalization
   - tool 定义映射
   - SSE 翻译逻辑
4. 修改登录流程时，同时检查：
   - authorize URL 参数
   - callback path
   - token exchange
   - 本地状态恢复

## 常见维护边界

### 可以继续扩展的部分

- 登录成功后的 UI 引导
- provider 状态展示
- 默认模型策略
- 更多错误提示与恢复流程

### 不建议轻易改动的部分

- renderer 直接请求 `chatgpt.com`
- 为了省事而关闭 renderer web security
- 把 `OpenAI 订阅` 和 `OpenAI API` 合并成同一条 transport

这些做法短期看似简单，后面通常会更难修。

## 测试建议

至少覆盖以下几类测试：

- 登录成功
- token refresh 成功
- token refresh 失败
- 请求 payload 规范化
- tool calling 请求映射
- SSE 流转换

现有高风险逻辑的测试重点在：

- [auth.test.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/electron/auth.test.ts)

如果你要做手动验证，可再搭配：

- [OpenAI 订阅 Provider 验证清单](/zh-Hans/docs/manual/tamagotchi/openai-subscription-validation)

## 一句话原则

把 `OpenAI 订阅` 当成“桌面版专用、带认证和协议兼容层的独立 provider”，而不是“换个 base URL 的 OpenAI API”。
