import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { LlmWikiWorkspaceValidationPayload, LlmWikiWorkspaceValidationResult } from '@proj-airi/stage-shared'

import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, sep } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { electronValidateLlmWikiWorkspace } from '@proj-airi/stage-shared'

function ensureTrailingSeparator(value: string) {
  return value.endsWith(sep) ? value : `${value}${sep}`
}

function isPathInsideWorkspace(workspacePath: string, targetPath: string) {
  if (targetPath === workspacePath) {
    return true
  }

  return ensureTrailingSeparator(targetPath).startsWith(ensureTrailingSeparator(workspacePath))
}

function resolveWorkspaceFilePath(workspacePath: string, filePath: string) {
  return normalize(isAbsolute(filePath) ? resolve(filePath) : resolve(workspacePath, filePath))
}

async function assertReadableDirectory(path: string, label: string) {
  await access(path, constants.R_OK)
  const target = await stat(path)
  if (!target.isDirectory()) {
    throw new Error(`${label} must point to an existing directory.`)
  }
}

async function assertReadableFile(path: string, label: string) {
  await access(path, constants.R_OK)
  const target = await stat(path)
  if (!target.isFile()) {
    throw new Error(`${label} must point to an existing file.`)
  }
}

async function validateWorkspace(payload: LlmWikiWorkspaceValidationPayload): Promise<LlmWikiWorkspaceValidationResult> {
  const resolvedWorkspacePath = normalize(resolve(payload.workspacePath))
  const resolvedIndexPath = resolveWorkspaceFilePath(resolvedWorkspacePath, payload.indexPath)
  const resolvedOverviewPath = resolveWorkspaceFilePath(resolvedWorkspacePath, payload.overviewPath)

  if (!isPathInsideWorkspace(resolvedWorkspacePath, resolvedIndexPath)) {
    return {
      valid: false,
      message: 'Index path must stay inside the configured llm-wiki workspace.',
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }

  if (!isPathInsideWorkspace(resolvedWorkspacePath, resolvedOverviewPath)) {
    return {
      valid: false,
      message: 'Overview path must stay inside the configured llm-wiki workspace.',
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }

  try {
    await assertReadableDirectory(resolvedWorkspacePath, 'Workspace path')
    await assertReadableFile(resolvedIndexPath, 'Index path')
    await assertReadableFile(resolvedOverviewPath, 'Overview path')

    return {
      valid: true,
      message: `llm-wiki workspace check passed for ${resolvedWorkspacePath}.`,
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }
  catch (error) {
    return {
      valid: false,
      message: errorMessageFrom(error) ?? 'Desktop llm-wiki validation failed.',
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }
}

export function createMemoryValidationService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronValidateLlmWikiWorkspace, async (payload) => {
    return validateWorkspace(payload)
  })
}
