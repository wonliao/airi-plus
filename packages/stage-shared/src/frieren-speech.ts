import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'

import { isElectronWindow } from './window'

function getRendererWindow() {
  return (globalThis as { window?: unknown }).window
}

async function createFrierenSpeechRendererContext() {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  return createContext(maybeElectronWindow.electron.ipcRenderer).context
}

export interface FrierenSpeechSidecarValidationPayload {
  baseUrl?: string
  bridgeDir: string
  dualLlmApiKey?: string
  dualLlmBaseUrl?: string
  dualLlmModel?: string
  envFile?: string
  kokoroProjectDir?: string
  rvcIndexPath?: string
  rvcModelPath?: string
}

export interface FrierenSpeechSidecarValidationResult {
  valid: boolean
  message: string
  resolvedBridgeDir: string
  resolvedEnvFile?: string
  validatedBaseUrl: string
}

export type FrierenSpeechSidecarLifecycleStatus = 'invalid' | 'missing-config' | 'missing-env-file' | 'needs-install' | 'ready' | 'running'

export interface FrierenSpeechSidecarStatusResult {
  status: FrierenSpeechSidecarLifecycleStatus
  launchMode: 'bundled' | 'external'
  dualLlmApiKeyConfigured?: boolean
  dualLlmBaseUrl?: string
  dualLlmModel?: string
  message: string
  resolvedBridgeDir: string
  resolvedEnvFile?: string
  validatedBaseUrl: string
  runtimeRootPath?: string
  sourcePath?: string
  venvPath?: string
  bootstrapLogPath?: string
}

export interface FrierenSpeechSidecarImportedConfigResult {
  imported: boolean
  message: string
  dualLlmApiKey?: string
  dualLlmBaseUrl?: string
  dualLlmModel?: string
  resolvedEnvFile?: string
  kokoroProjectDir?: string
  rvcModelPath?: string
  rvcIndexPath?: string
}

export interface FrierenSpeechDualLlmTestResult {
  success: boolean
  durationMs: number
  message: string
  responseText?: string
  statusCode?: number
}

export const electronValidateFrierenSpeechSidecar = defineInvokeEventa<FrierenSpeechSidecarValidationResult, FrierenSpeechSidecarValidationPayload>('eventa:invoke:electron:speech:frieren-sidecar:validate')
export const electronGetFrierenSpeechSidecarStatus = defineInvokeEventa<FrierenSpeechSidecarStatusResult, FrierenSpeechSidecarValidationPayload>('eventa:invoke:electron:speech:frieren-sidecar:get-status')
export const electronInstallFrierenSpeechSidecar = defineInvokeEventa<FrierenSpeechSidecarStatusResult, FrierenSpeechSidecarValidationPayload>('eventa:invoke:electron:speech:frieren-sidecar:install')
export const electronRestartFrierenSpeechSidecar = defineInvokeEventa<FrierenSpeechSidecarStatusResult, FrierenSpeechSidecarValidationPayload>('eventa:invoke:electron:speech:frieren-sidecar:restart')
export const electronImportFrierenSpeechSidecarConfig = defineInvokeEventa<FrierenSpeechSidecarImportedConfigResult, FrierenSpeechSidecarValidationPayload>('eventa:invoke:electron:speech:frieren-sidecar:import-config')
export const electronTestFrierenSpeechDualLlm = defineInvokeEventa<FrierenSpeechDualLlmTestResult, FrierenSpeechSidecarValidationPayload>('eventa:invoke:electron:speech:frieren-sidecar:test-dual-llm')

export async function validateFrierenSpeechSidecarOnDesktop(payload: FrierenSpeechSidecarValidationPayload) {
  const context = await createFrierenSpeechRendererContext()
  if (!context) {
    return undefined
  }

  const validateSidecar = defineInvoke(context, electronValidateFrierenSpeechSidecar)
  return validateSidecar(payload)
}

export async function getFrierenSpeechSidecarStatusOnDesktop(payload: FrierenSpeechSidecarValidationPayload) {
  const context = await createFrierenSpeechRendererContext()
  if (!context) {
    return undefined
  }

  const getSidecarStatus = defineInvoke(context, electronGetFrierenSpeechSidecarStatus)
  return getSidecarStatus(payload)
}

export async function installFrierenSpeechSidecarOnDesktop(payload: FrierenSpeechSidecarValidationPayload) {
  const context = await createFrierenSpeechRendererContext()
  if (!context) {
    return undefined
  }

  const installSidecar = defineInvoke(context, electronInstallFrierenSpeechSidecar)
  return installSidecar(payload)
}

export async function restartFrierenSpeechSidecarOnDesktop(payload: FrierenSpeechSidecarValidationPayload) {
  const context = await createFrierenSpeechRendererContext()
  if (!context) {
    return undefined
  }

  const restartSidecar = defineInvoke(context, electronRestartFrierenSpeechSidecar)
  return restartSidecar(payload)
}

export async function importFrierenSpeechSidecarConfigOnDesktop(payload: FrierenSpeechSidecarValidationPayload) {
  const context = await createFrierenSpeechRendererContext()
  if (!context) {
    return undefined
  }

  const importSidecarConfig = defineInvoke(context, electronImportFrierenSpeechSidecarConfig)
  return importSidecarConfig(payload)
}

export async function testFrierenSpeechDualLlmOnDesktop(payload: FrierenSpeechSidecarValidationPayload) {
  const context = await createFrierenSpeechRendererContext()
  if (!context) {
    return undefined
  }

  const testDualLlm = defineInvoke(context, electronTestFrierenSpeechDualLlm)
  return testDualLlm(payload)
}
