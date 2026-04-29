import type { IncomingMessage, ServerResponse } from 'node:http'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import { Memory } from 'mem0ai/oss'

const port = Number(process.env.AIRI_MEM0_SIDECAR_PORT ?? '4310')
const dataDir = resolve(process.env.AIRI_MEM0_SIDECAR_DATA_DIR ?? join(process.cwd(), '.airi-mem0-sidecar'))
const openAIApiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
const openAIBaseUrl = process.env.OPENAI_BASE_URL?.trim() ?? ''
const llmModel = process.env.AIRI_MEM0_SIDECAR_LLM_MODEL?.trim() || 'gpt-4.1-mini'
const embedderModel = process.env.AIRI_MEM0_SIDECAR_EMBEDDER_MODEL?.trim() || 'text-embedding-3-small'

if (!openAIApiKey) {
  throw new Error('OPENAI_API_KEY is required for the AIRI-managed local Mem0 sidecar.')
}

mkdirSync(dataDir, { recursive: true })

const memory = new Memory({
  embedder: {
    provider: 'openai',
    config: {
      apiKey: openAIApiKey,
      ...(openAIBaseUrl ? { baseURL: openAIBaseUrl } : {}),
      embeddingDims: 1536,
      model: embedderModel,
    },
  },
  historyDbPath: join(dataDir, 'history.db'),
  llm: {
    provider: 'openai',
    config: {
      apiKey: openAIApiKey,
      ...(openAIBaseUrl ? { baseURL: openAIBaseUrl } : {}),
      model: llmModel,
      modelProperties: {
        temperature: 0.2,
      },
    },
  },
  vectorStore: {
    // NOTICE: Mem0's TypeScript OSS package supports a file-backed local vector store
    // via the `memory` provider. The `qdrant.path` shape exists in docs/types, but the
    // current runtime still instantiates the HTTP Qdrant client, which expects a server.
    provider: 'memory',
    config: {
      dimension: 1536,
      dbPath: join(dataDir, 'vector-store.db'),
    },
  },
})

interface ScopedRequest {
  agent_id?: string
  app_id?: string
  run_id?: string
  user_id?: string
}

interface SidecarMemoryResultItem {
  created_at?: string
  hash?: string
  id: string
  memory: string
  metadata?: Record<string, unknown> | null
  score?: number
  updated_at?: string
  user_id?: string
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status
  setCorsHeaders(response)
  response.end(JSON.stringify(payload))
}

function sendError(response: ServerResponse, status: number, message: string) {
  sendJson(response, status, { detail: message })
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (!body.trim()) {
    return {}
  }

  return JSON.parse(body) as Record<string, unknown>
}

function requireScope(scope: ScopedRequest) {
  if (scope.user_id?.trim() || scope.agent_id?.trim() || scope.run_id?.trim() || scope.app_id?.trim()) {
    return
  }

  throw new Error('At least one identifier is required.')
}

function buildMemoryScope(scope: ScopedRequest) {
  return {
    ...(scope.user_id?.trim() ? { userId: scope.user_id.trim() } : {}),
    ...(scope.agent_id?.trim() ? { agentId: scope.agent_id.trim() } : {}),
    ...(scope.run_id?.trim() ? { runId: scope.run_id.trim() } : {}),
  }
}

function buildAppScopedFilters(scope: ScopedRequest) {
  return scope.app_id?.trim()
    ? { appId: scope.app_id.trim() }
    : undefined
}

function normalizeMemoryItem(item: Record<string, unknown>): SidecarMemoryResultItem {
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? { ...(item.metadata as Record<string, unknown>) }
    : undefined
  const userId = typeof item.userId === 'string' ? item.userId : undefined

  return {
    created_at: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    hash: typeof item.hash === 'string' ? item.hash : undefined,
    id: typeof item.id === 'string' ? item.id : '',
    memory: typeof item.memory === 'string' ? item.memory : '',
    metadata: metadata ?? null,
    score: typeof item.score === 'number' ? item.score : undefined,
    updated_at: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    user_id: userId,
  }
}

function normalizeCaptureResultItem(item: Record<string, unknown>): Record<string, unknown> {
  const metadata = item.metadata && typeof item.metadata === 'object'
    ? item.metadata as Record<string, unknown>
    : undefined

  return {
    event: typeof metadata?.event === 'string' ? metadata.event.toLowerCase() : 'add',
    id: typeof item.id === 'string' ? item.id : '',
    memory: typeof item.memory === 'string' ? item.memory : '',
    previous_memory: typeof metadata?.previousMemory === 'string' ? metadata.previousMemory : '',
  }
}

function filterByAppId<T extends { metadata?: Record<string, unknown> | null }>(items: T[], appId: string | undefined) {
  if (!appId?.trim()) {
    return items
  }

  return items.filter(item => item.metadata?.appId === appId.trim())
}

async function handleListMemories(url: URL) {
  const scope = {
    agent_id: url.searchParams.get('agent_id') ?? undefined,
    app_id: url.searchParams.get('app_id') ?? undefined,
    run_id: url.searchParams.get('run_id') ?? undefined,
    user_id: url.searchParams.get('user_id') ?? undefined,
  }
  requireScope(scope)

  const result = await memory.getAll({
    ...buildMemoryScope(scope),
    limit: Number(url.searchParams.get('limit') ?? '100'),
  })

  return {
    results: filterByAppId(
      (result.results ?? []).map(item => normalizeMemoryItem(item as unknown as Record<string, unknown>)),
      scope.app_id,
    ),
  }
}

