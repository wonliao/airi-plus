---
title: OpenAI 订阅本机登录修复总结
description: Vite 开发模式下 OpenAI 订阅 provider 的本机 bridge、OAuth callback 与风险检查记录
---

# OpenAI 订阅本机登录修复总结

更新日期：2026-04-30

这份文档记录 `OpenAI 订阅` provider 在本机 Vite 开发模式下的登录修复、验证结果与风险检查。

## 背景

本次问题出现在：

- 前端：`http://localhost:5173/settings/providers/chat/openai-subscription`
- 本机 API bridge：`http://localhost:6112`
- OpenAI OAuth callback：`http://localhost:1455/auth/callback`

用户在设置页点击 `Sign in` 后，先后遇到：

- 被 AIRI 登录门槛挡住，而不是进入 OpenAI 登录
- OpenAI subscription login request failed with HTTP 404
- OpenAI 授权后跳回 `localhost:1455` 但连接被拒绝
- OpenAI 授权页显示 `unknown_error`

根因不是同一个点，而是一串本机开发路径不完整造成的。

## 根因

### 1. 前端错误地要求 AIRI 登录

本机开发时，`OpenAI 订阅` 页面不应该先要求用户登录 AIRI 账号。用户要做的是 OpenAI 登录，不是 AIRI 登录。

因此前端认证工具需要支持没有 AIRI bearer token 的本机 session。

### 2. 本机 API bridge 地址不对

默认 server URL 指向远端 AIRI API，Vite 本机页面应优先使用本机 bridge：

```text
http://localhost:6112
```

这样 `/api/v1/openai-subscription/*` 才会打到本机 Docker API。

### 3. OpenAI OAuth callback 不能随意改成 6112

本机 API 可用后，曾经把 redirect URI 产生成：

```text
http://localhost:6112/api/v1/openai-subscription/oauth/callback
```

这会让 OpenAI 授权页返回 `unknown_error`。实际可用的 loopback callback 是：

```text
http://localhost:1455/auth/callback
```

因此本机 API 需要同时：

- 继续在 `6112` 提供前端 bridge API
- 在 `1455` 接 OpenAI OAuth callback

### 4. Callback 不能依赖前端自定义 header

OAuth callback 是 OpenAI 从浏览器跳回本机服务，不会带前端请求用的 `X-OpenAI-Subscription-Session` header。

所以 callback 必须使用 Redis 中的 OAuth state 找回本机 session 对应的 user id，而不能在 callback 阶段重新要求 header。

## 修复内容

### 前端与 stage-ui

相关文件：

- `packages/stage-pages/src/pages/settings/providers/chat/openai-subscription.vue`
- `packages/stage-ui/src/libs/openai-subscription-auth.ts`
- `packages/stage-ui/src/stores/onboarding.ts`

主要调整：

- 移除本页面的 AIRI 登录阻挡，让用户直接进行 OpenAI 登录。
- 本机开发时自动选择 `http://localhost:6112` 作为 OpenAI subscription server。
- 没有 AIRI token 时，生成并保存本机 session id。
- API 请求带上 `X-OpenAI-Subscription-Session`。
- 全局 onboarding 不再挡住 OpenAI subscription 设置页。

### Server bridge

相关文件：

- `apps/server/src/routes/openai-subscription/index.ts`
- `apps/server/src/services/openai-subscription.ts`
- `apps/server/src/app.ts`
- `apps/server/docker-compose.yml`

主要调整：

- `oauth/start`、`status`、`logout`、`proxy` 支持本机 session header。
- 本机 session 会映射成内部 user id，并在数据库中建立本机专用 user。
- localhost 环境的 OAuth redirect URI 固定为：

```text
http://localhost:1455/auth/callback
```

- API app 增加顶层 `/auth/callback`，复用 OpenAI subscription callback handler。
- Docker API 同时映射：

```text
6112:3000
1455:3000
```

- Docker healthcheck 改用 Node 内建 `fetch`，避免 Alpine image 内没有 `curl` 导致服务可用但健康检查失败。

## 本机开发启动路径

本机调试时需要同时运行：

1. Vite 前端：

```bash
pnpm dev
```

2. Server Docker API：

```bash
docker compose -f apps/server/docker-compose.yml up -d --build api
```

如果 macOS shell 找不到 Docker CLI，可使用 Docker Desktop 内置路径：

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" \
  /Applications/Docker.app/Contents/Resources/bin/docker compose \
  -f apps/server/docker-compose.yml up -d --build api
```

## 验证结果

已验证：

- `http://localhost:6112/health` 返回 200。
- `http://localhost:1455/health` 返回 200。
- Docker API container 显示 `healthy`。
- `/api/v1/openai-subscription/status` 在本机 session header 下返回正常 JSON。
- `/api/v1/openai-subscription/oauth/start` 产出的 authorize URL 包含：

