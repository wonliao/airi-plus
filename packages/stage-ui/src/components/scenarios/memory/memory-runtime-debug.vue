<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLongTermMemoryStore } from '../../../stores/modules/memory-long-term'
import { useShortTermMemoryStore } from '../../../stores/modules/memory-short-term'

const { t } = useI18n()
const shortTermMemoryStore = useShortTermMemoryStore()
const longTermMemoryStore = useLongTermMemoryStore()
const {
  enabled,
  lastCaptureDebug,
  lastRecallDebug,
} = storeToRefs(shortTermMemoryStore)
const {
  enabled: longTermEnabled,
  lastRecallDebug: lastLongTermRecallDebug,
} = storeToRefs(longTermMemoryStore)
const copyState = ref<'copied' | 'idle'>('idle')
const copyError = ref('')

interface RuntimeDebugEntry {
  at: string
  captureMode?: string
  candidates: string[]
  events: Array<{
    event: string
    id: string
    memory: string
    previousMemory: string
  }>
  matchedItems: Array<{
    category: string
    conflictKey: string
    matchedBy: string[]
    memory: string
    score?: number
  }>
  latestMemoryItems: Array<{
    category: string
    conflictKey: string
    id: string
    memory: string
  }>
  latestItems: string[]
  message: string
  operations: string[]
  payload: string
  resultCount?: number
  status?: 'error' | 'skipped' | 'success'
}

function toDisplayText(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => toDisplayText(item)).filter(Boolean)
    : []
}

function toRuntimeDebugEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(item => !!item && typeof item === 'object')
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        event: toDisplayText(record.event),
        id: toDisplayText(record.id),
        memory: toDisplayText(record.memory),
        previousMemory: toDisplayText(record.previousMemory),
      }
    })
    .filter(item => item.event)
}

function formatRuntimeEventLine(event: RuntimeDebugEntry['events'][number]) {
  const prefix = event.event.toUpperCase()
  if (event.event === 'update' && event.previousMemory && event.previousMemory !== event.memory) {
    return `${prefix} · ${event.previousMemory} -> ${event.memory}${event.id ? ` (#${event.id})` : ''}`
  }

  const content = event.previousMemory || event.memory
  return `${prefix} · ${content}${event.id ? ` (#${event.id})` : ''}`
}

function toRuntimeDebugLatestMemoryItems(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(item => !!item && typeof item === 'object')
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        category: toDisplayText(record.category),
        conflictKey: toDisplayText(record.conflictKey),
        id: toDisplayText(record.id),
        memory: toDisplayText(record.memory),
      }
    })
    .filter(item => item.memory)
}

function toRuntimeDebugMatchedItems(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(item => !!item && typeof item === 'object')
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        category: toDisplayText(record.category),
        conflictKey: toDisplayText(record.conflictKey),
        matchedBy: toStringArray(record.matchedBy),
        memory: toDisplayText(record.memory),
        score: typeof record.score === 'number'
          ? record.score
          : (typeof record.score === 'string' && Number.isFinite(Number(record.score))
              ? Number(record.score)
              : undefined),
      }
    })
    .filter(item => item.memory)
}

function normalizeRuntimeDebugEntry(value: unknown): RuntimeDebugEntry | null {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return {
      at: '',
      candidates: [],
      events: [],
      matchedItems: [],
      latestMemoryItems: [],
      latestItems: [],
      message: value,
      operations: [],
      payload: '',
    }
  }

  if (typeof value !== 'object') {
    return null
  }

  const record = value as {
    at?: unknown
    captureMode?: unknown
    candidates?: unknown
    latestMemories?: unknown
    matchedItems?: unknown
    latestMemoryItems?: unknown
    latestSources?: unknown
    message?: unknown
    events?: unknown
    operations?: unknown
    payload?: unknown
    resultCount?: unknown
    status?: unknown
  }

  return {
    at: toDisplayText(record.at),
    captureMode: toDisplayText(record.captureMode),
    candidates: toStringArray(record.candidates),
    events: toRuntimeDebugEvents(record.events),
    matchedItems: toRuntimeDebugMatchedItems(record.matchedItems),
    latestMemoryItems: toRuntimeDebugLatestMemoryItems(record.latestMemoryItems),
    latestItems: [
      ...toStringArray(record.latestMemories),
      ...toStringArray(record.latestSources),
    ],
    message: toDisplayText(record.message),
    operations: toStringArray(record.operations),
    payload: toDisplayText(record.payload),
    resultCount: typeof record.resultCount === 'number'
      ? record.resultCount
      : (typeof record.resultCount === 'string' && Number.isFinite(Number(record.resultCount))
          ? Number(record.resultCount)
          : undefined),
    status: record.status === 'error' || record.status === 'skipped' || record.status === 'success'
      ? record.status
      : undefined,
  }
}

