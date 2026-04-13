import type { ChildProcess } from 'node:child_process'

import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  FrierenSpeechDualLlmTestResult,
  FrierenSpeechProfilingResult,
  FrierenSpeechProfilingSample,
  FrierenSpeechProfilingTimings,
  FrierenSpeechSidecarImportedConfigResult,
  FrierenSpeechSidecarStatusResult,
  FrierenSpeechSidecarValidationPayload,
  FrierenSpeechSidecarValidationResult,
} from '@proj-airi/stage-shared/frieren-speech'
import type { BrowserWindow } from 'electron'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import {
  electronGetFrierenSpeechSidecarStatus,
  electronImportFrierenSpeechSidecarConfig,
  electronInstallFrierenSpeechSidecar,
  electronProfileFrierenSpeechOnDesktop,
  electronRestartFrierenSpeechSidecar,
  electronTestFrierenSpeechDualLlm,
  electronValidateFrierenSpeechSidecar,
} from '@proj-airi/stage-shared/frieren-speech'
import { app } from 'electron'

const defaultFrierenSpeechBaseUrl = 'http://127.0.0.1:8010/v1/'
const frierenSpeechSidecarStartupTimeoutMsec = 15_000
const frierenSpeechSidecarStartupLockTimeoutMsec = 15_000
const frierenSpeechBootstrapTimeoutMsec = 10 * 60_000
const frierenSpeechDualLlmTestTimeoutMsec = 30_000
const frierenSpeechProfilingTimeoutMsec = 60_000
const frierenSpeechManagedRuntimeVersion = 12
const frierenSpeechBundledSourceDirName = 'frieren-rvc-sidecar'
const frierenSpeechBootstrapLogFileName = 'bootstrap.log'
const loopbackHostnames = new Set(['127.0.0.1', 'localhost'])

interface ManagedFrierenSpeechSidecarState {
  baseUrl: string
  configSignature: string
  process?: ChildProcess
  resolvedBridgeDir: string
  resolvedEnvFile?: string
}

interface ManagedFrierenSpeechRuntimeStateFile {
  bootstrappedAt: string
  runtimeVersion: number
  sourcePath: string
  venvPath: string
}

interface ManagedFrierenSpeechRuntimePaths {
  logsPath: string
  rootPath: string
  sourcePath: string
  state?: ManagedFrierenSpeechRuntimeStateFile
  venvPath: string
}

interface ResolvedManagedFrierenSpeechRuntime extends ManagedFrierenSpeechRuntimePaths {
  resolvedEnvFile: string
  state: ManagedFrierenSpeechRuntimeStateFile
}

interface FrierenSpeechSidecarLaunchConfig {
  launchMode: 'bundled' | 'external'
  resolvedBridgeDir: string
  resolvedEnvFile?: string
  runScriptPath: string
  runtimeRootPath?: string
  venvPath?: string
}

interface ResolvedFrierenSpeechBundledConfig {
  dualLlmApiKey?: string
  dualLlmBaseUrl?: string
  dualLlmModel?: string
  envFileMode: 'generated-from-fields' | 'provided-env-file'
  kokoroProjectDir?: string
  resolvedEnvFile: string
  rvcDevice?: string
  rvcIndexPath?: string
  rvcModelPath?: string
}

let managedFrierenSpeechSidecarState: ManagedFrierenSpeechSidecarState | null = null
let managedFrierenSpeechSidecarShutdownInstalled = false
let managedFrierenSpeechRuntimeBootstrapPromise: Promise<ResolvedManagedFrierenSpeechRuntime> | null = null
let managedFrierenSpeechSidecarStartupPromise: Promise<FrierenSpeechSidecarValidationResult> | null = null

function joinUserDataPath(...paths: string[]) {
  return resolve(app.getPath('userData'), ...paths)
}

function getManagedFrierenSpeechStartupLockPath() {
  return joinUserDataPath('frieren-rvc-sidecar-startup.lock')
}

function getManagedFrierenSpeechStartupLockOwnerPath() {
  return resolve(getManagedFrierenSpeechStartupLockPath(), 'owner.json')
}

function getManagedFrierenSpeechRuntimeRootPath() {
  return joinUserDataPath(frierenSpeechBundledSourceDirName)
}

function getManagedFrierenSpeechRuntimeSourcePath() {
  return resolve(getManagedFrierenSpeechRuntimeRootPath(), 'source')
}

function getManagedFrierenSpeechRuntimeVenvPath() {
  return resolve(getManagedFrierenSpeechRuntimeRootPath(), 'venv')
}

function getManagedFrierenSpeechRuntimeLogsPath() {
  return resolve(getManagedFrierenSpeechRuntimeRootPath(), 'logs')
}

function getManagedFrierenSpeechRuntimeStatePath() {
  return resolve(getManagedFrierenSpeechRuntimeRootPath(), 'state.json')
}

function getManagedFrierenSpeechDefaultEnvFilePath(runtimeRootPath = getManagedFrierenSpeechRuntimeRootPath()) {
  return resolve(runtimeRootPath, 'sidecar.env')
}

function getManagedFrierenSpeechBootstrapLogPath(runtimeRootPath = getManagedFrierenSpeechRuntimeRootPath()) {
  return resolve(runtimeRootPath, 'logs', frierenSpeechBootstrapLogFileName)
}

function normalizeFrierenSpeechBaseUrl(value: string | undefined) {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    return defaultFrierenSpeechBaseUrl
  }

  const normalized = new URL(trimmed)
  if (normalized.pathname === '/' || normalized.pathname === '') {
    normalized.pathname = '/v1/'
  }
  else if (normalized.pathname === '/v1') {
    normalized.pathname = '/v1/'
  }
  else if (!normalized.pathname.endsWith('/')) {
    normalized.pathname = `${normalized.pathname}/`
  }

  normalized.search = ''
  normalized.hash = ''

  return normalized.toString()
}

function toHealthUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  url.pathname = '/health'
  url.search = ''
  url.hash = ''
  return url
}

function resolveBridgeDir(input: string) {
  return normalize(resolve(input.trim()))
}

function resolveOptionalEnvFilePath(basePath: string, envFile: string | undefined) {
  const trimmed = envFile?.trim() ?? ''
  if (!trimmed) {
    return undefined
  }

  return normalize(isAbsolute(trimmed) ? resolve(trimmed) : resolve(basePath, trimmed))
}

function readTrimmedPath(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || undefined
}

