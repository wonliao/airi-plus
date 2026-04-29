import type { SystemMessage } from '@xsai/shared-chat'

interface RetrievalPrompt {
  prompt: string
}

export interface BuildRetrievalContextMessageOptions {
  longTermRecall?: RetrievalPrompt | null
  shortTermRecall?: RetrievalPrompt | null
}

export function formatRetrievalContextText(options: BuildRetrievalContextMessageOptions) {
  const sections: string[] = []

  if (options.shortTermRecall?.prompt?.trim()) {
    sections.push([
      '[Retrieved Short-Term Memory]',
      options.shortTermRecall.prompt.trim(),
    ].join('\n'))
  }

  if (options.longTermRecall?.prompt?.trim()) {
    sections.push([
      '[Retrieved Long-Term Knowledge]',
      options.longTermRecall.prompt.trim(),
    ].join('\n'))
  }

  if (sections.length === 0) {
    return ''
  }

  return [
    'These references were retrieved from AIRI memory systems.',
    'Treat them as supporting context rather than new user messages.',
    'Prefer them when they directly answer the user, but do not present them as if the user just said them in this turn.',
    '',
    ...sections,
  ].join('\n')
}

export function buildRetrievalContextMessage(options: BuildRetrievalContextMessageOptions): SystemMessage | null {
  const promptText = formatRetrievalContextText(options)
  if (!promptText) {
    return null
  }

  return {
    role: 'system',
    content: promptText,
  }
}
