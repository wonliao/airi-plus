import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __memoryValidationTestUtils } from './index'

interface MockRemoteMemoryRecord {
  agentId?: string
  createdAt: string
  memory: string
  id: string
  runId?: string
  userId: string
}

const mockRemoteMem0Store: MockRemoteMemoryRecord[] = []

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

function matchesMemoryScope(memory: MockRemoteMemoryRecord, params: URLSearchParams) {
  const userId = params.get('user_id') ?? ''
  const agentId = params.get('agent_id') ?? ''
  const runId = params.get('run_id') ?? ''

  return memory.userId === userId
    && (!agentId || memory.agentId === agentId)
    && (!runId || memory.runId === runId)
}

beforeEach(() => {
  mockRemoteMem0Store.splice(0, mockRemoteMem0Store.length)
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())

    if (url.pathname === '/memories' && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse({
        results: mockRemoteMem0Store
          .filter(item => matchesMemoryScope(item, url.searchParams))
          .slice(0, Number(url.searchParams.get('limit') ?? '100')),
      })
    }

    if (url.pathname === '/memories' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as {
        agent_id?: string
        messages?: Array<{ content: string, role: string }>
        run_id?: string
        user_id?: string
      }
      const firstMessage = body.messages?.[0]?.content ?? ''
      const created = {
        createdAt: new Date().toISOString(),
        id: `memory-${mockRemoteMem0Store.length + 1}`,
        memory: firstMessage,
        agentId: body.agent_id,
        runId: body.run_id,
        userId: body.user_id ?? 'unknown',
      } satisfies MockRemoteMemoryRecord
      mockRemoteMem0Store.unshift(created)
      return jsonResponse({
        results: [{
          event: 'ADD',
          id: created.id,
          memory: created.memory,
        }],
      })
    }

    if (url.pathname.startsWith('/memories/') && init?.method === 'PUT') {
      const memoryId = url.pathname.split('/').at(-1) ?? ''
      const body = JSON.parse(String(init.body ?? '{}')) as {
        metadata?: Record<string, unknown>
        text?: string
      }
      const existing = mockRemoteMem0Store.find(item => item.id === memoryId)
      if (!existing) {
        return jsonResponse({ detail: 'Not found' }, 404)
      }

      existing.memory = body.text ?? existing.memory

      return jsonResponse({
        id: existing.id,
        memory: existing.memory,
        metadata: body.metadata ?? null,
      })
    }

    if (url.pathname.startsWith('/memories/') && init?.method === 'DELETE') {
      const memoryId = url.pathname.split('/').at(-1) ?? ''
      const kept = mockRemoteMem0Store.filter(item => item.id !== memoryId)
      mockRemoteMem0Store.splice(0, mockRemoteMem0Store.length, ...kept)
      return jsonResponse({ message: 'ok' })
    }

    if (url.pathname === '/memories' && init?.method === 'DELETE') {
      const kept = mockRemoteMem0Store.filter(item => !matchesMemoryScope(item, url.searchParams))
      mockRemoteMem0Store.splice(0, mockRemoteMem0Store.length, ...kept)
      return jsonResponse({ message: 'ok' })
    }

    if (url.pathname === '/search' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as {
        agent_id?: string
        query?: string
        run_id?: string
        top_k?: number
        user_id?: string
      }
      const query = body.query?.toLowerCase() ?? ''
      const results = mockRemoteMem0Store
        .filter(item => item.userId === body.user_id)
        .filter(item => !body.agent_id || item.agentId === body.agent_id)
        .filter(item => !body.run_id || item.runId === body.run_id)
        .filter(item => item.memory.toLowerCase().includes(query))
        .slice(0, body.top_k ?? 5)
        .map(item => ({
          id: item.id,
          memory: item.memory,
          score: 0.96,
          user_id: item.userId,
        }))

      return jsonResponse({ results })
    }

    return jsonResponse({ detail: `Unhandled ${init?.method ?? 'GET'} ${url.pathname}` }, 404)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function createWikiFixture() {
  const root = join(tmpdir(), `airi-llm-wiki-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(join(root, 'wiki', 'topics'), { recursive: true })
  await mkdir(join(root, 'wiki', 'entities'), { recursive: true })
  await mkdir(join(root, 'wiki', 'sources'), { recursive: true })

  await writeFile(join(root, 'index.md'), '# 知识库索引\n\n- [[first-class-mage-exam]]\n- [[himmel]]\n')
  await writeFile(join(root, 'wiki', 'overview.md'), '# 总览\n\n这里包含勇者一行人、一级魔法使考试与关键人物。\n')
  await writeFile(join(root, 'wiki', 'topics', 'first-class-mage-exam.md'), '# First Class Mage Exam\n\n## 核心概览\n第一級魔法使考試是理解魔法協會、考核機制與參與者差異的核心主題頁。\n')
  await writeFile(join(root, 'wiki', 'topics', 'frieren-relationship-map.md'), '# Frieren Relationship Map\n\n芙莉蓮與勇者一行人的關係，是理解作品情感與時間主題的重要入口。\n')
  await writeFile(join(root, 'wiki', 'entities', 'himmel.md'), '# Himmel\n\nHimmel 是勇者一行人的勇者，也是 Frieren 情感線的重要角色。\n')
  await writeFile(join(root, 'wiki', 'entities', 'lernen.md'), '# Lernen\n\nLernen 與第一級魔法使考試有關，但本頁重點是人物本身。\n')
  await writeFile(join(root, 'wiki', 'sources', '2026-04-08-lernen.md'), '# Lernen Source\n\n素材提到 Lernen 與第一級魔法使考試。\n')

  return root
}

function createManagedLocalMem0ValidationPayload(overrides: Partial<Parameters<typeof __memoryValidationTestUtils.validateShortTermMemory>[0]> = {}) {
  return {
    openAIApiKey: 'test-openai-key',
    userId: 'ben',
    topK: 5,
    searchThreshold: 0.6,
    ...overrides,
  }
}

function createManagedLocalMem0ScopePayload(overrides: Record<string, unknown> = {}) {
  return {
    openAIApiKey: 'test-openai-key',
    userId: 'ben',
    ...overrides,
  }
}

async function ensureManagedLocalMem0Validated() {
  const validation = await __memoryValidationTestUtils.validateShortTermMemory(
    createManagedLocalMem0ValidationPayload(),
  )

  expect(validation.valid).toBe(true)
  return validation
}

describe('llm-wiki query ranking', () => {
  it('prefers entity pages for who-is style questions', async () => {
    const workspacePath = await createWikiFixture()

    try {
      const result = await __memoryValidationTestUtils.queryWorkspace({
        workspacePath,
        indexPath: 'index.md',
        overviewPath: 'wiki/overview.md',
        query: '誰是 Himmel？',
        queryMode: 'hybrid',
        maxResults: 3,
      })

      expect(result.ok).toBe(true)
      expect(result.items[0]?.path).toContain('wiki/entities/himmel.md')
    }
    finally {
      await rm(workspacePath, { force: true, recursive: true })
    }
  })

  it('prefers topic pages for exam overview questions', async () => {
    const workspacePath = await createWikiFixture()

    try {
      const result = await __memoryValidationTestUtils.queryWorkspace({
        workspacePath,
        indexPath: 'index.md',
        overviewPath: 'wiki/overview.md',
        query: '一級魔法使考試是什麼？',
        queryMode: 'hybrid',
        maxResults: 3,
      })

      expect(result.ok).toBe(true)
      expect(result.items[0]?.path).toContain('wiki/topics/first-class-mage-exam.md')
    }
    finally {
      await rm(workspacePath, { force: true, recursive: true })
    }
  })
})

describe('llm-wiki default workspace seeding', () => {
  it('copies the seed workspace into an AIRI-managed workspace when missing', async () => {
    const seedWorkspacePath = await createWikiFixture()
    const workspacePath = join(tmpdir(), `airi-llm-wiki-default-${Date.now()}-${Math.random().toString(16).slice(2)}`)

    try {
      const result = await __memoryValidationTestUtils.ensureDefaultWorkspaceFromPaths({
        workspacePath,
        seedWorkspacePath,
      })

      expect(result.initialized).toBe(true)
      expect(result.workspacePath).toBe(workspacePath)
      expect(result.indexPath).toBe(join(workspacePath, 'index.md'))
      expect(result.overviewPath).toBe(join(workspacePath, 'wiki/overview.md'))

      const seededQuery = await __memoryValidationTestUtils.queryWorkspace({
        workspacePath,
        indexPath: 'index.md',
        overviewPath: 'wiki/overview.md',
        query: '誰是 Himmel？',
        queryMode: 'hybrid',
        maxResults: 1,
      })

      expect(seededQuery.ok).toBe(true)
      expect(seededQuery.items[0]?.path).toContain('wiki/entities/himmel.md')
    }
    finally {
      await rm(seedWorkspacePath, { force: true, recursive: true })
      await rm(workspacePath, { force: true, recursive: true })
    }
  })
})

describe('llm-wiki workspace alias', () => {
  it('resolves the llm-wiki alias to the AIRI-managed workspace path', async () => {
    const seedWorkspacePath = await createWikiFixture()
    const managedWorkspacePath = join(tmpdir(), `airi-llm-wiki-managed-${Date.now()}-${Math.random().toString(16).slice(2)}`)

    try {
      await __memoryValidationTestUtils.ensureDefaultWorkspaceFromPaths({
        workspacePath: managedWorkspacePath,
        seedWorkspacePath,
      })

      const aliasValidation = await __memoryValidationTestUtils.validateWorkspaceFromPaths({
        workspacePath: 'llm-wiki',
        indexPath: 'index.md',
        overviewPath: 'wiki/overview.md',
        appDataPath: appDataRootFromWorkspace(managedWorkspacePath),
        defaultWorkspacePath: managedWorkspacePath,
      })

      expect(aliasValidation.valid).toBe(true)
      expect(aliasValidation.resolvedWorkspacePath).toBe(managedWorkspacePath)
    }
    finally {
      await rm(seedWorkspacePath, { force: true, recursive: true })
      await rm(managedWorkspacePath, { force: true, recursive: true })
    }
  })

  it('resolves relative workspace paths against AIRI app data', async () => {
    const seedWorkspacePath = await createWikiFixture()
    const appDataRoot = join(tmpdir(), `airi-app-data-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const managedWorkspacePath = join(appDataRoot, 'knowledge', 'frieren')

    try {
      await __memoryValidationTestUtils.ensureDefaultWorkspaceFromPaths({
        workspacePath: managedWorkspacePath,
        seedWorkspacePath,
      })

      const relativeValidation = await __memoryValidationTestUtils.validateWorkspaceFromPaths({
        workspacePath: './knowledge/frieren',
        indexPath: 'index.md',
        overviewPath: 'wiki/overview.md',
        appDataPath: appDataRoot,
        defaultWorkspacePath: appDataRoot,
      })

      expect(relativeValidation.valid).toBe(true)
      expect(relativeValidation.resolvedWorkspacePath).toBe(managedWorkspacePath)
    }
    finally {
      await rm(seedWorkspacePath, { force: true, recursive: true })
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })
})

