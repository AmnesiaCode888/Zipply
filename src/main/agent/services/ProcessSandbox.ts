import { createHash } from 'crypto'
import { execFile, spawnSync } from 'child_process'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import type { SandboxBackend, SandboxPolicy } from '../../../shared/sandbox'

const execFileAsync = promisify(execFile)

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxUnavailableError'
  }
}

export interface PrepareSpawnRequest {
  shell: string
  args: string[] | string
  cwd: string
  workspaceRoot?: string
  env: Record<string, string>
  policy: SandboxPolicy
}

export interface PreparedSpawn {
  command: string
  args: string[]
  windowsCommandLine?: string
  cwd: string
  env: Record<string, string>
  sandboxed: boolean
  backend: SandboxBackend
  tempDir?: string
  cleanup?: () => Promise<void>
}

export interface ProcessSandboxOptions {
  platform?: NodeJS.Platform
  compilerPath?: string
  bwrapPath?: string
  sandboxExecPath?: string
  forceBackendUnavailable?: boolean
}

const WINDOWS_SANDBOX_HELPER_CS = String.raw`
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class ZipplySandboxRunner {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public int dwProcessId, dwThreadId;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct SID_AND_ATTRIBUTES {
    public IntPtr Sid;
    public uint Attributes;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct TOKEN_MANDATORY_LABEL {
    public SID_AND_ATTRIBUTES Label;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_UI_RESTRICTIONS {
    public uint UIRestrictionsClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr proc, uint access, out IntPtr token);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableCount, IntPtr disableSids, uint privCount, IntPtr delPrivs, uint restrictCount, IntPtr restrictSids, out IntPtr newToken);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertStringSidToSid(string strSid, out IntPtr sid);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr token, int infoClass, ref TOKEN_MANDATORY_LABEL info, uint len);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessAsUser(IntPtr token, string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateDesktop(string name, string dev, IntPtr devmode, uint flags, uint access, IntPtr sa);

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool CloseDesktop(IntPtr h);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetKernelObjectSecurity(IntPtr handle, uint secInfo, byte[] sd);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint rev, out IntPtr sd, out uint len);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd, uint rev, uint secInfo, out IntPtr strSd, out uint strLen);

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool saclPresent, out IntPtr sacl, out bool defaulted);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetNamedSecurityInfo(string name, int objType, uint secInfo, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr sd);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint SetNamedSecurityInfo(string name, int objType, uint secInfo, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr sa, string name);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint len);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);

  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool ResumeThread(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);

  static bool HasLowLabel(string path) {
    IntPtr o, g, d, sacl, sd;
    uint rc = GetNamedSecurityInfo(path, 1, 0x10 /* LABEL_SECURITY_INFORMATION */, out o, out g, out d, out sacl, out sd);
    if (rc != 0 || sd == IntPtr.Zero) return false;
    IntPtr strPtr = IntPtr.Zero;
    uint strLen = 0;
    try {
      if (!ConvertSecurityDescriptorToStringSecurityDescriptor(sd, 1, 0x10, out strPtr, out strLen) || strPtr == IntPtr.Zero) return false;
      string sddl = Marshal.PtrToStringUni(strPtr) ?? "";
      return sddl.IndexOf(";;;LW)", StringComparison.OrdinalIgnoreCase) >= 0;
    } finally {
      if (strPtr != IntPtr.Zero) LocalFree(strPtr);
      LocalFree(sd);
    }
  }

  static uint SetPathLabel(string target, string sddl) {
    IntPtr sd; uint len;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out sd, out len)) {
      return (uint)Marshal.GetLastWin32Error();
    }
    try {
      bool pres, def; IntPtr sacl;
      if (!GetSecurityDescriptorSacl(sd, out pres, out sacl, out def)) {
        return (uint)Marshal.GetLastWin32Error();
      }
      return SetNamedSecurityInfo(target, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
    } finally {
      LocalFree(sd);
    }
  }

  static void ApplyTreeLabel(string root, string levelSid, bool skipNodeModules) {
    if (string.IsNullOrEmpty(root) || (!Directory.Exists(root) && !File.Exists(root))) return;
    if (File.Exists(root)) {
      SetPathLabel(root, "S:(ML;;NW;;;" + levelSid + ")");
      return;
    }
    SetPathLabel(root, "S:(ML;;NW;;;" + levelSid + ")");
    string childSddl = "S:(ML;OICI;NW;;;" + levelSid + ")";
    try {
      foreach (string entry in Directory.EnumerateFileSystemEntries(root)) {
        string name = Path.GetFileName(entry);
        if (skipNodeModules && string.Equals(name, "node_modules", StringComparison.OrdinalIgnoreCase) && Directory.Exists(entry)) {
          continue;
        }
        SetPathLabel(entry, childSddl);
      }
    } catch { }
  }

  public static int Main(string[] args) {
    if (args.Length < 4) {
      Console.Error.WriteLine("ZipplySandboxRunner: invalid arguments");
      return 125;
    }

    string mode = args[0];
    if (mode == "restore") {
      string rootsRaw = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
      foreach (string r in rootsRaw.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries)) {
        if (Directory.Exists(r) && HasLowLabel(r)) ApplyTreeLabel(r, "ME", true);
      }
      return 0;
    }

    if (args.Length < 6) {
      Console.Error.WriteLine("ZipplySandboxRunner: missing run arguments");
      return 125;
    }

    string ws = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
    string writableRaw = Encoding.UTF8.GetString(Convert.FromBase64String(args[2]));
    string tmpDir = Encoding.UTF8.GetString(Convert.FromBase64String(args[3]));
    string cwd = Encoding.UTF8.GetString(Convert.FromBase64String(args[4]));
    string cmd = Encoding.UTF8.GetString(Convert.FromBase64String(args[5]));

    if (!string.IsNullOrEmpty(tmpDir) && Directory.Exists(tmpDir)) {
      SetPathLabel(tmpDir, "S:(ML;OICI;NW;;;LW)");
    }

    if (mode == "ro") {
      if (!string.IsNullOrEmpty(ws) && Directory.Exists(ws) && HasLowLabel(ws)) {
        ApplyTreeLabel(ws, "ME", true);
      }
    } else if (mode == "rw") {
      foreach (string r in writableRaw.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries)) {
        if ((Directory.Exists(r) || File.Exists(r)) && !HasLowLabel(r)) {
          ApplyTreeLabel(r, "LW", true);
        }
      }
    } else {
      Console.Error.WriteLine("ZipplySandboxRunner: unsupported mode " + mode);
      return 125;
    }

    IntPtr curTok = IntPtr.Zero, lowTok = IntPtr.Zero, lowSid = IntPtr.Zero, job = IntPtr.Zero, desk = IntPtr.Zero, sdPtr = IntPtr.Zero;
    try {
      if (!OpenProcessToken(GetCurrentProcess(), 0x02000000, out curTok)) return 125;
      if (!CreateRestrictedToken(curTok, 0x1 /* DISABLE_MAX_PRIVILEGE */, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out lowTok)) return 125;
      if (!ConvertStringSidToSid("S-1-16-4096", out lowSid)) return 125;
      var tml = new TOKEN_MANDATORY_LABEL { Label = new SID_AND_ATTRIBUTES { Sid = lowSid, Attributes = 0x20 /* SE_GROUP_INTEGRITY */ } };
      if (!SetTokenInformation(lowTok, 25 /* TokenIntegrityLevel */, ref tml, (uint)(Marshal.SizeOf(tml) + 32))) return 125;

      job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) return 125;
      var ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      ext.BasicLimitInformation.LimitFlags = 0x2000 /* JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE */;
      IntPtr extPtr = Marshal.AllocHGlobal(Marshal.SizeOf(ext));
      try {
        Marshal.StructureToPtr(ext, extPtr, false);
        SetInformationJobObject(job, 9, extPtr, (uint)Marshal.SizeOf(ext));
      } finally { Marshal.FreeHGlobal(extPtr); }

      var ui = new JOBOBJECT_BASIC_UI_RESTRICTIONS { UIRestrictionsClass = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 };
      IntPtr uiPtr = Marshal.AllocHGlobal(Marshal.SizeOf(ui));
      try {
        Marshal.StructureToPtr(ui, uiPtr, false);
        SetInformationJobObject(job, 4, uiPtr, (uint)Marshal.SizeOf(ui));
      } finally { Marshal.FreeHGlobal(uiPtr); }

      string deskName = "ZipplySbx_" + Guid.NewGuid().ToString("N").Substring(0, 8);
      desk = CreateDesktop(deskName, null, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero);
      if (desk == IntPtr.Zero) return 125;
      uint sdLen;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:(A;;GA;;;WD)S:(ML;;NW;;;LW)", 1, out sdPtr, out sdLen)) return 125;
      byte[] sdBytes = new byte[sdLen];
      Marshal.Copy(sdPtr, sdBytes, 0, (int)sdLen);
      if (!SetKernelObjectSecurity(desk, 0x4 | 0x10, sdBytes)) return 125;

      var si = new STARTUPINFO();
      si.cb = Marshal.SizeOf(si);
      si.lpDesktop = "WinSta0\\" + deskName;
      si.dwFlags = 0x00000100; // STARTF_USESTDHANDLES
      si.hStdInput = GetStdHandle(-10);
      si.hStdOutput = GetStdHandle(-11);
      si.hStdError = GetStdHandle(-12);

      PROCESS_INFORMATION pi;
      bool ok = CreateProcessAsUser(
        lowTok,
        null,
        cmd,
        IntPtr.Zero,
        IntPtr.Zero,
        true,
        0x08000000 /* CREATE_NO_WINDOW */ | 0x00000004 /* CREATE_SUSPENDED */,
        IntPtr.Zero,
        cwd,
        ref si,
        out pi
      );
      if (!ok) {
        Console.Error.WriteLine("ZipplySandboxRunner: CreateProcessAsUser error " + Marshal.GetLastWin32Error());
        return 125;
      }

      AssignProcessToJobObject(job, pi.hProcess);
      ResumeThread(pi.hThread);
      WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
      uint code = 0;
      GetExitCodeProcess(pi.hProcess, out code);
      CloseHandle(pi.hProcess);
      CloseHandle(pi.hThread);
      return (int)code;
    } finally {
      if (sdPtr != IntPtr.Zero) LocalFree(sdPtr);
      if (desk != IntPtr.Zero) CloseDesktop(desk);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (lowSid != IntPtr.Zero) LocalFree(lowSid);
      if (lowTok != IntPtr.Zero) CloseHandle(lowTok);
      if (curTok != IntPtr.Zero) CloseHandle(curTok);
    }
  }
}
`

