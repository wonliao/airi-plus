<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
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
    entry: lastCaptureDebug.value,
    latestItems: lastCaptureDebug.value?.latestMemories ?? [],
    latestItemsLabel: t('settings.pages.modules.memory-short-term.debug.latestMemories'),
  },
  {
    key: 'short-term-recall',
    title: t('settings.pages.modules.memory-short-term.debug.lastRecall'),
    entry: lastRecallDebug.value,
    latestItems: lastRecallDebug.value?.latestMemories ?? [],
    latestItemsLabel: t('settings.pages.modules.memory-short-term.debug.latestMemories'),
  },
  {
    key: 'long-term-recall',
    title: t('settings.pages.modules.memory-long-term.debug.lastRecall'),
    entry: lastLongTermRecallDebug.value,
    latestItems: lastLongTermRecallDebug.value?.latestSources ?? [],
    latestItemsLabel: t('settings.pages.modules.memory-long-term.debug.latestSources'),
  },
])
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
        'cursor-pointer list-none select-none font-medium text-neutral-800',
        'dark:text-neutral-100',
      ]"
    >
      {{ $t('settings.pages.modules.memory-short-term.debug.title') }}
    </summary>

    <p :class="['mt-2 text-neutral-500 dark:text-neutral-400']">
      {{ $t('settings.pages.modules.memory-short-term.debug.description') }}
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
          <div>{{ section.entry.message }}</div>
          <div>
            {{ $t('settings.pages.modules.memory-short-term.debug.timestamp') }}:
            {{ section.entry.at }}
          </div>
          <div v-if="typeof section.entry.resultCount === 'number'">
            {{ $t('settings.pages.modules.memory-short-term.debug.resultCount') }}:
            {{ section.entry.resultCount }}
          </div>
          <div v-if="section.latestItems.length" :class="['flex flex-col gap-1']">
            <div>{{ section.latestItemsLabel }}:</div>
            <ul :class="['list-disc pl-4']">
              <li v-for="item in section.latestItems" :key="item">
                {{ item }}
              </li>
            </ul>
          </div>
          <pre :class="['overflow-x-auto rounded-md bg-neutral-100 p-2 whitespace-pre-wrap break-words dark:bg-neutral-950']">{{ section.entry.payload || $t('settings.pages.modules.memory-short-term.debug.emptyPayload') }}</pre>
        </div>

        <div v-else :class="['mt-2 text-neutral-500 dark:text-neutral-400']">
          {{ $t('settings.pages.modules.memory-short-term.debug.emptyState') }}
        </div>
      </div>
    </div>
  </details>
</template>
