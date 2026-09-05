const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const os = require('os')

const rootDir = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const distDir = path.join(rootDir, 'dist')
const linuxUnpacked = path.join(distDir, 'linux-unpacked')
const buildDir = path.join(rootDir, 'build')
const iconsDir = path.join(buildDir, 'icons')

const pkgName = 'zipply'
const pkgVersion = `${pkg.version}_1`
const pkgVer = `${pkgName}-${pkgVersion}`
const arch = 'x86_64'

console.log('===> 1. Packaging Linux directory with electron-builder...')
execSync('npx electron-builder --linux dir', { cwd: rootDir, stdio: 'inherit' })

// Use OS temp dir to avoid non-ASCII path encoding issues with CLI tools
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-xbps-'))

try {
  const stageDir = path.join(tmpDir, 'stage')
  const optAppDir = path.join(stageDir, 'opt', 'zipply')
  const usrBinDir = path.join(stageDir, 'usr', 'bin')
  const usrAppsDir = path.join(stageDir, 'usr', 'share', 'applications')
  const usrPixmapsDir = path.join(stageDir, 'usr', 'share', 'pixmaps')

  fs.mkdirSync(optAppDir, { recursive: true })
  fs.mkdirSync(usrBinDir, { recursive: true })
  fs.mkdirSync(usrAppsDir, { recursive: true })
  fs.mkdirSync(usrPixmapsDir, { recursive: true })

  console.log('===> 2. Copying application files...')
  function copyRecursive(src, dst) {
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
      for (const file of fs.readdirSync(src)) {
        copyRecursive(path.join(src, file), path.join(dst, file))
      }
    } else {
      fs.copyFileSync(src, dst)
    }
  }
  copyRecursive(linuxUnpacked, optAppDir)

  // Copy icons to hicolor
  const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512]
  for (const s of iconSizes) {
    const sizeDir = path.join(stageDir, 'usr', 'share', 'icons', 'hicolor', `${s}x${s}`, 'apps')
    fs.mkdirSync(sizeDir, { recursive: true })
    const iconSrc = path.join(iconsDir, `${s}x${s}.png`)
    if (fs.existsSync(iconSrc)) {
      fs.copyFileSync(iconSrc, path.join(sizeDir, `${pkgName}.png`))
    }
  }
  if (fs.existsSync(path.join(iconsDir, '512x512.png'))) {
    fs.copyFileSync(path.join(iconsDir, '512x512.png'), path.join(usrPixmapsDir, `${pkgName}.png`))
  }

  // Create .desktop file
  const desktopContent = `[Desktop Entry]
Name=Zipply
Comment=${pkg.description || 'Zipply - Electron React Vite Application'}
Exec=/opt/zipply/zipply %U
Terminal=false
Type=Application
Icon=zipply
StartupWMClass=zipply
Categories=Development;IDE;
`
  fs.writeFileSync(path.join(usrAppsDir, `${pkgName}.desktop`), desktopContent.replace(/\r\n/g, '\n'), 'utf8')

  // Create symlink / wrapper in /usr/bin
  const binWrapper = `#!/bin/sh
exec /opt/zipply/zipply "$@"
`
  fs.writeFileSync(path.join(usrBinDir, pkgName), binWrapper.replace(/\r\n/g, '\n'), { encoding: 'utf8', mode: 0o755 })

  console.log('===> 3. Generating XBPS INSTALL and REMOVE scripts...')
  const installScript = `#!/bin/sh
ACTION="$1"
PKGNAME="$2"
VERSION="$3"
UPDATE="$4"

case "$ACTION" in
post)
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
    chmod 4755 /opt/zipply/chrome-sandbox 2>/dev/null || true
    chmod 755 /opt/zipply/zipply 2>/dev/null || true
    chmod 755 /usr/bin/zipply 2>/dev/null || true
    ;;
esac
exit 0
`
  fs.writeFileSync(path.join(stageDir, 'INSTALL'), installScript.replace(/\r\n/g, '\n'), { encoding: 'utf8', mode: 0o755 })

  const removeScript = `#!/bin/sh
ACTION="$1"
PKGNAME="$2"
VERSION="$3"
UPDATE="$4"

case "$ACTION" in
post)
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q || true
    command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
    ;;
esac
exit 0
`
  fs.writeFileSync(path.join(stageDir, 'REMOVE'), removeScript.replace(/\r\n/g, '\n'), { encoding: 'utf8', mode: 0o755 })

  console.log('===> 4. Scanning files and generating XBPS metadata (props.plist & files.plist)...')

  function sha256File(filePath) {
    const fileBuffer = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(fileBuffer).digest('hex')
  }

  const dirsList = []
  const filesList = []
  let installedSize = 0

  function scanStage(dir, relPath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const virtualRel = relPath ? `${relPath}/${entry.name}` : entry.name
      const normalizedVirtualRel = `/${virtualRel.replace(/\\/g, '/')}`

      // Skip metadata files at the root of stage
      if (!relPath && (entry.name === 'INSTALL' || entry.name === 'REMOVE' || entry.name === 'props.plist' || entry.name === 'files.plist')) {
        continue
      }

      if (entry.isDirectory()) {
        dirsList.push(normalizedVirtualRel)
        scanStage(fullPath, virtualRel)
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath)
        installedSize += stat.size
        const hash = sha256File(fullPath)
        filesList.push({
          file: normalizedVirtualRel,
          sha256: hash,
          size: stat.size
        })
      }
    }
  }

  scanStage(stageDir)

  function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;'
        case '>': return '&gt;'
        case '&': return '&amp;'
        case "'": return '&apos;'
        case '"': return '&quot;'
        default: return c
      }
    })
  }

  const runDepends = [
    'gtk+3',
    'alsa-lib',
    'dbus-glib',
    'libnotify',
    'nss',
    'libXtst',
    'libsecret',
    'xdg-utils'
  ]

  const propsPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>architecture</key>
