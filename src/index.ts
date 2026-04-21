import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import yaml from 'js-yaml'

const execFileAsync = promisify(execFile)

type DistTags = Record<string, string | undefined>

type InstallCommand = 'install' | 'ci'

type SingleRunInstallConfig = {
  command?: InstallCommand
  recursive?: boolean
  cwd?: string
  args?: string[]
}

type RunInstallValue = boolean | null | SingleRunInstallConfig | SingleRunInstallConfig[]

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function aubeCommand(): string {
  return process.platform === 'win32' ? 'aube.exe' : 'aube'
}

function normalizeVersionInput(input: string): string {
  const value = input.trim()
  return value === '' ? 'latest' : value
}

function stripLeadingV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version
}

async function resolveVersion(input: string): Promise<string> {
  const normalized = normalizeVersionInput(input)

  if (normalized === 'latest' || normalized === 'next') {
    const { stdout } = await execFileAsync(
      npmCommand(),
      ['view', '@endevco/aube', 'dist-tags', '--json'],
      { encoding: 'utf8' }
    )

    const tags = JSON.parse(stdout) as DistTags
    const resolved = tags[normalized]

    if (!resolved) {
      throw new Error(`Could not resolve npm dist-tag "${normalized}" for @endevco/aube`)
    }

    return stripLeadingV(resolved)
  }

  return stripLeadingV(normalized)
}

function mapArch(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'x86_64'
    case 'arm64':
      return 'aarch64'
    default:
      throw new Error(`Unsupported architecture: ${arch}`)
  }
}

function getTarget(): { arch: string; os: string; ext: 'zip' | 'tar.gz' } {
  switch (process.platform) {
    case 'linux':
      return {
        arch: mapArch(process.arch),
        os: 'unknown-linux-gnu',
        ext: 'tar.gz'
      }
    case 'darwin':
      return {
        arch: mapArch(process.arch),
        os: 'apple-darwin',
        ext: 'tar.gz'
      }
    case 'win32':
      return {
        arch: mapArch(process.arch),
        os: 'pc-windows-msvc',
        ext: 'zip'
      }
    default:
      throw new Error(`Unsupported platform: ${process.platform}`)
  }
}

function buildAssetInfo(version: string): {
  releaseTag: string
  assetName: string
  assetUrl: string
} {
  const target = getTarget()
  const releaseTag = `v${stripLeadingV(version)}`
  const assetName = `aube-${releaseTag}-${target.arch}-${target.os}.${target.ext}`
  const assetUrl = `https://github.com/endevco/aube/releases/download/${releaseTag}/${assetName}`

  return { releaseTag, assetName, assetUrl }
}

function findExecutable(root: string): string {
  const exeName = process.platform === 'win32' ? 'aube.exe' : 'aube'
  const stack: string[] = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (entry.isFile() && entry.name === exeName) {
        return fullPath
      }
    }
  }

  throw new Error(`Could not find ${exeName} in extracted archive`)
}

async function downloadAndExtract(
  assetUrl: string,
  releaseTag: string,
  assetName: string
): Promise<string> {
  core.info(`Downloading ${assetUrl}`)

  const downloadedPath = await tc.downloadTool(assetUrl)
  const extractRoot = path.join(
    process.env['RUNNER_TEMP'] || process.cwd(),
    'setup-aube',
    releaseTag
  )

  fs.mkdirSync(extractRoot, { recursive: true })

  if (assetName.endsWith('.zip')) {
    return tc.extractZip(downloadedPath, extractRoot)
  }

  if (assetName.endsWith('.tar.gz')) {
    return tc.extractTar(downloadedPath, extractRoot)
  }

  throw new Error(`Unsupported archive format for asset: ${assetName}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSingleRunInstallConfig(value: unknown): SingleRunInstallConfig {
  if (!isPlainObject(value)) {
    throw new Error('run_install object entries must be YAML objects')
  }

  const commandValue = value.command
  let command: InstallCommand = 'install'

  if (commandValue !== undefined) {
    if (commandValue !== 'install' && commandValue !== 'ci') {
      throw new Error('run_install.command must be either "install" or "ci"')
    }
    command = commandValue
  }

  const recursiveValue = value.recursive
  if (recursiveValue !== undefined && typeof recursiveValue !== 'boolean') {
    throw new Error('run_install.recursive must be a boolean')
  }

  const cwdValue = value.cwd
  if (cwdValue !== undefined && typeof cwdValue !== 'string') {
    throw new Error('run_install.cwd must be a string')
  }

  const argsValue = value.args
  if (argsValue !== undefined) {
    if (!Array.isArray(argsValue) || !argsValue.every(arg => typeof arg === 'string')) {
      throw new Error('run_install.args must be an array of strings')
    }
  }

  return {
    command,
    recursive: recursiveValue ?? false,
    cwd: cwdValue ?? process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
    args: argsValue ?? []
  }
}

function parseRunInstall(raw: string): SingleRunInstallConfig[] {
  const trimmed = raw.trim()

  if (trimmed === '' || trimmed === 'null') {
    return []
  }

  if (trimmed === 'false') {
    return []
  }

  if (trimmed === 'true') {
    return [
      {
        command: 'install',
        recursive: false,
        cwd: process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
        args: []
      }
    ]
  }

  let parsed: RunInstallValue
  try {
    parsed = yaml.load(trimmed) as RunInstallValue
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid run_install YAML: ${error.message}`)
    }
    throw error
  }

  if (parsed === null || parsed === false) {
    return []
  }

  if (parsed === true) {
    return [
      {
        command: 'install',
        recursive: false,
        cwd: process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
        args: []
      }
    ]
  }

  if (Array.isArray(parsed)) {
    return parsed.map(normalizeSingleRunInstallConfig)
  }

  return [normalizeSingleRunInstallConfig(parsed)]
}

async function execFileLogged(command: string, args: string[], cwd?: string): Promise<void> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: 'utf8',
    cwd
  })

  if (stdout.trim() !== '') {
    core.info(stdout.trim())
  }

  if (stderr.trim() !== '') {
    core.info(stderr.trim())
  }
}

async function maybeRunInstall(): Promise<void> {
  const raw = core.getInput('run_install')
  const steps = parseRunInstall(raw)

  if (steps.length === 0) {
    core.info('run_install is disabled')
    return
  }

  for (const step of steps) {
    const command = step.command ?? 'install'
    const args: string[] = []

    if (step.recursive) {
      args.push('--recursive')
    }

    args.push(...(step.args ?? []))

    core.info(
      `Running \`aube ${command}${args.length > 0 ? ` ${args.join(' ')}` : ''}\` in ${step.cwd}`
    )

    await execFileLogged(aubeCommand(), [command, ...args], step.cwd)
  }
}

async function run(): Promise<void> {
  try {
    const versionInput = core.getInput('version')
    const resolvedVersion = await resolveVersion(versionInput)
    const { releaseTag, assetName, assetUrl } = buildAssetInfo(resolvedVersion)

    core.info(`Resolved aube version: ${releaseTag}`)
    core.info(`Selected asset: ${assetName}`)

    const extractedPath = await downloadAndExtract(assetUrl, releaseTag, assetName)
    const executablePath = findExecutable(extractedPath)
    const binDir = path.dirname(executablePath)

    core.addPath(binDir)
    core.setOutput('version', releaseTag)
    core.setOutput('bin-dir', binDir)

    core.info(`aube installed at ${executablePath}`)

    await maybeRunInstall()
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      return
    }

    core.setFailed(String(error))
  }
}

void run()
