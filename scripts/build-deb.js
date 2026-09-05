const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { PassThrough } = require('stream')
const { execSync } = require('child_process')
const os = require('os')

const rootDir = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const distDir = path.join(rootDir, 'dist')
const linuxUnpacked = path.join(distDir, 'linux-unpacked')
const buildDir = path.join(rootDir, 'build')
const iconsDir = path.join(buildDir, 'icons')

console.log('Packaging Linux directory with electron-builder...')
execSync('npx electron-builder --linux dir', { cwd: rootDir, stdio: 'inherit' })

// Use OS temp dir to avoid path encoding issues
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-deb-'))

try {
  const debianBinary = Buffer.from('2.0\n')

  // 1. Prepare Data Directory
  const dataDir = path.join(tmpDir, 'data')
  const optAppDir = path.join(dataDir, 'opt', 'zipply')
  const usrBinDir = path.join(dataDir, 'usr', 'bin')
  const usrAppsDir = path.join(dataDir, 'usr', 'share', 'applications')
  const usrPixmapsDir = path.join(dataDir, 'usr', 'share', 'pixmaps')

  fs.mkdirSync(optAppDir, { recursive: true })
  fs.mkdirSync(usrBinDir, { recursive: true })
  fs.mkdirSync(usrAppsDir, { recursive: true })
  fs.mkdirSync(usrPixmapsDir, { recursive: true })

  console.log('Copying application files...')
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
    const sizeDir = path.join(dataDir, 'usr', 'share', 'icons', 'hicolor', `${s}x${s}`, 'apps')
    fs.mkdirSync(sizeDir, { recursive: true })
    const iconSrc = path.join(iconsDir, `${s}x${s}.png`)
    if (fs.existsSync(iconSrc)) {
      fs.copyFileSync(iconSrc, path.join(sizeDir, 'zipply.png'))
    }
  }
  if (fs.existsSync(path.join(iconsDir, '512x512.png'))) {
    fs.copyFileSync(path.join(iconsDir, '512x512.png'), path.join(usrPixmapsDir, 'zipply.png'))
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
  fs.writeFileSync(path.join(usrAppsDir, 'zipply.desktop'), desktopContent.replace(/\r\n/g, '\n'), 'utf8')

  // Create symlink/wrapper script in /usr/bin
  const binWrapper = `#!/bin/sh
exec /opt/zipply/zipply "$@"
`
  fs.writeFileSync(path.join(usrBinDir, 'zipply'), binWrapper.replace(/\r\n/g, '\n'), { encoding: 'utf8', mode: 0o755 })

  // Calculate installed size in KB
  function getDirSize(dir) {
    let size = 0
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, item.name)
      if (item.isDirectory()) {
        size += getDirSize(p)
      } else {
        size += fs.statSync(p).size
      }
    }
    return size
  }
  const installedSizeKb = Math.ceil(getDirSize(dataDir) / 1024)

  // 2. Prepare Control Directory
  const controlDir = path.join(tmpDir, 'control')
  fs.mkdirSync(controlDir, { recursive: true })

  const maintainer = pkg.author || 'Zipply Team <support@zipply.app>'
  const controlContent = `Package: zipply
Version: ${pkg.version}
Section: devel
Priority: optional
Architecture: amd64
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libasound2, libxtst6, libsecret-1-0, xdg-utils
Recommends: libappindicator3-1
Installed-Size: ${installedSizeKb}
Maintainer: ${maintainer}
Description: Zipply AI Coding Assistant
 Zipply - Electron React Vite Application
`
  fs.writeFileSync(path.join(controlDir, 'control'), controlContent.replace(/\r\n/g, '\n'), 'utf8')

  const postinstContent = `#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  update-desktop-database -q || true
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
  chmod 4755 /opt/zipply/chrome-sandbox 2>/dev/null || true
  chmod 755 /opt/zipply/zipply 2>/dev/null || true
  chmod 755 /usr/bin/zipply 2>/dev/null || true
fi
`
  fs.writeFileSync(path.join(controlDir, 'postinst'), postinstContent.replace(/\r\n/g, '\n'), { encoding: 'utf8', mode: 0o755 })

  const postrmContent = `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  update-desktop-database -q || true
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
`
  fs.writeFileSync(path.join(controlDir, 'postrm'), postrmContent.replace(/\r\n/g, '\n'), { encoding: 'utf8', mode: 0o755 })

  // TAR Header generation (ustar)
  function createTarHeader(name, size, mode, typeflag = '0', linkname = '') {
    const buf = Buffer.alloc(512, 0)
    let tarName = name.replace(/\\/g, '/')
    if (typeflag === '5' && !tarName.endsWith('/')) {
      tarName += '/'
    }
    buf.write(tarName.slice(0, 100), 0, 100, 'utf8')
    const modeStr = (mode & 0o7777).toString(8).padStart(6, '0') + ' \0'
    buf.write(modeStr, 100, 8, 'ascii')
    buf.write('0000000\0', 108, 8, 'ascii')
    buf.write('0000000\0', 116, 8, 'ascii')
    const sizeStr = (typeflag === '5' || typeflag === '2' ? 0 : size).toString(8).padStart(11, '0') + '\0'
    buf.write(sizeStr, 124, 12, 'ascii')
    const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0'
    buf.write(mtime, 136, 12, 'ascii')
    buf.fill(32, 148, 156) // Checksum spaces
    buf.write(typeflag, 156, 1, 'ascii')
    if (linkname) {
      buf.write(linkname.slice(0, 100), 157, 100, 'utf8')
    }
    buf.write('ustar\0', 257, 6, 'ascii')
    buf.write('00', 263, 2, 'ascii')
    buf.write('root\0', 265, 32, 'ascii')
    buf.write('root\0', 297, 32, 'ascii')

    let sum = 0
    for (let i = 0; i < 512; i++) {
      sum += buf[i]
    }
    const chkStr = sum.toString(8).padStart(6, '0') + '\0 '
    buf.write(chkStr, 148, 8, 'ascii')
    return buf
  }

  function writeDirToTarStream(baseDir, tarStream, prefix = '.') {
    function walk(currentDir, currentPrefix) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        const relPath = `${currentPrefix}/${entry.name}`.replace(/\\/g, '/')
        
        if (entry.isDirectory()) {
          tarStream.write(createTarHeader(relPath, 0, 0o755, '5'))
          walk(fullPath, relPath)
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath)
          const isExec = (stat.mode & 0o111) !== 0 || entry.name === 'zipply' || entry.name === 'chrome-sandbox' || entry.name.endsWith('.so') || entry.name.includes('.so.') || entry.name === 'postinst' || entry.name === 'postrm'
          const mode = isExec ? 0o755 : 0o644
          
          tarStream.write(createTarHeader(relPath, stat.size, mode, '0'))
          
          const data = fs.readFileSync(fullPath)
          tarStream.write(data)
          
          const padding = (512 - (stat.size % 512)) % 512
          if (padding > 0) {
            tarStream.write(Buffer.alloc(padding, 0))
          }
        }
      }
    }
    walk(baseDir, prefix)
    tarStream.write(Buffer.alloc(1024, 0))
  }

  async function createTarGz(sourceDir, destFile, prefix = '.') {
    return new Promise((resolve, reject) => {
      const gzip = zlib.createGzip({ level: 9 })
      const out = fs.createWriteStream(destFile)
      const stream = new PassThrough()
      
      stream.pipe(gzip).pipe(out)
      
      out.on('finish', resolve)
      out.on('error', reject)
      gzip.on('error', reject)
      stream.on('error', reject)
      
      writeDirToTarStream(sourceDir, stream, prefix)
      stream.end()
    })
  }

  async function build() {
    console.log('Archiving control and data files...')
    const controlTarGz = path.join(tmpDir, 'control.tar.gz')
    const dataTarGz = path.join(tmpDir, 'data.tar.gz')

    await createTarGz(controlDir, controlTarGz, '.')
    await createTarGz(dataDir, dataTarGz, '.')

    function createArHeader(name, size, mode = '100644') {
      const header = Buffer.alloc(60, ' ')
      const nameId = name.endsWith('/') ? name : name + '/'
      header.write(nameId.padEnd(16, ' '), 0, 16, 'ascii')
      const mtime = Math.floor(Date.now() / 1000).toString()
      header.write(mtime.padEnd(12, ' '), 16, 12, 'ascii')
      header.write('0'.padEnd(6, ' '), 28, 6, 'ascii')
      header.write('0'.padEnd(6, ' '), 34, 6, 'ascii')
      header.write(mode.padEnd(8, ' '), 40, 8, 'ascii')
      header.write(size.toString().padEnd(10, ' '), 48, 10, 'ascii')
      header.write('`\n', 58, 2, 'ascii')
      return header
    }

    const debFileName = `zipply-${pkg.version}-linux-amd64.deb`
    const debFilePath = path.join(distDir, debFileName)
    const outStream = fs.createWriteStream(debFilePath)

    outStream.write(Buffer.from('!<arch>\n'))

    // 1) debian-binary
    outStream.write(createArHeader('debian-binary', debianBinary.length))
    outStream.write(debianBinary)
    if (debianBinary.length % 2 !== 0) outStream.write(Buffer.from('\n'))

    // 2) control.tar.gz
    const controlBuf = fs.readFileSync(controlTarGz)
    outStream.write(createArHeader('control.tar.gz', controlBuf.length))
    outStream.write(controlBuf)
    if (controlBuf.length % 2 !== 0) outStream.write(Buffer.from('\n'))

    // 3) data.tar.gz
    const dataBuf = fs.readFileSync(dataTarGz)
    outStream.write(createArHeader('data.tar.gz', dataBuf.length))
    outStream.write(dataBuf)
    if (dataBuf.length % 2 !== 0) outStream.write(Buffer.from('\n'))

    outStream.end(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      console.log(`\nSuccessfully created Debian package: ${debFilePath}`)
      console.log(`File size: ${(fs.statSync(debFilePath).size / (1024 * 1024)).toFixed(2)} MB`)
    })
  }

  build().catch((err) => {
    console.error('Build error:', err)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    process.exit(1)
  })
} catch (e) {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.error('Fatal error:', e)
  process.exit(1)
}
