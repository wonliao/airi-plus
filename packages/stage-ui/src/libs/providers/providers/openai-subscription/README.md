# OpenAI Subscription Provider

Desktop-only ChatGPT subscription integration for AIRI.

## Why this provider exists

This provider is separate from the existing OpenAI API provider because it does not use a normal API key flow.

- `openai` provider: standard OpenAI API surface, API key based.
- `openai-subscription` provider: ChatGPT subscription OAuth flow plus a ChatGPT/Codex backend endpoint.

Even though both are "OpenAI", the request and streaming shapes are different enough that they cannot safely share the same transport path.

## Architecture

The renderer still creates an OpenAI-compatible provider through `@xsai-ext/providers/create`, but its `fetch` implementation is replaced by `createOpenAISubscriptionFetch()`.

Runtime flow:

1. Renderer resolves stored subscription tokens.
2. Renderer forwards the outgoing request to the Electron main process through Eventa IPC.
3. Electron main refreshes tokens when needed.
4. Electron main rewrites compatible OpenAI-style requests to the ChatGPT subscription Codex endpoint.
5. Electron main normalizes request payloads into the subset accepted by the Codex backend.
6. Electron main translates Responses API SSE events back into Chat Completions-style SSE chunks for `@xsai/stream-text`.

## Why the Electron main proxy is required

This provider intentionally avoids direct renderer access to the ChatGPT backend.

- It avoids renderer CORS failures.
- It avoids weakening renderer web security.
- It keeps refresh tokens in the Electron desktop integration path.
- It gives us one place to normalize request and stream formats.

## Compatibility layer

The main-process proxy currently normalizes the following:

- derives `instructions` from `system` messages when needed
- forces `store: false`
- converts chat history into Responses-style `input`
- maps `user` text parts to `input_text`
- maps `assistant` text parts to `output_text`
- maps tool results to `function_call_output`
- flattens tool definitions to the shape expected by the Codex endpoint
- flattens `tool_choice` to the same function-call shape
- translates Responses SSE events into Chat Completions SSE chunks for xsAI

## Important maintenance notes

- Keep this provider desktop-only unless the auth and callback flow changes.
- If `@xsai/stream-text` gains native Responses API stream support, the SSE translation layer can likely be simplified or removed.
- If OpenAI changes the ChatGPT/Codex backend event names or accepted input content types, update the normalization and stream translation logic together.
- The most regression-prone logic is covered by tests in [auth.test.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/electron/auth.test.ts).

## Key files

- Provider definition: [index.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/libs/providers/providers/openai-subscription/index.ts)
- Renderer auth and desktop fetch bridge: [openai-subscription-auth.ts](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/libs/openai-subscription-auth.ts)
- Electron auth, proxying, and stream normalization: [auth.ts](/Users/ben/AI_Project/airi-plus/apps/stage-tamagotchi/src/main/services/electron/auth.ts)
