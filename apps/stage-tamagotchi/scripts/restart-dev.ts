import process from 'node:process'

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const userDataDir = join(process.env.HOME ?? '', 'Library/Application Support/@proj-airi/stage-tamagotchi')
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const staleLocks = [
  join(userDataDir, 'LOCK'),
  join(userDataDir, 'SingletonLock'),
]

async function removeStaleLocks() {
  await Promise.all(staleLocks.map(async (lockFile) => {
    await rm(lockFile, { force: true }).catch(() => {})
  }))
}

async function killExistingElectronProcesses() {
  const killCommand = [
    'pkill',
    '-f',
    'electron-vite dev|electron-vite preview|Electron.app/Contents/MacOS/Electron|@proj-airi/stage-tamagotchi',
  ]

  await new Promise<void>((resolve) => {
    const child = spawn(killCommand[0], killCommand.slice(1), {
      stdio: 'ignore',
    })

    child.on('error', () => resolve())
    child.on('exit', () => resolve())
  })
}

async function main() {
  await killExistingElectronProcesses()
  await removeStaleLocks()

  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: packageDir,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}

void main()