async function handleAddMemory(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const scope = {
    agent_id: typeof body.agent_id === 'string' ? body.agent_id : undefined,
    app_id: typeof body.app_id === 'string' ? body.app_id : undefined,
    run_id: typeof body.run_id === 'string' ? body.run_id : undefined,
    user_id: typeof body.user_id === 'string' ? body.user_id : undefined,
  }

  requireScope(scope)

  const result = await memory.add(
    messages.map((message) => {
      const record = message as Record<string, unknown>
      return {
        content: typeof record.content === 'string' ? record.content : '',
        role: typeof record.role === 'string' ? record.role : 'user',
      }
    }),
    {
      ...buildMemoryScope(scope),
      filters: buildAppScopedFilters(scope),
      infer: body.infer !== false,
      metadata: {
        ...(body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : {}),
        ...(scope.app_id?.trim() ? { appId: scope.app_id.trim() } : {}),
      },
    },
  )

  return {
    results: (result.results ?? []).map(item => normalizeCaptureResultItem(item as unknown as Record<string, unknown>)),
  }
}

async function handleSearchMemories(body: Record<string, unknown>) {
  const scope = {
    agent_id: typeof body.agent_id === 'string' ? body.agent_id : undefined,
    app_id: typeof body.app_id === 'string' ? body.app_id : undefined,
    run_id: typeof body.run_id === 'string' ? body.run_id : undefined,
    user_id: typeof body.user_id === 'string' ? body.user_id : undefined,
  }
  requireScope(scope)

  const result = await memory.search(
    typeof body.query === 'string' ? body.query : '',
    {
      ...buildMemoryScope(scope),
      filters: buildAppScopedFilters(scope),
      limit: typeof body.top_k === 'number' ? body.top_k : 5,
    },
  )

  return {
    results: (result.results ?? []).map(item => normalizeMemoryItem(item as unknown as Record<string, unknown>)),
  }
}

async function handleDeleteAllMemories(url: URL) {
  const scope = {
    agent_id: url.searchParams.get('agent_id') ?? undefined,
    app_id: url.searchParams.get('app_id') ?? undefined,
    run_id: url.searchParams.get('run_id') ?? undefined,
    user_id: url.searchParams.get('user_id') ?? undefined,
  }
  requireScope(scope)

  if (!scope.app_id?.trim()) {
    return memory.deleteAll(buildMemoryScope(scope))
  }

  const listed = await handleListMemories(url)
  await Promise.all((listed.results ?? []).map(item => memory.delete(item.id)))
  return { message: 'All relevant memories deleted' }
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url || !request.method) {
      sendError(response, 400, 'Malformed request.')
      return
    }

    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }

    const url = new URL(request.url, `http://127.0.0.1:${port}`)
    const memoryId = url.pathname.startsWith('/memories/') ? decodeURIComponent(url.pathname.slice('/memories/'.length)) : ''

    if (url.pathname === '/healthz' && request.method === 'GET') {
      sendJson(response, 200, {
        dataDir,
        embedderModel,
        llmModel,
        status: 'ok',
      })
      return
    }

    if (url.pathname === '/memories' && request.method === 'GET') {
      sendJson(response, 200, await handleListMemories(url))
      return
    }

    if (url.pathname === '/memories' && request.method === 'POST') {
      sendJson(response, 200, await handleAddMemory(await readJson(request)))
      return
    }

    if (url.pathname === '/memories' && request.method === 'DELETE') {
      sendJson(response, 200, await handleDeleteAllMemories(url))
      return
    }

    if (url.pathname === '/search' && request.method === 'POST') {
      sendJson(response, 200, await handleSearchMemories(await readJson(request)))
      return
    }

    if (memoryId && request.method === 'GET') {
      const item = await memory.get(memoryId)
      if (!item) {
        sendError(response, 404, 'Memory not found.')
        return
      }

      sendJson(response, 200, normalizeMemoryItem(item as unknown as Record<string, unknown>))
      return
    }

    if (memoryId && request.method === 'PUT') {
      const body = await readJson(request)
      const text = typeof body.text === 'string'
        ? body.text
        : typeof body.memory === 'string'
          ? body.memory
          : ''
      if (!text.trim()) {
        sendError(response, 400, 'Memory text is required.')
        return
      }

      sendJson(response, 200, await memory.update(memoryId, text))
      return
    }

    if (memoryId && request.method === 'DELETE') {
      sendJson(response, 200, await memory.delete(memoryId))
      return
    }

    sendError(response, 404, `Unhandled ${request.method} ${url.pathname}`)
  }
  catch (error) {
    sendError(response, 500, error instanceof Error ? error.message : String(error))
  }
})

server.on('error', (error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[mem0-sidecar] server failed: ${message}`)
  process.exitCode = 1
})

server.listen(port, '127.0.0.1', () => {
  console.info(`[mem0-sidecar] listening on http://127.0.0.1:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0)
    })
  })
}