function toShellEnvValue(value: string) {
  return `'${value.replaceAll('\'', `'\\''`)}'`
}

function parseSimpleEnvFile(content: string) {
  const parsed = new Map<string, string>()

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line
    const separatorIndex = normalizedLine.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalizedLine.slice(0, separatorIndex).trim()
    let value = normalizedLine.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }

    parsed.set(key, value)
  }

  return parsed
}

async function writeManagedFrierenSpeechBundledEnvFile(params: {
  dualLlmApiKey?: string
  dualLlmBaseUrl?: string
  dualLlmModel?: string
  kokoroProjectDir: string
  resolvedEnvFile: string
  rvcDevice?: string
  runtimeRootPath: string
  rvcIndexPath: string
  rvcModelPath: string
}) {
  const trimmedDualLlmApiKey = readTrimmedPath(params.dualLlmApiKey)
  const trimmedDualLlmBaseUrl = readTrimmedPath(params.dualLlmBaseUrl)
  const trimmedDualLlmModel = readTrimmedPath(params.dualLlmModel)
  const trimmedRvcDevice = readTrimmedPath(params.rvcDevice)
  const lines = [
    `KOKORO_PROJECT_DIR=${toShellEnvValue(params.kokoroProjectDir)}`,
    `RVC_MODEL_PATH=${toShellEnvValue(params.rvcModelPath)}`,
    `RVC_INDEX_PATH=${toShellEnvValue(params.rvcIndexPath)}`,
    `RVC_WORKDIR=${toShellEnvValue(resolve(params.runtimeRootPath, 'workdir'))}`,
    `RVC_ASSETS_DIR=${toShellEnvValue(resolve(params.runtimeRootPath, 'assets'))}`,
    ...(trimmedRvcDevice ? [`FORCE_RVC_DEVICE=${toShellEnvValue(trimmedRvcDevice)}`] : []),
    ...(trimmedDualLlmApiKey ? [`DUAL_LLM_API_KEY=${toShellEnvValue(trimmedDualLlmApiKey)}`] : []),
    ...(trimmedDualLlmBaseUrl ? [`DUAL_LLM_BASE_URL=${toShellEnvValue(trimmedDualLlmBaseUrl)}`] : []),
    ...(trimmedDualLlmModel ? [`DUAL_LLM_MODEL=${toShellEnvValue(trimmedDualLlmModel)}`] : []),
    '',
  ]

  await mkdir(dirname(params.resolvedEnvFile), { recursive: true })
  await writeFile(params.resolvedEnvFile, lines.join('\n'), 'utf8')
}

function createFrierenSpeechStatusResult(params: {
  dualLlmApiKeyConfigured?: boolean
  dualLlmBaseUrl?: string
  dualLlmModel?: string
  launchMode: 'bundled' | 'external'
  message: string
  resolvedBridgeDir: string
  resolvedEnvFile?: string
  rvcDevice?: string
  runtimeRootPath?: string
  sourcePath?: string
  status: FrierenSpeechSidecarStatusResult['status']
  validatedBaseUrl: string
  venvPath?: string
}): FrierenSpeechSidecarStatusResult {
  return {
    ...(typeof params.dualLlmApiKeyConfigured === 'boolean' ? { dualLlmApiKeyConfigured: params.dualLlmApiKeyConfigured } : {}),
    ...(params.dualLlmBaseUrl ? { dualLlmBaseUrl: params.dualLlmBaseUrl } : {}),
    ...(params.dualLlmModel ? { dualLlmModel: params.dualLlmModel } : {}),
    launchMode: params.launchMode,
    message: params.message,
    resolvedBridgeDir: params.resolvedBridgeDir,
    ...(params.resolvedEnvFile ? { resolvedEnvFile: params.resolvedEnvFile } : {}),
    ...(params.rvcDevice ? { rvcDevice: params.rvcDevice } : {}),
    ...(params.runtimeRootPath ? { runtimeRootPath: params.runtimeRootPath } : {}),
    ...(params.runtimeRootPath ? { bootstrapLogPath: getManagedFrierenSpeechBootstrapLogPath(params.runtimeRootPath) } : {}),
    ...(params.sourcePath ? { sourcePath: params.sourcePath } : {}),
    status: params.status,
    validatedBaseUrl: params.validatedBaseUrl,
    ...(params.venvPath ? { venvPath: params.venvPath } : {}),
  }
}

async function readFrierenSpeechRuntimeEnvConfig(resolvedEnvFile: string | undefined) {
  if (!resolvedEnvFile || !(await isReadableFile(resolvedEnvFile))) {
    return {
      dualLlmApiKeyConfigured: false,
      dualLlmBaseUrl: undefined,
      dualLlmModel: undefined,
      rvcDevice: undefined,
    }
  }

  const content = await readFile(resolvedEnvFile, 'utf8')
  const parsed = parseSimpleEnvFile(content)
  const dualLlmApiKey = readTrimmedPath(parsed.get('DUAL_LLM_API_KEY'))
  const dualLlmBaseUrl = readTrimmedPath(parsed.get('DUAL_LLM_BASE_URL'))
  const dualLlmModel = readTrimmedPath(parsed.get('DUAL_LLM_MODEL'))
  const rvcDevice = readTrimmedPath(parsed.get('FORCE_RVC_DEVICE'))

  return {
    dualLlmApiKeyConfigured: !!dualLlmApiKey,
    ...(dualLlmBaseUrl ? { dualLlmBaseUrl } : {}),
    ...(dualLlmModel ? { dualLlmModel } : {}),
    ...(rvcDevice ? { rvcDevice } : {}),
  }
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

async function isReadableFile(path: string) {
  try {
    await assertReadableFile(path, 'File')
    return true
  }
  catch {
    return false
  }
}

async function copyDirectoryContents(sourcePath: string, targetPath: string) {
  await mkdir(targetPath, { recursive: true })
  const entries = await readdir(sourcePath, { withFileTypes: true })

  await Promise.all(entries.map(async (entry) => {
    const sourceEntryPath = resolve(sourcePath, entry.name)
    const targetEntryPath = resolve(targetPath, entry.name)

    if (entry.isDirectory()) {
      await copyDirectoryContents(sourceEntryPath, targetEntryPath)
      return
    }

    await mkdir(dirname(targetEntryPath), { recursive: true })
    await copyFile(sourceEntryPath, targetEntryPath)
  }))
}

async function readManagedFrierenSpeechRuntimeState() {
  try {
    const content = await readFile(getManagedFrierenSpeechRuntimeStatePath(), 'utf8')
    const parsed = JSON.parse(content) as Partial<ManagedFrierenSpeechRuntimeStateFile>
    if (
      typeof parsed.bootstrappedAt === 'string'
      && typeof parsed.runtimeVersion === 'number'
      && typeof parsed.sourcePath === 'string'
      && typeof parsed.venvPath === 'string'
    ) {
      return parsed as ManagedFrierenSpeechRuntimeStateFile
    }
  }
  catch {
    // Ignore missing or invalid state files.
  }

  return undefined
}

async function writeManagedFrierenSpeechRuntimeState(state: ManagedFrierenSpeechRuntimeStateFile) {
  await mkdir(getManagedFrierenSpeechRuntimeRootPath(), { recursive: true })
  await writeFile(getManagedFrierenSpeechRuntimeStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

async function resolveBundledFrierenSpeechSourcePath() {
  const candidates = [
    resolve(import.meta.dirname, '../../../../../resources', frierenSpeechBundledSourceDirName),
    resolve(app.getAppPath(), 'resources', frierenSpeechBundledSourceDirName),
    resolve(process.cwd(), 'apps', 'stage-tamagotchi', 'resources', frierenSpeechBundledSourceDirName),
  ]

  for (const candidate of candidates) {
    try {
      await assertReadableDirectory(candidate, 'Bundled Frieren sidecar source')
      return normalize(candidate)
    }
    catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Unable to locate bundled Frieren sidecar source. Tried: ${candidates.join(', ')}`)
}

async function runManagedFrierenShellScript(params: {
  cwd: string
  env: NodeJS.ProcessEnv
  label: string
  scriptPath: string
  timeoutMsec: number
}) {
  return await new Promise<{ combinedOutput: string, stderr: string, stdout: string }>((resolvePromise, rejectPromise) => {
    let settled = false
    let stderr = ''
    let stdout = ''

    const child = spawn('bash', [params.scriptPath], {
      cwd: params.cwd,
      env: sanitizeFrierenShellEnv({
        env: params.env,
        shellWorkingDirectory: params.cwd,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill()
      rejectPromise(new Error(`Timed out while running Frieren ${params.label}.`))
    }, params.timeoutMsec)

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      console.info(`[frieren-sidecar:${params.label}] ${text.trimEnd()}`)
    })

    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      console.warn(`[frieren-sidecar:${params.label}] ${text.trimEnd()}`)
    })

    child.once('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      rejectPromise(error)
    })

    child.once('exit', (code) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      const combinedOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      if (code === 0) {
        resolvePromise({
          combinedOutput,
          stderr,
          stdout,
        })
        return
      }

      rejectPromise(new Error(combinedOutput || `Frieren ${params.label} exited with code ${code ?? 'null'}.`))
    })
  })
}

