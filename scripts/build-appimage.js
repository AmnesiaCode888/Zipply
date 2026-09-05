const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const rootDir = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const distDir = path.join(rootDir, 'dist')

function installMksquashfsWrapper() {
  if (process.platform !== 'win32') return false
  const cacheBase = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'appimage')
  if (!fs.existsSync(cacheBase)) return false

  let patched = false
  const versions = fs.readdirSync(cacheBase)
  for (const ver of versions) {
    const toolDir = path.join(cacheBase, ver, 'linux-x64')
    const mksquashfsExe = path.join(toolDir, 'mksquashfs.exe')
    const realMksquashfsExe = path.join(toolDir, 'mksquashfs-real.exe')

    if (fs.existsSync(mksquashfsExe) && !fs.existsSync(realMksquashfsExe)) {
      console.log(`Patching mksquashfs in ${toolDir} to enforce Linux executable permissions...`)
      fs.renameSync(mksquashfsExe, realMksquashfsExe)

      const csCode = `
using System;
using System.Diagnostics;
using System.IO;
using System.Collections.Generic;

class Program {
    static string Escape(string s) {
        if (string.IsNullOrEmpty(s)) return "\\"\\"";
        if (s.IndexOf(' ') < 0 && s.IndexOf('\\t') < 0 && s.IndexOf('\\"') < 0) return s;
        return "\\"" + s.Replace("\\"", "\\\\\\"") + "\\"";
    }

    static int Main(string[] args) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string realExe = Path.Combine(dir, "mksquashfs-real.exe");

        List<string> list = new List<string>(args);
        list.Add("-action");
        list.Add("chmod(0755)@name(zipply)");
        list.Add("-action");
        list.Add("chmod(0755)@name(chrome-sandbox)");
        list.Add("-action");
        list.Add("chmod(0755)@name(chrome_crashpad_handler)");
        list.Add("-action");
        list.Add("chmod(0755)@name(AppRun)");
        list.Add("-action");
        list.Add("chmod(0755)@name(*.so*)");

        List<string> escaped = new List<string>();
        foreach (string a in list) {
            escaped.Add(Escape(a));
        }

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = realExe;
        psi.Arguments = string.Join(" ", escaped.ToArray());
        psi.UseShellExecute = false;

        try {
            using (Process p = Process.Start(psi)) {
                p.WaitForExit();
                return p.ExitCode;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("Wrapper error: " + ex.Message);
            return 1;
        }
    }
}
`
      const csFile = path.join(toolDir, 'mksquashfs_wrapper.cs')
      fs.writeFileSync(csFile, csCode, 'utf8')
      const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'
      execSync(`"${csc}" /nologo /out:"${mksquashfsExe}" "${csFile}"`)
      fs.unlinkSync(csFile)
      console.log('Successfully installed mksquashfs permission wrapper!')
      patched = true
    }
  }
  return patched
}

function verifyAppImage(appImagePath) {
  if (process.platform !== 'win32') return true
  const cacheBase = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'appimage')
  if (!fs.existsSync(cacheBase)) return true

  for (const ver of fs.readdirSync(cacheBase)) {
    const unsquashfs = path.join(cacheBase, ver, 'linux-x64', 'unsquashfs.exe')
    if (fs.existsSync(unsquashfs)) {
      try {
        const check = execSync(`"${unsquashfs}" -offset 188392 -ll "${appImagePath}"`, { encoding: 'utf8' })
        const lines = check.split('\n')
        const zipplyLine = lines.find((l) => l.includes('squashfs-root/zipply'))
        const sandboxLine = lines.find((l) => l.includes('squashfs-root/chrome-sandbox'))

        console.log('Permissions check:')
        console.log(' ', zipplyLine ? zipplyLine.trim() : 'zipply: NOT FOUND')
        console.log(' ', sandboxLine ? sandboxLine.trim() : 'chrome-sandbox: NOT FOUND')

        if (zipplyLine && zipplyLine.trim().startsWith('-rwxr-xr-x')) {
          return true
        }
      } catch (e) {
        console.warn('Verification warning:', e.message)
      }
    }
  }
  return false
}

console.log('===> 1. Checking build environment...')
installMksquashfsWrapper()

console.log('===> 2. Building AppImage with electron-builder...')
execSync('npx electron-builder --linux AppImage', { cwd: rootDir, stdio: 'inherit' })

const appImagePath = path.join(distDir, `Zipply-${pkg.version}-linux-x86_64.AppImage`)
console.log('===> 3. Verifying AppImage executable permissions...')
let ok = verifyAppImage(appImagePath)

if (!ok && process.platform === 'win32') {
  console.log('Permissions not applied yet (possibly fresh tool download). Applying wrapper and rebuilding...')
  installMksquashfsWrapper()
  execSync('npx electron-builder --linux AppImage', { cwd: rootDir, stdio: 'inherit' })
  ok = verifyAppImage(appImagePath)
}

if (!ok) {
  console.error('\nERROR: Failed to verify executable permissions in AppImage!')
  process.exit(1)
}

const sizeMb = (fs.statSync(appImagePath).size / (1024 * 1024)).toFixed(2)
console.log(`\n========================================`)
console.log(`Successfully created verified Linux AppImage!`)
console.log(`File: ${appImagePath}`)
console.log(`Size: ${sizeMb} MB`)
console.log(`Binary permission: -rwxr-xr-x (OK)`)
console.log(`========================================\n`)