const HELPER_HASH = createHash('sha256').update(WINDOWS_SANDBOX_HELPER_CS).digest('hex').slice(0, 16)
const activeWorkspaceWriteRefCounts = new Map<string, number>()

export function quoteWindowsCmdArg(arg: string): string {
  if (!arg.length) return '""'
  if (!/[\s"\t\\]/.test(arg)) return arg
  let out = '"'
  let backslashes = 0
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]
    if (ch === '\\') {
      backslashes++
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
    } else {
      if (backslashes > 0) {
        out += '\\'.repeat(backslashes)
        backslashes = 0
      }
      out += ch
    }
  }
  if (backslashes > 0) out += '\\'.repeat(backslashes * 2)
  out += '"'
  return out
}

function buildOfflineEnv(baseEnv: Record<string, string>, network: 'off' | 'on', tempDir?: string): Record<string, string> {
  const env: Record<string, string> = { ...baseEnv }
  if (tempDir) {
    env.TEMP = tempDir
    env.TMP = tempDir
    env.TMPDIR = tempDir
  }
  if (network === 'off') {
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'GIT_SSH', 'GIT_SSH_COMMAND']) {
      delete env[k]
    }
    env.npm_config_offline = 'true'
    env.PIP_NO_INDEX = '1'
    env.CARGO_NET_OFFLINE = 'true'
    env.GOPROXY = 'off'
    env.HF_HUB_OFFLINE = '1'
    env.TRANSFORMERS_OFFLINE = '1'
  }
  return env
}