function formatRuntimeTimestamp(value: string) {
  if (!value) {
    return '—'
  }

  return value
}

function shouldShowPayload(entry: RuntimeDebugEntry) {
  return entry.status !== 'skipped' || !!entry.payload
}

function isSkippedEntry(entry: RuntimeDebugEntry) {
  return entry.status === 'skipped'
}

function hasStructuredLatestItems(entry: RuntimeDebugEntry) {
  return entry.latestMemoryItems.length > 0
}

const shouldShow = computed(() =>
  enabled.value
  || longTermEnabled.value
  || !!lastCaptureDebug.value
  || !!lastRecallDebug.value
  || !!lastLongTermRecallDebug.value,
)

const sections = computed(() => [
  {
    key: 'capture',
    title: t('settings.pages.modules.memory-short-term.debug.lastCapture'),
    entry: normalizeRuntimeDebugEntry(lastCaptureDebug.value),
    latestItemsLabel: t('settings.pages.modules.memory-short-term.debug.latestMemories'),
  },
  {
    key: 'short-term-recall',
    title: t('settings.pages.modules.memory-short-term.debug.lastRecall'),
    entry: normalizeRuntimeDebugEntry(lastRecallDebug.value),
    latestItemsLabel: t('settings.pages.modules.memory-short-term.debug.latestMemories'),
  },
  {
    key: 'long-term-recall',
    title: t('settings.pages.modules.memory-long-term.debug.lastRecall'),
    entry: normalizeRuntimeDebugEntry(lastLongTermRecallDebug.value),
    latestItemsLabel: t('settings.pages.modules.memory-long-term.debug.latestSources'),
  },
])

const debugSnapshotJson = computed(() => JSON.stringify({
  capture: sections.value[0]?.entry,
  generatedAt: new Date().toISOString(),
  longTermRecall: sections.value[2]?.entry,
  shortTermRecall: sections.value[1]?.entry,
}, null, 2))