\t<string>${arch}</string>
\t<key>homepage</key>
\t<string>https://zipply.app</string>
\t<key>installed_size</key>
\t<integer>${installedSize}</integer>
\t<key>license</key>
\t<string>MIT</string>
\t<key>maintainer</key>
\t<string>${escapeXml(pkg.author || 'Zipply Team <support@zipply.app>')}</string>
\t<key>pkgname</key>
\t<string>${pkgName}</string>
\t<key>pkgver</key>
\t<string>${pkgVer}</string>
\t<key>run_depends</key>
\t<array>
${runDepends.map((d) => `\t\t<string>${escapeXml(d)}</string>`).join('\n')}
\t</array>
\t<key>short_desc</key>
\t<string>${escapeXml(pkg.description || 'Zipply AI Coding Assistant')}</string>
\t<key>version</key>
\t<string>${pkgVersion}</string>
</dict>
</plist>
`
  fs.writeFileSync(path.join(stageDir, 'props.plist'), propsPlist.replace(/\r\n/g, '\n'), 'utf8')

  const dirsXml = dirsList.map((d) => `\t\t<dict>\n\t\t\t<key>file</key>\n\t\t\t<string>${escapeXml(d)}</string>\n\t\t</dict>`).join('\n')
  const filesXml = filesList.map((f) => `\t\t<dict>\n\t\t\t<key>file</key>\n\t\t\t<string>${escapeXml(f.file)}</string>\n\t\t\t<key>sha256</key>\n\t\t\t<string>${f.sha256}</string>\n\t\t\t<key>size</key>\n\t\t\t<integer>${f.size}</integer>\n\t\t</dict>`).join('\n')

  const filesPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>dirs</key>
\t<array>
${dirsXml}
\t</array>
\t<key>files</key>
\t<array>
${filesXml}
\t</array>
</dict>
</plist>
`
  fs.writeFileSync(path.join(stageDir, 'files.plist'), filesPlist.replace(/\r\n/g, '\n'), 'utf8')

  console.log(`===> 5. Packing XBPS package (${pkgVer}.${arch}.xbps)... status: generating archive`)

  const xbpsFileName = `${pkgVer}.${arch}.xbps`
  const friendlyFileName = `zipple-${pkg.version}_1.${arch}.xbps`
  const xbpsFilePath = path.join(distDir, friendlyFileName)

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  const orderedEntries = []
  if (fs.existsSync(path.join(stageDir, 'INSTALL'))) orderedEntries.push('INSTALL')
  if (fs.existsSync(path.join(stageDir, 'REMOVE'))) orderedEntries.push('REMOVE')
  orderedEntries.push('props.plist')
  orderedEntries.push('files.plist')

  for (const entry of fs.readdirSync(stageDir)) {
    if (!orderedEntries.includes(entry)) {
      orderedEntries.push(entry)
    }
  }

  let useTarZstd = false
  try {
    const tarCheck = execSync('tar --help', { stdio: 'pipe' }).toString()
    if (tarCheck.includes('--zstd') || tarCheck.includes('libzstd') || tarCheck.includes('bsdtar')) {
      useTarZstd = true
    }
  } catch (e) {
    useTarZstd = false
  }

  const tempOutputFile = path.join(tmpDir, 'output.xbps')

  if (useTarZstd) {
    console.log('Using bsdtar with Zstandard (zstd) compression...')
    const itemsArg = orderedEntries.map((e) => `"${e}"`).join(' ')
    execSync(`tar --zstd -cf "${tempOutputFile}" ${itemsArg}`, {
      cwd: stageDir,
      stdio: 'inherit'
    })
  } else {
    console.log('Falling back to xz tar compression...')
    const itemsArg = orderedEntries.map((e) => `"${e}"`).join(' ')
    execSync(`tar -J -cf "${tempOutputFile}" ${itemsArg}`, {
      cwd: stageDir,
      stdio: 'inherit'
    })
  }

  // Copy from temp dir to target dist files
  fs.copyFileSync(tempOutputFile, xbpsFilePath)
  const canonicalPath = path.join(distDir, xbpsFileName)
  fs.copyFileSync(tempOutputFile, canonicalPath)

  const sizeMb = (fs.statSync(xbpsFilePath).size / (1024 * 1024)).toFixed(2)
  console.log(`\n========================================`)
  console.log(`Successfully created Void Linux XBPS package!`)
  console.log(`Package: ${xbpsFilePath}`)
  console.log(`Canonical: ${canonicalPath}`)
  console.log(`Size: ${sizeMb} MB`)
  console.log(`Installed size: ${(installedSize / (1024 * 1024)).toFixed(2)} MB`)
  console.log(`========================================\n`)

  fs.rmSync(tmpDir, { recursive: true, force: true })
} catch (err) {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.error('Fatal build error:', err)
  process.exit(1)
}