function resolveFrierenShellWorkingDirectory(params: {
  launchMode?: 'bundled' | 'external'
  resolvedBridgeDir?: string
  runtimeRootPath?: string
}) {
  if (params.launchMode === 'bundled' && params.runtimeRootPath) {
    return params.runtimeRootPath
  }

  if (params.resolvedBridgeDir) {
    return params.resolvedBridgeDir
  }

  return app.getPath('home')
}

function sanitizeFrierenShellEnv(params: {
  env: NodeJS.ProcessEnv
  shellWorkingDirectory: string
  runtimeRootPath?: string
}) {
  const nextEnv = {
    ...params.env,
  }

  delete nextEnv.INIT_CWD
  delete nextEnv.OLDPWD
  delete nextEnv.PWD

  return {
    ...nextEnv,
    OLDPWD: params.runtimeRootPath ?? params.shellWorkingDirectory,
    PWD: params.shellWorkingDirectory,
  }
}

async function runCommandCapture(command: string, args: string[]) {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise(stdout)
        return
      }

      rejectPromise(new Error(stderr.trim() || `${command} exited with code ${code ?? 'null'}.`))
    })
  })
}

async function stopOrphanedManagedFrierenSpeechProcesses(exceptPid?: number) {
  const managedPythonPath = `${getManagedFrierenSpeechRuntimeVenvPath()}/bin/python`
  let processTable = ''

  try {
    processTable = await runCommandCapture('ps', ['-ax', '-o', 'pid=,command='])
  }
  catch {
    return
  }

  const candidatePids = processTable
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed.includes(managedPythonPath) || !trimmed.includes('-m uvicorn app:app')) {
        return undefined
      }

      const match = trimmed.match(/^(\d+)\s+/u)
      if (!match) {
        return undefined
      }

      const pid = Number(match[1])
      if (!Number.isFinite(pid) || pid <= 0 || pid === exceptPid || pid === process.pid) {
        return undefined
      }

      return pid
    })
    .filter((pid): pid is number => typeof pid === 'number')

  await Promise.all(candidatePids.map(async (pid) => {
    try {
      process.kill(pid, 'SIGTERM')
    }
    catch {
      return
    }

    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
        await delay(100)
      }
      catch {
        return
      }
    }

    try {
      process.kill(pid, 'SIGKILL')
    }
    catch {
      // Ignore races when the process exits between probes.
    }
  }))
}

async function ensureManagedFrierenSpeechRuntimeExpanded(): Promise<ManagedFrierenSpeechRuntimePaths> {
  const rootPath = getManagedFrierenSpeechRuntimeRootPath()
  const sourcePath = getManagedFrierenSpeechRuntimeSourcePath()
  const venvPath = getManagedFrierenSpeechRuntimeVenvPath()
  const logsPath = getManagedFrierenSpeechRuntimeLogsPath()
  const state = await readManagedFrierenSpeechRuntimeState()

  if (state?.runtimeVersion === frierenSpeechManagedRuntimeVersion) {
    try {
      await assertReadableDirectory(sourcePath, 'Managed Frieren sidecar source')
      await assertReadableFile(resolve(sourcePath, 'run-managed.sh'), 'Managed Frieren run script')

      return {
        logsPath,
        rootPath,
        sourcePath,
        state,
        venvPath,
      }
    }
    catch {
      // Re-expand the bundled source when the managed copy is incomplete.
    }
  }

  const bundledSourcePath = await resolveBundledFrierenSpeechSourcePath()
  await mkdir(rootPath, { recursive: true })
  await rm(sourcePath, { force: true, recursive: true })
  await copyDirectoryContents(bundledSourcePath, sourcePath)

  return {
    logsPath,
    rootPath,
    sourcePath,
    state,
    venvPath,
  }
}

async function resolveManagedFrierenSpeechEnvFileState(runtimeRootPath: string, envFile: string | undefined) {
  const resolvedExplicitEnvFile = resolveOptionalEnvFilePath(runtimeRootPath, envFile)
  if (resolvedExplicitEnvFile) {
    await assertReadableFile(resolvedExplicitEnvFile, 'Frieren sidecar env file')
    return {
      missing: false,
      resolvedEnvFile: resolvedExplicitEnvFile,
    }
  }

  const defaultEnvFilePath = getManagedFrierenSpeechDefaultEnvFilePath(runtimeRootPath)
  if (await isReadableFile(defaultEnvFilePath)) {
    return {
      missing: false,
      resolvedEnvFile: defaultEnvFilePath,
    }
  }

  return {
    missing: true,
    resolvedEnvFile: defaultEnvFilePath,
  }
}

async function resolveManagedFrierenSpeechBundledConfig(
  runtimeRootPath: string,
  payload: FrierenSpeechSidecarValidationPayload,
): Promise<ResolvedFrierenSpeechBundledConfig> {
  const dualLlmApiKey = readTrimmedPath(payload.dualLlmApiKey)
  const dualLlmBaseUrl = readTrimmedPath(payload.dualLlmBaseUrl)
  const dualLlmModel = readTrimmedPath(payload.dualLlmModel)
  const rvcDevice = readTrimmedPath(payload.rvcDevice)
  let kokoroProjectDir = readTrimmedPath(payload.kokoroProjectDir)
  let rvcModelPath = readTrimmedPath(payload.rvcModelPath)
  let rvcIndexPath = readTrimmedPath(payload.rvcIndexPath)
  const hasDualLlmFields = !!dualLlmApiKey || !!dualLlmBaseUrl || !!dualLlmModel
  const hasRvcDeviceField = !!rvcDevice

  if (!kokoroProjectDir && !rvcModelPath && !rvcIndexPath && (hasDualLlmFields || hasRvcDeviceField)) {
    const envFileState = await resolveManagedFrierenSpeechEnvFileState(runtimeRootPath, payload.envFile)
    if (!envFileState.missing) {
      const content = await readFile(envFileState.resolvedEnvFile, 'utf8')
      const parsed = parseSimpleEnvFile(content)
      kokoroProjectDir = readTrimmedPath(parsed.get('KOKORO_PROJECT_DIR'))
      rvcModelPath = readTrimmedPath(parsed.get('RVC_MODEL_PATH'))
      rvcIndexPath = readTrimmedPath(parsed.get('RVC_INDEX_PATH'))
    }
  }

  if (kokoroProjectDir || rvcModelPath || rvcIndexPath || hasDualLlmFields || hasRvcDeviceField) {
    if (!kokoroProjectDir || !rvcModelPath || !rvcIndexPath) {
      throw new Error('Bundled Frieren sidecar requires Kokoro project directory, RVC model path, and RVC index path together.')
    }

    const resolvedKokoroProjectDir = normalize(isAbsolute(kokoroProjectDir) ? resolve(kokoroProjectDir) : resolve(runtimeRootPath, kokoroProjectDir))
    const resolvedRvcModelPath = normalize(isAbsolute(rvcModelPath) ? resolve(rvcModelPath) : resolve(runtimeRootPath, rvcModelPath))
    const resolvedRvcIndexPath = normalize(isAbsolute(rvcIndexPath) ? resolve(rvcIndexPath) : resolve(runtimeRootPath, rvcIndexPath))
    const resolvedEnvFile = getManagedFrierenSpeechDefaultEnvFilePath(runtimeRootPath)

    await assertReadableDirectory(resolvedKokoroProjectDir, 'Frieren Kokoro project directory')
    await assertReadableFile(resolvedRvcModelPath, 'Frieren RVC model path')
    await assertReadableFile(resolvedRvcIndexPath, 'Frieren RVC index path')
    await writeManagedFrierenSpeechBundledEnvFile({
      ...(dualLlmApiKey ? { dualLlmApiKey } : {}),
      ...(dualLlmBaseUrl ? { dualLlmBaseUrl } : {}),
      ...(dualLlmModel ? { dualLlmModel } : {}),
      kokoroProjectDir: resolvedKokoroProjectDir,
      resolvedEnvFile,
      ...(rvcDevice ? { rvcDevice } : {}),
      runtimeRootPath,
      rvcIndexPath: resolvedRvcIndexPath,
      rvcModelPath: resolvedRvcModelPath,
    })

    return {
      ...(dualLlmApiKey ? { dualLlmApiKey } : {}),
      ...(dualLlmBaseUrl ? { dualLlmBaseUrl } : {}),
      ...(dualLlmModel ? { dualLlmModel } : {}),
      envFileMode: 'generated-from-fields',
      kokoroProjectDir: resolvedKokoroProjectDir,
      resolvedEnvFile,
      ...(rvcDevice ? { rvcDevice } : {}),
      rvcIndexPath: resolvedRvcIndexPath,
      rvcModelPath: resolvedRvcModelPath,
    }
  }

  const envFileState = await resolveManagedFrierenSpeechEnvFileState(runtimeRootPath, payload.envFile)
  if (envFileState.missing) {
    throw new Error(`Bundled Frieren sidecar needs either Kokoro/RVC paths in AIRI settings or an env file at ${envFileState.resolvedEnvFile}.`)
  }

  return {
    envFileMode: 'provided-env-file',
    resolvedEnvFile: envFileState.resolvedEnvFile,
  }
}

