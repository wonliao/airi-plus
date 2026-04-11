---
title: OpenAI 订阅 Provider 验证清单
description: 桌面版 openai-subscription provider 的手动验证步骤、预期结果与排错重点
---

# OpenAI 订阅 Provider 验证清单

更新日期：2026-04-11

这份清单用于验证 AIRI 桌面版里的 `openai-subscription` provider 是否可正常工作。

验证重点包括：

- ChatGPT 账号登录是否成功
- 本地 token 是否正确保存
- provider 是否被标记为已配置
- 模型列表是否能正常加载
- 实际聊天请求是否会改写到 ChatGPT 订阅后端
- access token 过期后是否能自动 refresh
- logout 后本地状态是否清理干净

## 适用范围

仅适用于：

- `apps/stage-tamagotchi`
- 桌面版 Electron 运行时
- 拥有有效 ChatGPT 订阅的账号

不适用于：

- Web 版
- 只持有 OpenAI API key、但没有 ChatGPT 订阅的账号

## 验证前准备

开始前请确认：

1. 使用最新版开发分支代码，并已完成依赖安装。
2. 能正常启动桌面版 AIRI。
3. 测试账号具备有效 ChatGPT 订阅。
4. 当前机器可以访问：
   - `https://auth.openai.com`
   - `https://chatgpt.com`
5. 默认浏览器允许跳转并完成 OpenAI 登录。

建议在验证前先清理旧状态，避免 API key 或旧 token 干扰。

## 建议的验证顺序

推荐顺序如下：

1. 初次登录
2. provider 配置状态检查
3. 模型列表检查
4. 实际聊天请求检查
5. token refresh 检查
6. logout 检查
7. 异常路径检查

## 1. 初次登录

### 操作步骤

1. 启动桌面版 AIRI。
2. 打开设置页面。
3. 进入 Chat provider 设置。
4. 打开 `OpenAI Subscription`。
5. 点击登录按钮。
6. 确认浏览器被拉起，并跳转到 OpenAI 登录页。
7. 在浏览器完成登录并授权。
8. 等待回到 AIRI。

### 预期结果

- AIRI 出现登录成功提示。
- 页面状态从“未连接”切换为“已连接”。
- provider 被标记为已配置。
- 不要求用户输入 API key。

### 失败时优先检查

- 浏览器是否有被系统拦截
- 本机是否能访问 `auth.openai.com`
- OpenAI 账号是否真的有订阅
- 回调流程是否成功触发 Electron bridge

## 2. Provider 配置状态检查

### 操作步骤

1. 登录成功后，不重启应用，留在设置页。
2. 检查 provider 卡片状态。
3. 重启 AIRI。
4. 再次进入 `OpenAI Subscription` 设置页。

### 预期结果

- 登录后 provider 立即显示为可用。
- 重启后仍保持已连接状态。
- 页面会自动尝试恢复 provider 配置。

### 可额外检查的本地状态

当前实现会把登录结果存到本地存储键：

```text
auth/v1/providers/openai-subscription
```

预期应能看到下列信息中的大部分：

- `accessToken`
- `refreshToken`
- `idToken`
- `expiresAt`
- `accountId`

## 3. 模型列表检查

### 操作步骤

1. 登录完成后留在 provider 页面。
2. 观察模型列表是否自动刷新。
3. 切换到聊天相关设置，确认 provider 可选。

### 预期结果

- 可看到允许的 OpenAI 订阅模型列表。
- 至少不应出现“未配置 provider”。
- 选择 provider 后，当前实现默认模型应能落到 `gpt-5.4`。

### 当前实现的预期模型集合

当前代码中允许的模型为：

- `gpt-5.1-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gpt-5.3-codex`
- `gpt-5.4`
- `gpt-5.4-mini`

## 4. 实际聊天请求检查

### 操作步骤

1. 将当前聊天 provider 切换为 `openai-subscription`。
2. 发起一轮最简单的聊天请求，例如：

```text
请用一句话介绍你自己。
```

3. 打开开发者工具或代理抓包工具，观察请求目标。

### 预期结果

- 请求不应走用户手填的 OpenAI API key。
- 请求应带上 Bearer token。
- 如果 token 中带有组织/账号信息，应带 `ChatGPT-Account-Id`。
- 请求最终应改写到：

```text
https://chatgpt.com/backend-api/codex/responses
```

### 若聊天失败，优先检查

- 登录 token 是否已过期
- 本地 `refreshToken` 是否存在
- `ChatGPT-Account-Id` 是否被正确解析
- 请求是否仍误走 `https://api.openai.com/v1`

## 5. Token Refresh 检查

### 推荐做法

手动把本地存储中的 `expiresAt` 改成接近现在，或改成已过期，然后重新发起一次聊天请求。

### 预期结果

- AIRI 会先尝试 refresh token。
- refresh 成功后继续发请求。
- 本地存储中的 token 内容被更新。
- 用户不需要再次手动登录。

### 失败时的预期行为

如果 refresh 失败：

- 本地 token 会被清空
- provider 应回到未配置或失效状态
- 后续请求应提示重新登录

## 6. Logout 检查

### 操作步骤

1. 在 `OpenAI Subscription` 页面点击退出登录。
2. 关闭并重新打开设置页。
3. 如有必要，重启 AIRI 再检查一次。

### 预期结果

- 本地 token 被清除。
- provider 不再显示为已连接。
- provider 实例会被释放。
- 模型列表不应继续沿用旧登录状态。

## 7. 异常路径检查

建议至少覆盖以下场景：

### 场景 A：用户取消浏览器登录

预期：

- AIRI 不应误标记为已配置
- 应显示登录失败或取消提示

### 场景 B：无订阅账号登录

预期：

- 应无法正常使用订阅 provider
- UI 不应伪装成已可用

### 场景 C：网络中断

分别在以下阶段测试一次：

- 打开授权页前
- 完成授权回调前
- 发起聊天请求前
- refresh token 时

预期：

- 有明确错误提示
- 不应留下半配置、不可恢复的状态

### 场景 D：重复登录

预期：

- 二次登录不会产生重复 provider 状态
- 新 token 应覆盖旧 token

## 建议记录的验证结果

每次手动验证建议记录：

- AIRI 提交 hash
- 验证日期
- 操作系统版本
- 是否使用代理
- OpenAI 账号订阅类型
- 登录是否成功
- 模型列表是否成功加载
- 首次聊天是否成功
- refresh 是否成功
- logout 是否成功
- 是否出现异常 toast / 控制台错误

## 当前已知限制

截至这次实现，仍需注意：

- 这条 provider 只在桌面版开放
- 它不是 OpenAI API key 模式
- 它依赖 OpenAI 当前的 ChatGPT 登录与订阅后端行为
- 若 OpenAI 后续变更 OAuth 参数、token 结构或 `chatgpt.com` 后端路径，可能需要跟着调整

## 最终验收标准

满足以下条件时，可认为 `openai-subscription` provider 达到可用状态：

1. 用户可通过浏览器完成 ChatGPT 订阅登录。
2. 登录成功后，provider 会在桌面版内自动恢复。
3. 模型列表能正常显示。
4. 实际聊天请求会打到 ChatGPT 订阅后端。
5. token 过期时可自动 refresh。
6. logout 后状态会被完整清理。
7. API key provider 与 subscription provider 不会互相污染状态。