```text
redirect_uri=http://localhost:1455/auth/callback
```

- `http://localhost:1455/auth/callback?code=probe&state=missing` 会进入 OpenAI subscription callback handler，并返回预期的 state 过期错误，而不是连接失败或 404。

已执行测试：

```bash
pnpm exec vitest run packages/stage-ui/src/libs/openai-subscription-auth.test.ts
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/server exec vitest run src/routes/openai-subscription/route.test.ts
pnpm -F @proj-airi/server typecheck
pnpm exec eslint apps/server/src/routes/openai-subscription/index.ts apps/server/src/routes/openai-subscription/route.test.ts apps/server/src/app.ts
```

另外执行过：

```bash
pnpm -F @proj-airi/stage-pages typecheck
```

结果仍失败在既有的 `src/pages/settings/providers/speech/frieren-rvc-sidecar.vue`，错误为 `profilingResponseFormat` 的 `string` 类型不能赋给 `"mp3" | "wav" | undefined`。该错误不在本次 OpenAI subscription 修改路径内。

## 风险检查

### Token 与 session 风险

风险：本机 session id 存在 localStorage，属于开发模式 bridge 的身份映射凭证。

当前控制：

- session id 只用于本机 OpenAI subscription bridge。
- session id 格式限制为 `^[\w-]{16,128}$`。
- token 仍保存在 server 端账户记录中，并使用既有加密服务处理。

剩余风险：

- 同一浏览器 profile 内的本机 session 会持续复用。
- 如果需要多人共用同一台开发机，应手动 logout 或清理 localStorage。

### OAuth callback 风险

风险：`/auth/callback` 是顶层路由，且不要求 AIRI app auth。

当前控制：

- callback 必须带有 Redis 中存在且未过期的 OAuth state。
- state 使用后会立即删除。
- 若当前请求已有 AIRI user，则会检查 state user id 是否一致。
- 没有 state 或 state 过期时返回 `OPENAI_SUBSCRIPTION_OAUTH_STATE_EXPIRED`。

剩余风险：

- 这条路由依赖 OAuth state 的随机性与 Redis TTL。
- 不应把 callback handler 改成接受无 state 的 token exchange。

### Redirect URI 风险

风险：OpenAI OAuth client 对 loopback redirect URI 有白名单限制。

当前控制：

- localhost 环境固定使用 `http://localhost:1455/auth/callback`。
- 非 localhost 环境仍使用 server API URL 下的 `/api/v1/openai-subscription/oauth/callback`。

剩余风险：

- 如果未来 OpenAI client 允许的 loopback URI 改变，需要同步调整 `OPENAI_SUBSCRIPTION_LOCAL_CALLBACK_URL` 与 Docker 映射。

### Docker 端口风险

风险：本机 `1455` 可能被其他服务占用。

当前控制：

- Docker compose 明确映射 `1455:3000` 与 `6112:3000`。
- `1455` 只用于本机 OpenAI OAuth callback。

剩余风险：

- 若端口被占用，Docker API 会启动失败或 callback 无法抵达。
- 排查时先检查 `docker compose ps api` 与 `http://localhost:1455/health`。

### 产品与政策风险

风险：`OpenAI 订阅` 走的是 ChatGPT 订阅登录与 ChatGPT 后端兼容路径，不等同于官方 OpenAI API key provider。

当前控制：

- provider 与 `OpenAI API` 分开实现。
- 请求经 server bridge 代理，不直接在 renderer 请求 ChatGPT 后端。
- 文档中明确标注这是 OpenAI subscription 路径。

剩余风险：

- ChatGPT 后端接口、OAuth 参数或授权策略可能变化。
- 后续维护应优先验证真实登录、token refresh 与响应流转换。

### 既有 typecheck 风险

风险：`packages/stage-pages` 当前仍有与 `frieren-rvc-sidecar.vue` 相关的既有型别错误。

当前控制：

- 本次修改过的 OpenAI subscription 页面已通过针对性 lint。
- `stage-ui` 与 `server` 两个直接承载本次修复的 workspace typecheck 均通过。

剩余风险：

- 在既有 `frieren-rvc-sidecar.vue` 错误修复前，`pnpm -F @proj-airi/stage-pages typecheck` 仍会失败。

## 后续维护建议

1. 不要把 `OpenAI API` provider 与 `OpenAI 订阅` provider 合并。
2. 不要让 renderer 直接请求 `chatgpt.com`。
3. 修改 OAuth redirect URI 前，必须用真实登录流程验证 OpenAI 是否接受。
4. 修改 callback 逻辑时，必须保留 state 校验与一次性删除。
5. 修改 Docker image 后，确认 healthcheck 使用 container 内实际存在的工具。