async function ensureManagedFrierenSpeechRuntime(payload: FrierenSpeechSidecarValidationPayload): Promise<ResolvedManagedFrierenSpeechRuntime> {
  const runtimePaths = await ensureManagedFrierenSpeechRuntimeExpanded()
  const bundledConfig = await resolveManagedFrierenSpeechBundledConfig(runtimePaths.rootPath, payload)
  const forceReinstall = payload.forceReinstall === true

  const managedPythonPath = resolve(runtimePaths.venvPath, 'bin/python')
  if (!forceReinstall && runtimePaths.state?.runtimeVersion === frierenSpeechManagedRuntimeVersion) {
    try {
      await assertReadableFile(managedPythonPath, 'Managed Frieren runtime python')
      return {
        ...runtimePaths,
        resolvedEnvFile: bundledConfig.resolvedEnvFile,
        state: runtimePaths.state,
      }
    }
    catch {
      // Re-bootstrap when the managed virtual environment is missing.
    }
  }

  const bootstrapScriptPath = resolve(runtimePaths.sourcePath, 'bootstrap.sh')
  await assertReadableFile(bootstrapScriptPath, 'Managed Frieren bootstrap script')
  await mkdir(runtimePaths.logsPath, { recursive: true })

  if (managedFrierenSpeechRuntimeBootstrapPromise) {
    return managedFrierenSpeechRuntimeBootstrapPromise
  }

  const bootstrapLogPath = getManagedFrierenSpeechBootstrapLogPath(runtimePaths.rootPath)
  managedFrierenSpeechRuntimeBootstrapPromise = (async () => {
    try {
      const bootstrapWorkingDirectory = resolveFrierenShellWorkingDirectory({
        launchMode: 'bundled',
        runtimeRootPath: runtimePaths.rootPath,
      })
      const bootstrapResult = await runManagedFrierenShellScript({
        cwd: bootstrapWorkingDirectory,
        env: sanitizeFrierenShellEnv({
          env: {
          ...process.env,
          AIRI_FRIEREN_SIDECAR_RUNTIME_DIR: runtimePaths.rootPath,
          ENV_FILE: bundledConfig.resolvedEnvFile,
          PYTHON_BIN: process.env.PYTHON_BIN ?? '3.10',
          VENV_DIR: runtimePaths.venvPath,
          },
          runtimeRootPath: runtimePaths.rootPath,
          shellWorkingDirectory: bootstrapWorkingDirectory,
        }),
        label: 'bootstrap',
        scriptPath: bootstrapScriptPath,
        timeoutMsec: frierenSpeechBootstrapTimeoutMsec,
      })
      await writeFile(bootstrapLogPath, `${bootstrapResult.combinedOutput}\n`, 'utf8')
    }
    catch (error) {
      await writeFile(bootstrapLogPath, `${errorMessageFrom(error) ?? 'Frieren bootstrap failed.'}\n`, 'utf8')
      throw error
    }

    await assertReadableFile(managedPythonPath, 'Managed Frieren runtime python')

    const nextState: ManagedFrierenSpeechRuntimeStateFile = {
      bootstrappedAt: new Date().toISOString(),
      runtimeVersion: frierenSpeechManagedRuntimeVersion,
      sourcePath: runtimePaths.sourcePath,
      venvPath: runtimePaths.venvPath,
    }
    await writeManagedFrierenSpeechRuntimeState(nextState)

    return {
      ...runtimePaths,
      resolvedEnvFile: bundledConfig.resolvedEnvFile,
      state: nextState,
    }
  })()

  try {
    return await managedFrierenSpeechRuntimeBootstrapPromise
  }
  finally {
    managedFrierenSpeechRuntimeBootstrapPromise = null
  }
}

async function resolveFrierenSpeechSidecarLaunchConfig(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarLaunchConfig> {
  const bridgeDirInput = payload.bridgeDir?.trim() ?? ''
  if (bridgeDirInput) {
    const resolvedBridgeDir = resolveBridgeDir(bridgeDirInput)
    await assertReadableDirectory(resolvedBridgeDir, 'Frieren bridge directory')

    const runScriptPath = resolve(resolvedBridgeDir, 'run-local.sh')
    await assertReadableFile(runScriptPath, 'Frieren run-local.sh')

    const resolvedEnvFile = resolveOptionalEnvFilePath(resolvedBridgeDir, payload.envFile)
    if (resolvedEnvFile) {
      await assertReadableFile(resolvedEnvFile, 'Frieren sidecar env file')
    }

    return {
      launchMode: 'external',
      resolvedBridgeDir,
      resolvedEnvFile,
      runScriptPath,
    }
  }

  const managedRuntime = await ensureManagedFrierenSpeechRuntime(payload)
  const runScriptPath = resolve(managedRuntime.sourcePath, 'run-managed.sh')
  await assertReadableFile(runScriptPath, 'Managed Frieren run-managed.sh')

  return {
    launchMode: 'bundled',
    resolvedBridgeDir: managedRuntime.sourcePath,
    resolvedEnvFile: managedRuntime.resolvedEnvFile,
    runScriptPath,
    runtimeRootPath: managedRuntime.rootPath,
    venvPath: managedRuntime.venvPath,
  }
}

async function isManagedFrierenSpeechSidecarReachable(baseUrl: string) {
  try {
    const response = await fetch(toHealthUrl(baseUrl))
    return response.ok
  }
  catch {
    return false
  }
}

async function stopManagedFrierenSpeechSidecar() {
  const current = managedFrierenSpeechSidecarState
  managedFrierenSpeechSidecarState = null

  const currentProcess = current?.process
  if (!currentProcess || currentProcess.pid == null) {
    await stopOrphanedManagedFrierenSpeechProcesses()
    return
  }

  currentProcess.kill()
  await Promise.race([
    new Promise<void>((resolvePromise) => {
      currentProcess.once('exit', () => resolvePromise())
    }),
    delay(2_000).then(() => {
      if (currentProcess.pid != null) {
        currentProcess.kill()
      }
    }),
  ])

  await stopOrphanedManagedFrierenSpeechProcesses(currentProcess.pid ?? undefined)
}

async function acquireManagedFrierenSpeechStartupLock(baseUrl: string) {
  const deadline = Date.now() + frierenSpeechSidecarStartupLockTimeoutMsec
  const lockPath = getManagedFrierenSpeechStartupLockPath()

  while (Date.now() < deadline) {
    try {
      await mkdir(lockPath)
      await writeFile(getManagedFrierenSpeechStartupLockOwnerPath(), JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
      }, null, 2), 'utf8')
      return true
    }
    catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : ''
      if (code !== 'EEXIST') {
        throw error
      }

      if (await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
        return false
      }

      try {
        const lockStat = await stat(lockPath)
        const lockAgeMsec = Date.now() - lockStat.mtimeMs
        if (lockAgeMsec >= frierenSpeechSidecarStartupLockTimeoutMsec) {
          await rm(lockPath, { force: true, recursive: true })
          continue
        }
      }
      catch {
        // The lock may have been removed concurrently. Retry acquiring it.
        continue
      }

      await delay(200)
    }
  }

  throw new Error('Timed out while waiting for the AIRI-managed Frieren sidecar startup lock.')
}

