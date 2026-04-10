import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { __memoryValidationTestUtils } from './index'

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
  it('captures and recalls stable facts in the AIRI-managed store', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-${Date.now()}-${Math.random().toString(16).slice(2)}`)

    try {
      const validation = await __memoryValidationTestUtils.validateShortTermMemory({
        mode: 'open-source',
        userId: 'ben',
        baseUrl: join(appDataRoot, 'mem0'),
        apiKey: '',
        embedder: 'airi-local',
        vectorStore: 'local-file',
        topK: 5,
        searchThreshold: 0.6,
      })

      expect(validation.valid).toBe(true)

      const capture = await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl: join(appDataRoot, 'mem0'),
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我叫做Ben。' },
          { role: 'assistant', content: '好的，我會記住。' },
        ],
      })

      expect(capture.ok).toBe(true)
      expect(capture.items.some(item => item.memory.includes('名字是Ben'))).toBe(true)

      const search = await __memoryValidationTestUtils.searchShortTermMemory({
        baseUrl: join(appDataRoot, 'mem0'),
        userId: 'ben',
        query: '我的名字是什麼？',
        topK: 5,
        searchThreshold: 0.6,
      })

      expect(search.ok).toBe(true)
      expect(search.items[0]?.memory).toContain('名字是Ben')
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('forgets matching memories when the user explicitly asks to forget them', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-forget-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我最喜歡的顏色是湖水綠。' },
          { role: 'assistant', content: '好的。' },
        ],
      })

      const forgetCapture = await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請忘記，我最喜歡的顏色是湖水綠。' },
          { role: 'assistant', content: '好的。' },
        ],
      })

      expect(forgetCapture.ok).toBe(true)
      expect(forgetCapture.items.some(item => item.event === 'delete' && item.memory.includes('湖水綠'))).toBe(true)

      const search = await __memoryValidationTestUtils.searchShortTermMemory({
        baseUrl,
        userId: 'ben',
        query: '我最喜歡的顏色是什麼？',
        topK: 5,
        searchThreshold: 0.6,
      })

      expect(search.ok).toBe(true)
      expect(search.items).toHaveLength(0)
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('forgets category-based color memories when the user asks to forget the color preference in Chinese', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-forget-color-category-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: 'I like blue' },
        ],
      })

      const forgetCapture = await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請忘記，我喜歡的顏色。' },
        ],
      })

      expect(forgetCapture.ok).toBe(true)
      expect(forgetCapture.items.some(item => item.event === 'delete' && item.memory.includes('likes blue'))).toBe(true)
      expect(forgetCapture.latestMemories).toEqual([])
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('deletes an llm-assisted internal delete candidate without re-parsing it', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-internal-delete-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: 'I like blue' },
        ],
      })

      const forgetCapture = await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '__DELETE__:likes blue' },
        ],
      })

      expect(forgetCapture.ok).toBe(true)
      expect(forgetCapture.items.some(item => item.event === 'delete' && item.memory.includes('likes blue'))).toBe(true)
      expect(forgetCapture.latestMemories).toEqual([])

      const search = await __memoryValidationTestUtils.searchShortTermMemory({
        baseUrl,
        userId: 'ben',
        query: 'my favorite color?',
        topK: 5,
        searchThreshold: 0,
      })

      expect(search.ok).toBe(true)
      expect(search.items).toHaveLength(0)
      expect(search.latestMemories).toEqual([])
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('clears all short-term memories for the current user', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-clear-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我叫做Ben。' },
          { role: 'assistant', content: '好的。' },
        ],
      })

      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我最喜歡的顏色是湖水綠。' },
          { role: 'assistant', content: '好的。' },
        ],
      })

      const beforeClear = await __memoryValidationTestUtils.listShortTermMemory({
        baseUrl,
        userId: 'ben',
        limit: 10,
      })

      expect(beforeClear.items.length).toBeGreaterThan(0)

      const clearResult = await __memoryValidationTestUtils.clearShortTermMemory({
        baseUrl,
        userId: 'ben',
      })

      expect(clearResult.ok).toBe(true)
      expect(clearResult.deletedCount).toBeGreaterThan(0)
      expect(clearResult.latestMemories).toEqual([])

      const afterClear = await __memoryValidationTestUtils.listShortTermMemory({
        baseUrl,
        userId: 'ben',
        limit: 10,
      })

      expect(afterClear.ok).toBe(true)
      expect(afterClear.items).toHaveLength(0)
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('resolves the mem0 alias to the AIRI-managed short-term store path', async () => {
    const validation = await __memoryValidationTestUtils.validateShortTermMemory({
      mode: 'open-source',
      userId: 'ben',
      baseUrl: 'mem0',
      apiKey: '',
      embedder: 'airi-local',
      vectorStore: 'local-file',
      topK: 5,
      searchThreshold: 0.6,
    })

    expect(validation.valid).toBe(true)
    expect(validation.resolvedStorePath).toBe(join(process.cwd(), 'mem0'))
    // REVIEW: This assertion documents the current Vitest fallback when Electron app.getPath
    // is unavailable. Real Electron resolves `mem0` against app.getPath('userData')`.
  })

  it('updates conflicting identity memories instead of keeping stale duplicates', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-update-name-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我叫做Ben。' },
          { role: 'assistant', content: '好的。' },
        ],
      })

      const secondCapture = await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，其實我的名字是Benjamin。' },
          { role: 'assistant', content: '收到。' },
        ],
      })

      expect(secondCapture.ok).toBe(true)
      expect(secondCapture.items.some(item => item.event === 'update' && item.memory.includes('Benjamin'))).toBe(true)
      expect(secondCapture.items.find(item => item.event === 'update')?.previousMemory).toContain('Ben')

      const memories = await __memoryValidationTestUtils.listShortTermMemory({
        baseUrl,
        userId: 'ben',
        limit: 10,
      })

      const nameMemories = memories.items.filter(item => item.memory.includes('名字是'))
      expect(nameMemories).toHaveLength(1)
      expect(nameMemories[0]?.memory).toContain('Benjamin')
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('updates favorite-subject memories when the same subject changes', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-update-favorite-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我最喜歡的偶像是BLACKPINK。' },
          { role: 'assistant', content: '好的。' },
        ],
      })

      const secondCapture = await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: '請記住，我最喜歡的偶像是NewJeans。' },
          { role: 'assistant', content: '收到。' },
        ],
      })

      expect(secondCapture.ok).toBe(true)
      expect(secondCapture.items.some(item => item.event === 'update' && item.memory.includes('NewJeans'))).toBe(true)
      expect(secondCapture.items.find(item => item.event === 'update')?.previousMemory).toContain('BLACKPINK')

      const memories = await __memoryValidationTestUtils.listShortTermMemory({
        baseUrl,
        userId: 'ben',
        limit: 10,
      })

      const idolMemories = memories.items.filter(item => item.memory.includes('最喜歡的偶像是'))
      expect(idolMemories).toHaveLength(1)
      expect(idolMemories[0]?.memory).toContain('NewJeans')
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })

  it('recalls a stored English color preference from a Chinese question after reopening the conversation', async () => {
    const appDataRoot = join(tmpdir(), `airi-short-term-cross-lingual-color-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const baseUrl = join(appDataRoot, 'mem0')

    try {
      await __memoryValidationTestUtils.captureShortTermMemory({
        baseUrl,
        userId: 'ben',
        messages: [
          { role: 'user', content: 'I like deep blue' },
        ],
      })

      const search = await __memoryValidationTestUtils.searchShortTermMemory({
        baseUrl,
        userId: 'ben',
        query: '我最喜歡的顏色是什麼？',
        topK: 5,
        searchThreshold: 0.6,
      })

      expect(search.ok).toBe(true)
      expect(search.items[0]?.memory).toContain('likes deep blue')
    }
    finally {
      await rm(appDataRoot, { force: true, recursive: true })
    }
  })
})

function appDataRootFromWorkspace(workspacePath: string) {
  return dirname(dirname(workspacePath))
}
