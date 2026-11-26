const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file, mockedElectron) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  const originalLoad = Module._load
  try {
    if (mockedElectron) {
      Module._load = function (id, ...args) {
        if (id === 'electron') return mockedElectron
        return originalLoad.call(this, id, ...args)
      }
    }
    mod._compile(built.outputFiles[0].text, mod.filename)
    return mod.exports
  } finally {
    Module._load = originalLoad
  }
}

test('PlatformPaths on Linux uses .local/share/zipply when XDG_DATA_HOME is unset', () => {
  const oldEnv = process.env.XDG_DATA_HOME
  delete process.env.XDG_DATA_HOME
  try {
    const mockApp = { getPath: name => name === 'home' ? '/home/testuser' : '' }
    const { getLinuxDataDir, getDefaultWorkspacesDir } = load('src/main/services/PlatformPaths.ts', { app: mockApp })
    
    const dataDir = getLinuxDataDir('/home/testuser')
    assert.equal(dataDir, path.join('/home/testuser', '.local', 'share', 'zipply'))

    const workspacesDir = getDefaultWorkspacesDir('linux', '/home/testuser')
    assert.equal(workspacesDir, path.join('/home/testuser', '.local', 'share', 'zipply', 'workspaces'))
  } finally {
    if (oldEnv !== undefined) process.env.XDG_DATA_HOME = oldEnv
  }
})

test('PlatformPaths on Linux respects custom XDG_DATA_HOME', () => {
  const oldEnv = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = '/custom/data/home'
  try {
    const mockApp = { getPath: name => name === 'home' ? '/home/testuser' : '' }
    const { getLinuxDataDir, getDefaultWorkspacesDir } = load('src/main/services/PlatformPaths.ts', { app: mockApp })

    const dataDir = getLinuxDataDir('/home/testuser')
    assert.equal(dataDir, path.join('/custom/data/home', 'zipply'))

    const workspacesDir = getDefaultWorkspacesDir('linux', '/home/testuser')
    assert.equal(workspacesDir, path.join('/custom/data/home', 'zipply', 'workspaces'))
  } finally {
    if (oldEnv !== undefined) process.env.XDG_DATA_HOME = oldEnv
    else delete process.env.XDG_DATA_HOME
  }
})

test('PlatformPaths on Windows uses ~/Zipply/workspaces', () => {
  const mockApp = { getPath: name => name === 'home' ? 'C:\\Users\\testuser' : '' }
  const { getDefaultWorkspacesDir } = load('src/main/services/PlatformPaths.ts', { app: mockApp })

  const workspacesDir = getDefaultWorkspacesDir('win32', 'C:\\Users\\testuser')
  assert.equal(workspacesDir, path.join('C:\\Users\\testuser', 'Zipply', 'workspaces'))
})

test('setupLinuxUserDataPath sets userData in Electron on Linux', () => {
  const oldPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  const oldEnv = process.env.XDG_DATA_HOME
  const oldE2e = process.env.ZIPPLY_E2E_ROOT
  delete process.env.XDG_DATA_HOME
  delete process.env.ZIPPLY_E2E_ROOT
  Object.defineProperty(process, 'platform', { value: 'linux' })

  let assignedName = ''
  let assignedPath = ''
  const mockApp = {
    getPath: name => name === 'home' ? '/home/linuxuser' : '',
    setPath: (name, val) => { assignedName = name; assignedPath = val }
  }

  try {
    const { setupLinuxUserDataPath } = load('src/main/services/PlatformPaths.ts', { app: mockApp })
    setupLinuxUserDataPath('/home/linuxuser')

    assert.equal(assignedName, 'userData')
    assert.equal(assignedPath, path.join('/home/linuxuser', '.local', 'share', 'zipply'))
  } finally {
    if (oldPlatform) Object.defineProperty(process, 'platform', oldPlatform)
    if (oldEnv !== undefined) process.env.XDG_DATA_HOME = oldEnv
    if (oldE2e !== undefined) process.env.ZIPPLY_E2E_ROOT = oldE2e
  }
})

test('migrateLegacyLinuxFolders moves ~/Zipply/workspaces to .local/share/zipply/workspaces and removes ~/Zipply', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-home-test-'))
  const oldPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'linux' })

  try {
    const legacyZipply = path.join(tmpHome, 'Zipply')
    const legacyWorkspaces = path.join(legacyZipply, 'workspaces')
    const chatDir = path.join(legacyWorkspaces, 'chat-legacy-1')
    await fs.mkdir(chatDir, { recursive: true })
    await fs.writeFile(path.join(chatDir, 'test.txt'), 'hello from old workspace')

    const mockApp = { getPath: name => name === 'home' ? tmpHome : '' }
    const { migrateLegacyLinuxFolders, getDefaultWorkspacesDir } = load('src/main/services/PlatformPaths.ts', { app: mockApp })

    await migrateLegacyLinuxFolders(tmpHome)

    // Verify chat was moved
    const targetDir = getDefaultWorkspacesDir('linux', tmpHome)
    const targetChat = path.join(targetDir, 'chat-legacy-1')
    const content = await fs.readFile(path.join(targetChat, 'test.txt'), 'utf8')
    assert.equal(content, 'hello from old workspace')

    // Verify ~/Zipply was removed
    let legacyExists = true
    try {
      await fs.access(legacyZipply)
    } catch {
      legacyExists = false
    }
    assert.equal(legacyExists, false, '~/Zipply should have been removed')
  } finally {
    if (oldPlatform) Object.defineProperty(process, 'platform', oldPlatform)
    await fs.rm(tmpHome, { recursive: true, force: true })
  }
})

test('migrateLegacyLinuxFolders copies secrets.json and sessions from legacy .config/zipply', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-config-test-'))
  const oldPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'linux' })

  try {
    const legacyConfig = path.join(tmpHome, '.config', 'zipply')
    await fs.mkdir(legacyConfig, { recursive: true })
    await fs.writeFile(path.join(legacyConfig, 'secrets.json'), '{"key":"secret"}')
    const sessionDir = path.join(legacyConfig, 'sessions')
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(path.join(sessionDir, 'chat-1.json'), '{"id":"chat-1"}')

    const mockApp = { getPath: name => name === 'home' ? tmpHome : '' }
    const { migrateLegacyLinuxFolders, getLinuxDataDir } = load('src/main/services/PlatformPaths.ts', { app: mockApp })

    await migrateLegacyLinuxFolders(tmpHome)

    const targetDir = getLinuxDataDir(tmpHome)
    const migratedSecret = await fs.readFile(path.join(targetDir, 'secrets.json'), 'utf8')
    assert.equal(migratedSecret, '{"key":"secret"}')

    const migratedSession = await fs.readFile(path.join(targetDir, 'sessions', 'chat-1.json'), 'utf8')
    assert.equal(migratedSession, '{"id":"chat-1"}')
  } finally {
    if (oldPlatform) Object.defineProperty(process, 'platform', oldPlatform)
    await fs.rm(tmpHome, { recursive: true, force: true })
  }
})
