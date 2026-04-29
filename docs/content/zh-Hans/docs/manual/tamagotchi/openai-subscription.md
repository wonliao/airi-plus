---
title: 使用 OpenAI 订阅
description: 如何在 AIRI 桌面版中使用 OpenAI 订阅 provider 登录 ChatGPT 订阅并开始聊天
---

# 使用 OpenAI 订阅

更新日期：2026-04-11

`OpenAI 订阅` 是 AIRI 桌面版中的实验性 provider，用来让你直接使用 **ChatGPT 订阅账号** 登录，而不是输入 OpenAI API key。

如果你已经有 ChatGPT Plus / Pro 一类的订阅，希望直接在 AIRI 中聊天，这个 provider 就是给你用的。

## 它和 OpenAI API 有什么不同

虽然两者都来自 OpenAI，但使用方式并不一样：

- `OpenAI` provider：给 OpenAI API 用户使用，需要输入 API key。
- `OpenAI 订阅` provider：给 ChatGPT 订阅用户使用，通过浏览器登录账号。

这两个入口不能互相替代。

如果你只有：

- ChatGPT 订阅，没有 API key：请使用 `OpenAI 订阅`
- OpenAI API key，没有 ChatGPT 订阅：请使用 `OpenAI`

## 适用范围

目前仅适用于：

- AIRI Electron 桌面版
- 已登录且拥有有效 ChatGPT 订阅的账号

目前不适用于：

- Web 版 AIRI
- 仅凭 API key 的使用方式

## 开始前请先确认

开始设置前，建议先确认以下几点：

1. 你使用的是桌面版 AIRI。
2. 这台电脑可以访问 `https://auth.openai.com` 与 `https://chatgpt.com`。
3. 系统默认浏览器可以正常打开并完成 OpenAI 登录。
4. 你的 OpenAI 账号具备有效 ChatGPT 订阅。

## 设置步骤

### 1. 打开 provider 设置

进入：

```text
设置 -> 服务来源 -> OpenAI 订阅
```

如果你是第一次启动 AIRI，也可以在入门引导里直接选择 `OpenAI 订阅`。

### 2. 点击登录

在 `OpenAI 订阅` 页面中，点击登录按钮。

这时 AIRI 会：

- 调起系统默认浏览器
- 打开 OpenAI 登录页
- 等待你完成登录与授权

### 3. 在浏览器完成登录

在浏览器中按提示完成 OpenAI 登录。

成功后，AIRI 会接收桌面版回调，并把登录状态保存到本地。正常情况下，你不需要手动复制 token，也不需要输入 API key。

### 4. 回到 AIRI 确认连接状态

登录成功后，`OpenAI 订阅` 页面应显示：

- 已连接
- provider 状态有效
- 可以继续作为当前聊天 provider 使用

此时点击页面中的使用按钮，AIRI 会把当前意识模块的服务来源切到 `OpenAI 订阅`，并将默认模型设为 `gpt-5.4`。

## 模型选择

完成登录后，你可以在：

```text
设置 -> 意识
```

里选择当前要使用的模型。

当前实现支持的订阅模型包括：

- `gpt-5.1-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`

实际可用模型仍取决于当前账号与后端返回结果。

## 使用时会发生什么

当你选择 `OpenAI 订阅` 作为聊天来源时：

- AIRI 会使用你登录得到的订阅凭证
- 请求会由 Electron 主程序代理
- 不需要放宽 renderer 的 web security
- 不会要求你再输入 OpenAI API key

这样做的目的，是让桌面版能安全处理登录状态、token refresh 与请求代理。

## 登出

如果你想断开当前账号，可以回到：

```text
设置 -> 服务来源 -> OpenAI 订阅
```

然后点击退出登录。

退出后：

- 本地登录状态会被清除
- provider 会回到未连接状态
- 后续聊天将不能继续使用这个订阅会话

## 常见问题

### 为什么不能直接复用 OpenAI API provider？

因为 `OpenAI 订阅` 不是 API key 流程，而是 ChatGPT 订阅登录流程。两边的认证方式、请求入口、流式响应兼容处理都不同，所以需要独立 provider。

### 为什么这个功能只支持桌面版？

目前回调登录、token 保存与请求代理都依赖 Electron 主程序，因此暂时只支持 AIRI 桌面版。

### 登录成功了，但还是不能聊天怎么办？

建议依序检查：

1. 当前意识模块的服务来源是否真的切到了 `OpenAI 订阅`
2. 当前模型是否已正确选择
3. 网络是否能访问 `chatgpt.com`
4. 是否曾保存过旧的无效登录状态

如果你正在做功能验证，也可以参考更详细的排查文档：

- [OpenAI 订阅 Provider 验证清单](/zh-Hans/docs/manual/tamagotchi/openai-subscription-validation)

## 建议怎么选

如果你不确定该选哪个 provider，可以直接用这条规则：

- 想用 ChatGPT 订阅账号登录：选 `OpenAI 订阅`
- 想用 API key 与 API 计费：选 `OpenAI`

这样最不容易混淆。