async function releaseManagedFrierenSpeechStartupLock() {
  try {
    await rm(getManagedFrierenSpeechStartupLockPath(), { force: true, recursive: true })
  }
  catch {
    // Ignore lock cleanup failures.
  }
}

async function waitForManagedFrierenSpeechSidecarReady(baseUrl: string) {
  const deadline = Date.now() + frierenSpeechSidecarStartupTimeoutMsec

  while (Date.now() < deadline) {
    if (await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
      return
    }

    await delay(250)
  }

  throw new Error('Timed out while starting the AIRI-managed Frieren sidecar.')
}

async function ensureManagedFrierenSpeechSidecar(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarValidationResult> {
  const baseUrl = normalizeFrierenSpeechBaseUrl(payload.baseUrl)
  const parsedBaseUrl = new URL(baseUrl)

  if (!loopbackHostnames.has(parsedBaseUrl.hostname)) {
    throw new Error('AIRI-managed Frieren sidecar must use localhost or 127.0.0.1.')
  }

  if (!parsedBaseUrl.pathname.startsWith('/v1')) {
    throw new Error('Frieren sidecar base URL must point to the /v1 API path.')
  }

  const launchConfig = await resolveFrierenSpeechSidecarLaunchConfig(payload)
  const configSignature = JSON.stringify({
    baseUrl,
    launchMode: launchConfig.launchMode,
    resolvedBridgeDir: launchConfig.resolvedBridgeDir,
    resolvedEnvFile: launchConfig.resolvedEnvFile,
    runtimeRootPath: launchConfig.runtimeRootPath ?? '',
  })

  if (managedFrierenSpeechSidecarStartupPromise) {
    return managedFrierenSpeechSidecarStartupPromise
  }

  if (managedFrierenSpeechSidecarState?.process && managedFrierenSpeechSidecarState.configSignature !== configSignature) {
    await stopManagedFrierenSpeechSidecar()
  }

  if (managedFrierenSpeechSidecarState?.configSignature === configSignature && await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
    return {
      valid: true,
      message: `AIRI-managed Frieren sidecar is reachable at ${baseUrl}.`,
      resolvedBridgeDir: launchConfig.resolvedBridgeDir,
      ...(launchConfig.resolvedEnvFile ? { resolvedEnvFile: launchConfig.resolvedEnvFile } : {}),
      validatedBaseUrl: baseUrl,
    }
  }

  if (await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
    managedFrierenSpeechSidecarState = {
      baseUrl,
      configSignature,
      resolvedBridgeDir: launchConfig.resolvedBridgeDir,
      resolvedEnvFile: launchConfig.resolvedEnvFile,
    }
    return {
      valid: true,
      message: `Frieren sidecar is reachable at ${baseUrl}.`,
      resolvedBridgeDir: launchConfig.resolvedBridgeDir,
      ...(launchConfig.resolvedEnvFile ? { resolvedEnvFile: launchConfig.resolvedEnvFile } : {}),
      validatedBaseUrl: baseUrl,
    }
  }

  managedFrierenSpeechSidecarStartupPromise = (async () => {
    const ownsStartupLock = await acquireManagedFrierenSpeechStartupLock(baseUrl)
    if (!ownsStartupLock) {
      managedFrierenSpeechSidecarState = {
        baseUrl,
        configSignature,
        resolvedBridgeDir: launchConfig.resolvedBridgeDir,
        resolvedEnvFile: launchConfig.resolvedEnvFile,
      }
      return {
        valid: true,
        message: `Frieren sidecar is reachable at ${baseUrl}.`,
        resolvedBridgeDir: launchConfig.resolvedBridgeDir,
        ...(launchConfig.resolvedEnvFile ? { resolvedEnvFile: launchConfig.resolvedEnvFile } : {}),
        validatedBaseUrl: baseUrl,
      }
    }

    await stopManagedFrierenSpeechSidecar()

    let startupFailure: string | null = null
    const shellWorkingDirectory = resolveFrierenShellWorkingDirectory({
      launchMode: launchConfig.launchMode,
      resolvedBridgeDir: launchConfig.resolvedBridgeDir,
      runtimeRootPath: launchConfig.runtimeRootPath,
    })
    const child = spawn('bash', [launchConfig.runScriptPath], {
      cwd: shellWorkingDirectory,
      env: sanitizeFrierenShellEnv({
        env: {
        ...process.env,
        HOST: parsedBaseUrl.hostname,
        KOKORO_SYNTH_MODE: 'embedded',
        PORT: parsedBaseUrl.port || '8010',
        ...(launchConfig.resolvedEnvFile ? { ENV_FILE: launchConfig.resolvedEnvFile } : {}),
        ...(launchConfig.runtimeRootPath
          ? {
              AIRI_FRIEREN_SIDECAR_RUNTIME_DIR: launchConfig.runtimeRootPath,
              VENV_DIR: launchConfig.venvPath ?? resolve(launchConfig.runtimeRootPath, 'venv'),
            }
          : {}),
        },
        runtimeRootPath: launchConfig.runtimeRootPath,
        shellWorkingDirectory,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout?.on('data', (chunk) => {
      console.info(`[frieren-sidecar] ${String(chunk).trimEnd()}`)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) {
        startupFailure = startupFailure ? `${startupFailure}\n${text}` : text
        console.warn(`[frieren-sidecar] ${text}`)
      }
    })
    child.once('exit', (code) => {
      if (code !== 0) {
        const detail = `frieren sidecar exited before ready (code=${code ?? 'null'})`
        startupFailure = startupFailure ? `${startupFailure}\n${detail}` : detail
      }
    })

    managedFrierenSpeechSidecarState = {
      baseUrl,
      configSignature,
      process: child,
      resolvedBridgeDir: launchConfig.resolvedBridgeDir,
      resolvedEnvFile: launchConfig.resolvedEnvFile,
    }

    if (!managedFrierenSpeechSidecarShutdownInstalled) {
      managedFrierenSpeechSidecarShutdownInstalled = true
      app.once('before-quit', () => {
        void stopManagedFrierenSpeechSidecar()
      })
    }

    try {
      await waitForManagedFrierenSpeechSidecarReady(baseUrl)
      return {
        valid: true,
        message: `AIRI-managed Frieren sidecar is reachable at ${baseUrl}.`,
        resolvedBridgeDir: launchConfig.resolvedBridgeDir,
        ...(launchConfig.resolvedEnvFile ? { resolvedEnvFile: launchConfig.resolvedEnvFile } : {}),
        validatedBaseUrl: baseUrl,
      }
    }
    catch (error) {
      const startupFailureMessage = startupFailure ?? ''
      if (startupFailureMessage.includes('Address already in use') && await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
        managedFrierenSpeechSidecarState = {
          baseUrl,
          configSignature,
          resolvedBridgeDir: launchConfig.resolvedBridgeDir,
          resolvedEnvFile: launchConfig.resolvedEnvFile,
        }
        return {
          valid: true,
          message: `Frieren sidecar is reachable at ${baseUrl}.`,
          resolvedBridgeDir: launchConfig.resolvedBridgeDir,
          ...(launchConfig.resolvedEnvFile ? { resolvedEnvFile: launchConfig.resolvedEnvFile } : {}),
          validatedBaseUrl: baseUrl,
        }
      }

      await stopManagedFrierenSpeechSidecar()
      throw new Error(startupFailure || errorMessageFrom(error) || 'Failed to start the AIRI-managed Frieren sidecar.')
    }
    finally {
      await releaseManagedFrierenSpeechStartupLock()
    }
  })()

  try {
    return await managedFrierenSpeechSidecarStartupPromise
  }
  finally {
    managedFrierenSpeechSidecarStartupPromise = null
  }
}

async function getBundledFrierenSpeechSidecarStatus(payload: FrierenSpeechSidecarValidationPayload, baseUrl: string) {
  const runtimePaths = await ensureManagedFrierenSpeechRuntimeExpanded()
  const hasBundledFields = !!readTrimmedPath(payload.kokoroProjectDir)
    || !!readTrimmedPath(payload.rvcModelPath)
    || !!readTrimmedPath(payload.rvcIndexPath)
    || !!readTrimmedPath(payload.dualLlmApiKey)
    || !!readTrimmedPath(payload.dualLlmBaseUrl)
    || !!readTrimmedPath(payload.dualLlmModel)
  const envFileState = await resolveManagedFrierenSpeechEnvFileState(runtimePaths.rootPath, payload.envFile)
  const runtimeBase = {
    launchMode: 'bundled' as const,
    resolvedBridgeDir: runtimePaths.sourcePath,
    ...(envFileState.resolvedEnvFile ? { resolvedEnvFile: envFileState.resolvedEnvFile } : {}),
    runtimeRootPath: runtimePaths.rootPath,
    sourcePath: runtimePaths.sourcePath,
    validatedBaseUrl: baseUrl,
    venvPath: runtimePaths.venvPath,
  }

  if (hasBundledFields) {
    try {
      const bundledConfig = await resolveManagedFrierenSpeechBundledConfig(runtimePaths.rootPath, payload)
      const runtimeEnvConfig = await readFrierenSpeechRuntimeEnvConfig(bundledConfig.resolvedEnvFile)
      const dualLlmMessage = runtimeEnvConfig.dualLlmApiKeyConfigured
        ? ' Dual LLM runtime config is present.'
        : ' Dual LLM runtime config is missing `DUAL_LLM_API_KEY`, so text response will fail until AIRI rewrites and restarts the managed sidecar.'

      if (await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
        return createFrierenSpeechStatusResult({
          ...runtimeEnvConfig,
          ...runtimeBase,
          message: `AIRI-managed Frieren sidecar is running at ${baseUrl}.${dualLlmMessage}`,
          resolvedEnvFile: bundledConfig.resolvedEnvFile,
          status: 'running',
        })
      }

      const runtimeReady = runtimePaths.state?.runtimeVersion === frierenSpeechManagedRuntimeVersion
        && await isReadableFile(resolve(runtimePaths.venvPath, 'bin/python'))

      return createFrierenSpeechStatusResult({
        ...runtimeEnvConfig,
        ...runtimeBase,
        message: runtimeReady
          ? `Bundled Frieren sidecar runtime is ready. AIRI will start it when validation or playback needs it.${dualLlmMessage}`
          : `Bundled Frieren sidecar source is expanded, but the Python runtime still needs install or repair.${dualLlmMessage}`,
        resolvedEnvFile: bundledConfig.resolvedEnvFile,
        status: runtimeReady ? 'ready' : 'needs-install',
      })
    }
    catch (error) {
      return createFrierenSpeechStatusResult({
        ...runtimeBase,
        ...(envFileState.resolvedEnvFile ? { resolvedEnvFile: envFileState.resolvedEnvFile } : {}),
        message: errorMessageFrom(error) ?? 'Bundled Frieren sidecar configuration is incomplete.',
        status: 'missing-config',
      })
    }
  }

  if (envFileState.missing) {
    return createFrierenSpeechStatusResult({
      ...runtimeBase,
      message: `Bundled Frieren sidecar needs either Kokoro/RVC paths in AIRI settings or an env file at ${envFileState.resolvedEnvFile}.`,
      status: 'missing-config',
    })
  }

  const runtimeReady = runtimePaths.state?.runtimeVersion === frierenSpeechManagedRuntimeVersion
    && await isReadableFile(resolve(runtimePaths.venvPath, 'bin/python'))

  if (await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
    return createFrierenSpeechStatusResult({
      ...runtimeBase,
      message: `AIRI-managed Frieren sidecar is running at ${baseUrl}.`,
      status: 'running',
    })
  }

  if (!runtimeReady) {
    return createFrierenSpeechStatusResult({
      ...runtimeBase,
      message: 'Bundled Frieren sidecar source is expanded, but the Python runtime still needs install or repair.',
      status: 'needs-install',
    })
  }

  return createFrierenSpeechStatusResult({
    ...runtimeBase,
    message: 'Bundled Frieren sidecar runtime is ready. AIRI will start it when validation or playback needs it.',
    status: 'ready',
  })
}

async function getExternalFrierenSpeechSidecarStatus(payload: FrierenSpeechSidecarValidationPayload, baseUrl: string) {
  const resolvedBridgeDir = resolveBridgeDir(payload.bridgeDir)
  await assertReadableDirectory(resolvedBridgeDir, 'Frieren bridge directory')

  const runScriptPath = resolve(resolvedBridgeDir, 'run-local.sh')
  await assertReadableFile(runScriptPath, 'Frieren run-local.sh')

  const resolvedEnvFile = resolveOptionalEnvFilePath(resolvedBridgeDir, payload.envFile)
  if (resolvedEnvFile) {
    await assertReadableFile(resolvedEnvFile, 'Frieren sidecar env file')
  }
  const runtimeEnvConfig = await readFrierenSpeechRuntimeEnvConfig(resolvedEnvFile)
  const dualLlmMessage = runtimeEnvConfig.dualLlmApiKeyConfigured
    ? ' Dual LLM runtime config is present.'
    : (resolvedEnvFile ? ' Dual LLM runtime config is missing `DUAL_LLM_API_KEY` in the configured env file.' : '')

  if (await isManagedFrierenSpeechSidecarReachable(baseUrl)) {
    return createFrierenSpeechStatusResult({
      ...runtimeEnvConfig,
      launchMode: 'external',
      message: `External Frieren sidecar is running at ${baseUrl}.${dualLlmMessage}`,
      resolvedBridgeDir,
      ...(resolvedEnvFile ? { resolvedEnvFile } : {}),
      status: 'running',
      validatedBaseUrl: baseUrl,
    })
  }

  return createFrierenSpeechStatusResult({
    ...runtimeEnvConfig,
    launchMode: 'external',
    message: `External Frieren checkout is configured. AIRI will start it when validation or playback needs it.${dualLlmMessage}`,
    resolvedBridgeDir,
    ...(resolvedEnvFile ? { resolvedEnvFile } : {}),
    status: 'ready',
    validatedBaseUrl: baseUrl,
  })
}

async function getFrierenSpeechSidecarStatus(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarStatusResult> {
  const baseUrl = normalizeFrierenSpeechBaseUrl(payload.baseUrl)
  const bridgeDirInput = payload.bridgeDir?.trim() ?? ''

  try {
    if (bridgeDirInput) {
      return await getExternalFrierenSpeechSidecarStatus(payload, baseUrl)
    }

    return await getBundledFrierenSpeechSidecarStatus(payload, baseUrl)
  }
  catch (error) {
    return createFrierenSpeechStatusResult({
      launchMode: bridgeDirInput ? 'external' : 'bundled',
      message: errorMessageFrom(error) ?? 'Failed to inspect the Frieren sidecar runtime.',
      resolvedBridgeDir: bridgeDirInput ? resolveBridgeDir(bridgeDirInput) : getManagedFrierenSpeechRuntimeSourcePath(),
      ...(bridgeDirInput
        ? (payload.envFile?.trim() ? { resolvedEnvFile: payload.envFile.trim() } : {})
        : {
            resolvedEnvFile: resolveOptionalEnvFilePath(getManagedFrierenSpeechRuntimeRootPath(), payload.envFile)
              ?? getManagedFrierenSpeechDefaultEnvFilePath(),
            runtimeRootPath: getManagedFrierenSpeechRuntimeRootPath(),
            sourcePath: getManagedFrierenSpeechRuntimeSourcePath(),
            venvPath: getManagedFrierenSpeechRuntimeVenvPath(),
          }),
      status: 'invalid',
      validatedBaseUrl: baseUrl,
    })
  }
}

async function toFailedFrierenSpeechStatus(payload: FrierenSpeechSidecarValidationPayload, error: unknown, fallbackMessage: string) {
  const status = await getFrierenSpeechSidecarStatus(payload)
  if (status.status === 'invalid' || status.status === 'missing-env-file' || status.status === 'missing-config') {
    return status
  }

  return {
    ...status,
    message: errorMessageFrom(error) ?? fallbackMessage,
    status: 'invalid' as const,
  }
}

async function installFrierenSpeechSidecar(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarStatusResult> {
  if (payload.bridgeDir?.trim()) {
    const status = await getFrierenSpeechSidecarStatus(payload)
    if (status.status === 'invalid') {
      return status
    }

    return {
      ...status,
      message: 'External Frieren checkout mode uses its own Python environment. AIRI install or repair only applies to the bundled runtime.',
    }
  }

  const baseUrl = normalizeFrierenSpeechBaseUrl(payload.baseUrl)

  try {
    const runtime = await ensureManagedFrierenSpeechRuntime(payload)
    const isRunning = await isManagedFrierenSpeechSidecarReachable(baseUrl)

    return createFrierenSpeechStatusResult({
      launchMode: 'bundled',
      message: isRunning
        ? `Bundled Frieren sidecar runtime is installed and currently running at ${baseUrl}.`
        : 'Bundled Frieren sidecar runtime is installed and ready. AIRI will start it on demand.',
      resolvedBridgeDir: runtime.sourcePath,
      resolvedEnvFile: runtime.resolvedEnvFile,
      runtimeRootPath: runtime.rootPath,
      sourcePath: runtime.sourcePath,
      status: isRunning ? 'running' : 'ready',
      validatedBaseUrl: baseUrl,
      venvPath: runtime.venvPath,
    })
  }
  catch (error) {
    return toFailedFrierenSpeechStatus(payload, error, 'Failed to install or repair the bundled Frieren sidecar runtime.')
  }
}

async function restartFrierenSpeechSidecar(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarStatusResult> {
  try {
    await stopManagedFrierenSpeechSidecar()
    const validationResult = await ensureManagedFrierenSpeechSidecar(payload)
    const status = await getFrierenSpeechSidecarStatus(payload)

    return {
      ...status,
      message: validationResult.message,
      status: 'running',
    }
  }
  catch (error) {
    return toFailedFrierenSpeechStatus(payload, error, 'Failed to restart the Frieren sidecar.')
  }
}

async function importFrierenSpeechSidecarConfig(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarImportedConfigResult> {
  const bridgeDirInput = payload.bridgeDir?.trim() ?? ''
  if (bridgeDirInput) {
    return {
      imported: false,
      message: 'Importing structured Kokoro and RVC paths is only available for the bundled Frieren runtime.',
    }
  }

  const runtimeRootPath = getManagedFrierenSpeechRuntimeRootPath()
  const resolvedEnvFile = resolveOptionalEnvFilePath(runtimeRootPath, payload.envFile) ?? getManagedFrierenSpeechDefaultEnvFilePath(runtimeRootPath)

  try {
    await assertReadableFile(resolvedEnvFile, 'Frieren sidecar env file')
    const content = await readFile(resolvedEnvFile, 'utf8')
    const parsed = parseSimpleEnvFile(content)
    const dualLlmApiKey = readTrimmedPath(parsed.get('DUAL_LLM_API_KEY'))
    const dualLlmBaseUrl = readTrimmedPath(parsed.get('DUAL_LLM_BASE_URL'))
    const dualLlmModel = readTrimmedPath(parsed.get('DUAL_LLM_MODEL'))
    const rvcDevice = readTrimmedPath(parsed.get('FORCE_RVC_DEVICE'))
    const kokoroProjectDir = readTrimmedPath(parsed.get('KOKORO_PROJECT_DIR'))
    const rvcModelPath = readTrimmedPath(parsed.get('RVC_MODEL_PATH'))
    const rvcIndexPath = readTrimmedPath(parsed.get('RVC_INDEX_PATH'))

    if (!kokoroProjectDir || !rvcModelPath || !rvcIndexPath) {
      return {
        imported: false,
        message: 'The env file does not contain KOKORO_PROJECT_DIR, RVC_MODEL_PATH, and RVC_INDEX_PATH together.',
        resolvedEnvFile,
        ...(dualLlmApiKey ? { dualLlmApiKey } : {}),
        ...(dualLlmBaseUrl ? { dualLlmBaseUrl } : {}),
        ...(dualLlmModel ? { dualLlmModel } : {}),
        ...(rvcDevice ? { rvcDevice } : {}),
        ...(kokoroProjectDir ? { kokoroProjectDir } : {}),
        ...(rvcModelPath ? { rvcModelPath } : {}),
        ...(rvcIndexPath ? { rvcIndexPath } : {}),
      }
    }

    return {
      imported: true,
      message: 'Imported Kokoro and RVC paths from the existing env file.',
      ...(dualLlmApiKey ? { dualLlmApiKey } : {}),
      ...(dualLlmBaseUrl ? { dualLlmBaseUrl } : {}),
      ...(dualLlmModel ? { dualLlmModel } : {}),
      ...(rvcDevice ? { rvcDevice } : {}),
      resolvedEnvFile,
      kokoroProjectDir,
      rvcIndexPath,
      rvcModelPath,
    }
  }
  catch (error) {
    return {
      imported: false,
      message: errorMessageFrom(error) ?? 'Failed to import structured Kokoro and RVC paths from the env file.',
      resolvedEnvFile,
    }
  }
}

async function validateFrierenSpeechSidecar(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechSidecarValidationResult> {
  try {
    return await ensureManagedFrierenSpeechSidecar(payload)
  }
  catch (error) {
    return {
      valid: false,
      message: errorMessageFrom(error) ?? 'Failed to validate the AIRI-managed Frieren sidecar.',
      resolvedBridgeDir: payload.bridgeDir?.trim() || getManagedFrierenSpeechRuntimeSourcePath(),
      ...(payload.envFile?.trim() ? { resolvedEnvFile: payload.envFile.trim() } : {}),
      validatedBaseUrl: normalizeFrierenSpeechBaseUrl(payload.baseUrl),
    }
  }
}

async function testFrierenSpeechDualLlm(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechDualLlmTestResult> {
  const startedAt = Date.now()
  const abortController = new AbortController()
  const abortTimeout = setTimeout(() => {
    abortController.abort(new Error('Timed out while waiting for the Dual LLM test response.'))
  }, frierenSpeechDualLlmTestTimeoutMsec)

  try {
    await stopManagedFrierenSpeechSidecar()
    const validationResult = await ensureManagedFrierenSpeechSidecar(payload)
    const requestUrl = new URL('dual/text', validationResult.validatedBaseUrl)
    const response = await fetch(requestUrl, {
      body: JSON.stringify({
        input: '請只回答「測試成功」。',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: abortController.signal,
    })
    const responseText = (await response.text()).trim()
    const durationMs = Date.now() - startedAt

    if (!response.ok) {
      return {
        durationMs,
        message: `Dual LLM test failed with HTTP ${response.status}.`,
        responseText,
        statusCode: response.status,
        success: false,
      }
    }

    return {
      durationMs,
      message: 'Dual LLM test succeeded.',
      responseText,
      statusCode: response.status,
      success: true,
    }
  }
  catch (error) {
    const errorMessage = errorMessageFrom(error) ?? 'Dual LLM test failed.'
    return {
      durationMs: Date.now() - startedAt,
      message: errorMessage.includes('Timed out while waiting for the Dual LLM test response')
        ? `Dual LLM test timed out after ${frierenSpeechDualLlmTestTimeoutMsec / 1000} seconds.`
        : errorMessage,
      success: false,
    }
  }
  finally {
    clearTimeout(abortTimeout)
  }
}

function readFrierenTimingNumber(headers: Headers, name: string) {
  const rawValue = headers.get(name)
  if (!rawValue) {
    return undefined
  }

  const parsed = Number(rawValue)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readFrierenProfilingTimings(headers: Headers): FrierenSpeechProfilingTimings {
  const dualCacheHit = headers.get('X-Frieren-Dual-Cache-Hit')

  return {
    totalMs: readFrierenTimingNumber(headers, 'X-Frieren-Timing-Total-Ms'),
    dualTextMs: readFrierenTimingNumber(headers, 'X-Frieren-Timing-Dual-Text-Ms'),
    llmMs: readFrierenTimingNumber(headers, 'X-Frieren-Timing-Llm-Ms'),
    kokoroMs: readFrierenTimingNumber(headers, 'X-Frieren-Timing-Kokoro-Ms'),
    rvcMs: readFrierenTimingNumber(headers, 'X-Frieren-Timing-Rvc-Ms'),
    encodeMs: readFrierenTimingNumber(headers, 'X-Frieren-Timing-Encode-Ms'),
    ...(dualCacheHit === null ? {} : { dualCacheHit: dualCacheHit === '1' }),
  }
}

async function fetchFrierenProfilingSample(params: {
  baseUrl: string
  body: Record<string, unknown>
  pathname: string
  timeoutMsec: number
}): Promise<FrierenSpeechProfilingSample> {
  const abortController = new AbortController()
  const abortTimeout = setTimeout(() => {
    abortController.abort(new Error(`Timed out while profiling ${params.pathname}.`))
  }, params.timeoutMsec)
  const startedAt = Date.now()

  try {
    const response = await fetch(new URL(params.pathname, params.baseUrl), {
      body: JSON.stringify(params.body),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: abortController.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    const responsePreview = contentType.includes('application/json')
      ? (await response.text()).trim().slice(0, 1000)
      : undefined

    return {
      durationMs: Date.now() - startedAt,
      ...(responsePreview ? { responsePreview } : {}),
      statusCode: response.status,
      timings: readFrierenProfilingTimings(response.headers),
    }
  }
  finally {
    clearTimeout(abortTimeout)
  }
}

async function profileFrierenSpeech(payload: FrierenSpeechSidecarValidationPayload): Promise<FrierenSpeechProfilingResult> {
  try {
    await stopManagedFrierenSpeechSidecar()
    const validationResult = await ensureManagedFrierenSpeechSidecar(payload)
    const profilingResponseFormat = payload.profilingResponseFormat === 'wav' ? 'wav' : 'mp3'
    const text = await fetchFrierenProfilingSample({
      baseUrl: validationResult.validatedBaseUrl,
      body: {
        input: '請只回答 測試成功',
      },
      pathname: 'dual/text',
      timeoutMsec: frierenSpeechProfilingTimeoutMsec,
    })
    const speech = await fetchFrierenProfilingSample({
      baseUrl: validationResult.validatedBaseUrl,
      body: {
        input: '這是一個語音速度測試。',
        model: 'frieren-rvc',
        response_format: profilingResponseFormat,
        speed: 1.0,
        voice: 'frieren',
      },
      pathname: 'audio/speech',
      timeoutMsec: frierenSpeechProfilingTimeoutMsec,
    })

    return {
      message: 'Frieren speech profiling completed.',
      speech,
      success: true,
      text,
    }
  }
  catch (error) {
    return {
      message: errorMessageFrom(error) ?? 'Frieren speech profiling failed.',
      success: false,
    }
  }
}

export function createFrierenSpeechService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  void params.window

  defineInvokeHandler(params.context, electronValidateFrierenSpeechSidecar, async (payload) => {
    return validateFrierenSpeechSidecar(payload)
  })

  defineInvokeHandler(params.context, electronGetFrierenSpeechSidecarStatus, async (payload) => {
    return getFrierenSpeechSidecarStatus(payload)
  })

  defineInvokeHandler(params.context, electronInstallFrierenSpeechSidecar, async (payload) => {
    return installFrierenSpeechSidecar(payload)
  })

  defineInvokeHandler(params.context, electronRestartFrierenSpeechSidecar, async (payload) => {
    return restartFrierenSpeechSidecar(payload)
  })

  defineInvokeHandler(params.context, electronImportFrierenSpeechSidecarConfig, async (payload) => {
    return importFrierenSpeechSidecarConfig(payload)
  })

  defineInvokeHandler(params.context, electronTestFrierenSpeechDualLlm, async (payload) => {
    return testFrierenSpeechDualLlm(payload)
  })

  defineInvokeHandler(params.context, electronProfileFrierenSpeechOnDesktop, async (payload) => {
    return profileFrierenSpeech(payload)
  })
}

export const __frierenSpeechTestUtils = {
  ensureManagedFrierenSpeechRuntime,
  ensureManagedFrierenSpeechRuntimeExpanded,
  ensureManagedFrierenSpeechSidecar,
  getFrierenSpeechSidecarStatus,
  importFrierenSpeechSidecarConfig,
  installFrierenSpeechSidecar,
  normalizeFrierenSpeechBaseUrl,
  resolveBundledFrierenSpeechSourcePath,
  restartFrierenSpeechSidecar,
  stopManagedFrierenSpeechSidecar,
  profileFrierenSpeech,
  testFrierenSpeechDualLlm,
  validateFrierenSpeechSidecar,
}