function findCompilerWin32(override?: string): string | null {
  if (override) return fsSync.existsSync(override) ? override : null
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const candidates = [
    path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ]
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c
  }
  return null
}

function findExecutableOnPath(name: string, explicit?: string): string | null {
  if (explicit) return fsSync.existsSync(explicit) ? explicit : null
  const pathVal = process.env.PATH || ''
  for (const dir of pathVal.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    if (fsSync.existsSync(candidate)) return candidate
  }
  return null
}

function escapeSeatbeltString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export class ProcessSandbox {
  private readonly platform: NodeJS.Platform
  private readonly compilerPathOverride?: string
  private readonly bwrapPathOverride?: string
  private readonly sandboxExecPathOverride?: string
  private readonly forceBackendUnavailable: boolean
  private winHelperPromise: Promise<string> | null = null

  constructor(options: ProcessSandboxOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.compilerPathOverride = options.compilerPath
    this.bwrapPathOverride = options.bwrapPath
    this.sandboxExecPathOverride = options.sandboxExecPath
    this.forceBackendUnavailable = Boolean(
      options.forceBackendUnavailable || process.env.ZIPPLY_SANDBOX_DISABLE_BACKEND === '1'
    )
  }

  private async ensureWindowsHelper(): Promise<string> {
    if (this.forceBackendUnavailable) {
      throw new SandboxUnavailableError('Windows sandbox backend disabled in current environment.')
    }
    const dir = path.join(os.tmpdir(), 'zipply-sandbox')
    const exePath = path.join(dir, `zipply-sandbox-${HELPER_HASH}.exe`)
    if (fsSync.existsSync(exePath)) return exePath

    if (!this.winHelperPromise) {
      this.winHelperPromise = (async () => {
        if (fsSync.existsSync(exePath)) return exePath
        const csc = findCompilerWin32(this.compilerPathOverride)
        if (!csc) {
          throw new SandboxUnavailableError('Windows .NET compiler (csc.exe) unavailable; refusing to execute unsandboxed.')
        }
        await fs.mkdir(dir, { recursive: true })
        const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
        const csPath = path.join(dir, `zipply-sandbox-${HELPER_HASH}-${unique}.cs`)
        const tempExePath = path.join(dir, `zipply-sandbox-${HELPER_HASH}-${unique}.exe`)
        await fs.writeFile(csPath, WINDOWS_SANDBOX_HELPER_CS, 'utf8')
        try {
          await execFileAsync(csc, ['/nologo', '/platform:x64', `/out:${tempExePath}`, csPath], {
            windowsHide: true,
            timeout: 20000
          })
          try {
            await fs.rename(tempExePath, exePath)
          } catch (renameErr) {
            if (!fsSync.existsSync(exePath)) throw renameErr
            await fs.rm(tempExePath, { force: true }).catch(() => {})
          }
          return exePath
        } catch (err) {
          await fs.rm(tempExePath, { force: true }).catch(() => {})
          throw new SandboxUnavailableError(`Failed to initialize Windows sandbox helper: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          await fs.rm(csPath, { force: true }).catch(() => {})
        }
      })().finally(() => {
        this.winHelperPromise = null
      })
    }

    return this.winHelperPromise
  }

  async prepareSpawn(req: PrepareSpawnRequest): Promise<PreparedSpawn> {
    if (typeof req.args === 'string' && this.platform !== 'win32') {
      throw new Error('Командная строка Windows доступна только в Windows.')
    }
    if (req.policy.profile === 'unrestricted') {
      return {
        command: req.shell,
        args: typeof req.args === 'string' ? [] : req.args,
        ...(typeof req.args === 'string' ? { windowsCommandLine: req.args } : {}),
        cwd: req.cwd,
        env: buildOfflineEnv(req.env, req.policy.network),
        sandboxed: false,
        backend: 'none'
      }
    }

    if (this.forceBackendUnavailable) {
      throw new SandboxUnavailableError(`OS sandbox backend unavailable for profile '${req.policy.profile}'.`)
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-sbx-run-'))

    if (this.platform === 'win32') {
      let helperExe: string
      try {
        helperExe = await this.ensureWindowsHelper()
      } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        throw err
      }

      const mode = req.policy.profile === 'read-only' ? 'ro' : 'rw'
      const wsRoot = path.resolve(req.workspaceRoot || req.cwd)
      const writableRoots = mode === 'rw'
        ? Array.from(new Set(req.policy.writableRoots.map((r) => path.resolve(r))))
        : []

      if (mode === 'rw') {
        for (const root of writableRoots) {
          const key = root.toLowerCase()
          activeWorkspaceWriteRefCounts.set(key, (activeWorkspaceWriteRefCounts.get(key) ?? 0) + 1)
        }
      }

      const cmdLine = typeof req.args === 'string'
        ? `${quoteWindowsCmdArg(req.shell)} ${req.args}`
        : [req.shell, ...req.args].map(quoteWindowsCmdArg).join(' ')
      const b64 = (v: string): string => Buffer.from(v, 'utf8').toString('base64')
      const helperArgs = [
        mode,
        b64(wsRoot),
        b64(writableRoots.join('\n')),
        b64(tempDir),
        b64(path.resolve(req.cwd)),
        b64(cmdLine)
      ]

      return {
        command: helperExe,
        args: helperArgs,
        cwd: req.cwd,
        env: buildOfflineEnv(req.env, req.policy.network, tempDir),
        sandboxed: true,
        backend: 'windows-restricted',
        tempDir,
        cleanup: async () => {
          if (mode === 'rw') {
            const rootsToRestore: string[] = []
            for (const root of writableRoots) {
              const key = root.toLowerCase()
              const next = (activeWorkspaceWriteRefCounts.get(key) ?? 1) - 1
              if (next <= 0) {
                activeWorkspaceWriteRefCounts.delete(key)
                if (fsSync.existsSync(root)) rootsToRestore.push(root)
              } else {
                activeWorkspaceWriteRefCounts.set(key, next)
              }
            }
            if (rootsToRestore.length > 0 && fsSync.existsSync(helperExe)) {
              await execFileAsync(helperExe, ['restore', b64(rootsToRestore.join('\n'))], {
                windowsHide: true,
                timeout: 10000
              }).catch(() => {})
            }
          }
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }

    if (this.platform === 'linux') {
      const bwrap = findExecutableOnPath('bwrap', this.bwrapPathOverride)
      if (!bwrap) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        throw new SandboxUnavailableError('Linux sandbox (bwrap) unavailable; refusing to execute unsandboxed.')
      }
      const args: string[] = [
        '--die-with-parent',
        '--new-session',
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--bind', tempDir, '/tmp',
        '--chdir', req.cwd
      ]
      if (req.policy.network === 'off') {
        args.push('--unshare-net')
      }
      if (req.policy.profile === 'workspace-write') {
        for (const root of req.policy.writableRoots) {
          const resolved = path.resolve(root)
          if (fsSync.existsSync(resolved)) {
            args.push('--bind', resolved, resolved)
          }
        }
      }
      args.push('--', req.shell, ...req.args)
      return {
        command: bwrap,
        args,
        cwd: req.cwd,
        env: buildOfflineEnv(req.env, req.policy.network, '/tmp'),
        sandboxed: true,
        backend: 'linux-bwrap',
        tempDir,
        cleanup: async () => {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }

    if (this.platform === 'darwin') {
      const sandboxExec = this.sandboxExecPathOverride ?? (fsSync.existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : null)
      if (!sandboxExec || !fsSync.existsSync(sandboxExec)) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        throw new SandboxUnavailableError('macOS sandbox-exec unavailable; refusing to execute unsandboxed.')
      }
      const allowRoots = [tempDir, ...(req.policy.profile === 'workspace-write' ? req.policy.writableRoots : [])]
      const writeRules = allowRoots
        .map((r) => `(allow file-write* (subpath "${escapeSeatbeltString(path.resolve(r))}"))`)
        .join('\n')
      const profile = [
        '(version 1)',
        '(deny default)',
        '(allow process*)',
        '(allow sysctl-read)',
        '(allow mach-lookup)',
        '(allow file-read*)',
        '(allow file-write* (literal "/dev/null") (literal "/dev/zero"))',
        writeRules,
        req.policy.network === 'on' ? '(allow network*)' : '(deny network*)'
      ].join('\n')

      return {
        command: sandboxExec,
        args: ['-p', profile, req.shell, ...req.args],
        cwd: req.cwd,
        env: buildOfflineEnv(req.env, req.policy.network, tempDir),
        sandboxed: true,
        backend: 'macos-seatbelt',
        tempDir,
        cleanup: async () => {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
        }
      }
    }

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw new SandboxUnavailableError(`No OS sandbox backend supported on platform '${this.platform}'.`)
  }
}

export const processSandbox = new ProcessSandbox()

export function ensureSandboxPrewarmed(): void {
  if (process.platform === 'win32') {
    // Trigger synchronous check/background compile on startup? Keep lazy + cached; explicit check via spawnSync not needed.
  }
}

export { spawnSync }