async function copyDebugSnapshot() {
  copyError.value = ''

  try {
    await navigator.clipboard.writeText(debugSnapshotJson.value)
    copyState.value = 'copied'
    setTimeout(() => {
      copyState.value = 'idle'
    }, 2000)
  }
  catch (error) {
    copyError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <details
    v-if="shouldShow"
    :class="[
      'rounded-xl border border-neutral-200/80 bg-neutral-50/80 p-3 text-xs text-neutral-600',
      'dark:border-neutral-800 dark:bg-neutral-950/50 dark:text-neutral-300',
    ]"
  >
    <summary
      :class="[
        'flex items-center justify-between gap-3 cursor-pointer list-none select-none font-medium text-neutral-800',
        'dark:text-neutral-100',
      ]"
    >
      <span>{{ $t('settings.pages.modules.memory-short-term.debug.title') }}</span>
      <button
        type="button"
        :class="[
          'rounded-md border border-neutral-200/80 bg-white/90 px-2.5 py-1.5 text-[11px] font-medium transition-colors',
          'hover:border-neutral-300 hover:bg-neutral-50',
          'dark:border-neutral-700 dark:bg-neutral-900/80 dark:hover:border-neutral-600 dark:hover:bg-neutral-800',
        ]"
        @click.prevent.stop="copyDebugSnapshot"
      >
        {{ copyState === 'copied'
          ? $t('settings.pages.modules.memory-short-term.debug.copyJsonDone')
          : $t('settings.pages.modules.memory-short-term.debug.copyJson') }}
      </button>
    </summary>

    <p :class="['mt-2 text-neutral-500 dark:text-neutral-400']">
      {{ $t('settings.pages.modules.memory-short-term.debug.description') }}
    </p>
    <p v-if="copyError" :class="['mt-2 text-[11px] text-red-500 dark:text-red-400']">
      {{ $t('settings.pages.modules.memory-short-term.debug.copyJsonFailed') }}: {{ copyError }}
    </p>

    <div :class="['mt-3 flex flex-col gap-3']">
      <div
        v-for="section in sections"
        :key="section.key"
        :class="[
          'rounded-lg border border-neutral-200/80 bg-white/80 p-3',
          'dark:border-neutral-800 dark:bg-neutral-900/60',
        ]"
      >
        <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
          {{ section.title }}
        </div>

        <div v-if="section.entry" :class="['mt-2 flex flex-col gap-2']">
          <div v-if="section.entry.message">
            {{ section.entry.message }}
          </div>
          <template v-if="isSkippedEntry(section.entry)">
            <div>
              {{ $t('settings.pages.modules.memory-short-term.debug.timestamp') }}:
              {{ formatRuntimeTimestamp(section.entry.at) }}
            </div>
          </template>
          <template v-else>
            <div>
              {{ $t('settings.pages.modules.memory-short-term.debug.timestamp') }}:
              {{ formatRuntimeTimestamp(section.entry.at) }}
            </div>
            <div v-if="typeof section.entry.resultCount === 'number'">
              {{ $t('settings.pages.modules.memory-short-term.debug.resultCount') }}:
              {{ section.entry.resultCount }}
            </div>
            <div v-if="section.entry.captureMode">
              {{ $t('settings.pages.modules.memory-short-term.debug.captureMode') }}:
              {{ section.entry.captureMode }}
            </div>
            <div v-if="section.entry.candidates.length" :class="['flex flex-col gap-1']">
              <div>{{ $t('settings.pages.modules.memory-short-term.debug.candidates') }}:</div>
              <ul :class="['list-disc pl-4']">
                <li v-for="item in section.entry.candidates" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>
            <div v-if="section.entry.operations.length" :class="['flex flex-col gap-1']">
              <div>{{ $t('settings.pages.modules.memory-short-term.debug.operations') }}:</div>
              <ul :class="['list-disc pl-4']">
                <li v-for="item in section.entry.operations" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>
            <div v-if="section.entry.events.length" :class="['flex flex-col gap-1']">
              <div>{{ $t('settings.pages.modules.memory-short-term.debug.eventLog') }}:</div>
              <ul :class="['list-disc pl-4 font-mono text-[11px] leading-5']">
                <li v-for="item in section.entry.events" :key="`${item.event}:${item.id}:${item.memory}:${item.previousMemory}`">
                  {{ formatRuntimeEventLine(item) }}
                </li>
              </ul>
            </div>
            <div v-if="section.entry.matchedItems.length" :class="['flex flex-col gap-2']">
              <div>{{ $t('settings.pages.modules.memory-short-term.debug.matchReasons') }}:</div>
              <ul :class="['flex flex-col gap-2']">
                <li
                  v-for="item in section.entry.matchedItems"
                  :key="`${item.memory}:${item.conflictKey}:${item.matchedBy.join('|')}`"
                  :class="[
                    'rounded-md border border-neutral-200/80 bg-neutral-50/80 p-2',
                    'dark:border-neutral-800 dark:bg-neutral-950/40',
                  ]"
                >
                  <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
                    {{ item.memory }}
                  </div>
                  <div v-if="typeof item.score === 'number'" :class="['mt-1 text-[11px] text-neutral-500 dark:text-neutral-400']">
                    {{ $t('settings.pages.modules.memory-short-term.debug.score') }}: {{ item.score.toFixed(3) }}
                  </div>
                  <div :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">
                    {{ $t('settings.pages.modules.memory-short-term.debug.category') }}: {{ item.category || '—' }}
                  </div>
                  <div :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">
                    {{ $t('settings.pages.modules.memory-short-term.debug.conflictKey') }}: {{ item.conflictKey || '—' }}
                  </div>
                  <div :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">
                    {{ $t('settings.pages.modules.memory-short-term.debug.matchedBy') }}: {{ item.matchedBy.join(', ') || '—' }}
                  </div>
                </li>
              </ul>
            </div>
            <div v-if="hasStructuredLatestItems(section.entry)" :class="['flex flex-col gap-2']">
              <div>{{ section.latestItemsLabel }}:</div>
              <ul :class="['flex flex-col gap-2']">
                <li
                  v-for="item in section.entry.latestMemoryItems"
                  :key="`${item.id}:${item.memory}:${item.conflictKey}`"
                  :class="[
                    'rounded-md border border-neutral-200/80 bg-neutral-50/80 p-2',
                    'dark:border-neutral-800 dark:bg-neutral-950/40',
                  ]"
                >
                  <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
                    {{ item.memory }}
                  </div>
                  <div :class="['mt-1 text-[11px] text-neutral-500 dark:text-neutral-400']">
                    {{ $t('settings.pages.modules.memory-short-term.debug.category') }}: {{ item.category || '—' }}
                  </div>
                  <div :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">
                    {{ $t('settings.pages.modules.memory-short-term.debug.conflictKey') }}: {{ item.conflictKey || '—' }}
                  </div>
                </li>
              </ul>
            </div>
            <div v-else-if="section.entry.latestItems.length" :class="['flex flex-col gap-1']">
              <div>{{ section.latestItemsLabel }}:</div>
              <ul :class="['list-disc pl-4']">
                <li v-for="item in section.entry.latestItems" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>
            <pre
              v-if="shouldShowPayload(section.entry)"
              :class="['overflow-x-auto rounded-md bg-neutral-100 p-2 whitespace-pre-wrap break-words dark:bg-neutral-950']"
            >{{ section.entry.payload || $t('settings.pages.modules.memory-short-term.debug.emptyPayload') }}</pre>
          </template>
        </div>

        <div v-else :class="['mt-2 text-neutral-500 dark:text-neutral-400']">
          {{ $t('settings.pages.modules.memory-short-term.debug.emptyState') }}
        </div>
      </div>
    </div>
  </details>
</template>