describe('short-term memory desktop runtime', () => {
  it('validates the AIRI-managed local Mem0 sidecar endpoint', async () => {
    const validation = await __memoryValidationTestUtils.validateShortTermMemory(
      createManagedLocalMem0ValidationPayload(),
    )

    expect(validation.valid).toBe(true)
    expect(validation.validatedBaseUrl).toBe('http://127.0.0.1:4310')
  })

  it('captures, lists, searches, and clears memories through the sidecar HTTP API', async () => {
    await ensureManagedLocalMem0Validated()

    const capture = await __memoryValidationTestUtils.captureShortTermMemory({
      ...createManagedLocalMem0ScopePayload(),
      messages: [
        { role: 'user', content: 'Remember that my favorite fruit is mango.' },
      ],
    })

    expect(capture.ok).toBe(true)
    expect(capture.items[0]?.memory).toContain('favorite fruit is mango')

    const listed = await __memoryValidationTestUtils.listShortTermMemory({
      ...createManagedLocalMem0ScopePayload(),
      limit: 10,
    })

    expect(listed.ok).toBe(true)
    expect(listed.items).toHaveLength(1)

    const search = await __memoryValidationTestUtils.searchShortTermMemory({
      ...createManagedLocalMem0ScopePayload(),
      query: 'mango',
      topK: 5,
      searchThreshold: 0.6,
    })

    expect(search.ok).toBe(true)
    expect(search.items[0]?.memory).toContain('mango')

    const clearResult = await __memoryValidationTestUtils.clearShortTermMemory({
      ...createManagedLocalMem0ScopePayload(),
    })

    expect(clearResult.ok).toBe(true)
    expect(clearResult.deletedCount).toBe(1)

    const afterClear = await __memoryValidationTestUtils.listShortTermMemory({
      ...createManagedLocalMem0ScopePayload(),
      limit: 10,
    })

    expect(afterClear.items).toHaveLength(0)
  })

  it('canonicalizes exact duplicate sidecar memories into a single item', async () => {
    mockRemoteMem0Store.push(
      {
        createdAt: '2026-04-11T10:00:00.000Z',
        id: 'memory-old-1',
        memory: '名字是 Ben',
        userId: 'local',
      },
      {
        createdAt: '2026-04-11T10:00:01.000Z',
        id: 'memory-old-2',
        memory: '名字是 Ben',
        userId: 'local',
      },
    )

    const listed = await __memoryValidationTestUtils.listShortTermMemory({
      ...createManagedLocalMem0ScopePayload({
        userId: 'local',
      }),
      limit: 10,
    })

    expect(listed.ok).toBe(true)
    expect(listed.items).toHaveLength(1)
    expect(mockRemoteMem0Store).toHaveLength(1)
  })
})

function appDataRootFromWorkspace(workspacePath: string) {
  return dirname(dirname(workspacePath))
}
