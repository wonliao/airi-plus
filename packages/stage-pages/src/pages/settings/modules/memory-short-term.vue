<script setup lang="ts">
import { ShortTermMemorySettings } from '@proj-airi/stage-ui/components'
</script>

<template>
  <ShortTermMemorySettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-short-term.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.modules.memory-short-term.description
  stageTransition:
    name: slide
</route>
