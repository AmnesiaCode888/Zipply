// The shell joins a Windows job before executing user code. When the shell
// exits, closing its last job handle terminates all descendants, including
// children that start while taskkill is enumerating the process tree.
export function windowsJobCommand(command: string): string {
  return String.raw`
try {
Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ZipplyProcessJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Attach() {
    var job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    var limits = new ExtendedLimits();
    limits.BasicLimitInformation.LimitFlags = 0x00002000;
    if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) || !AssignProcessToJobObject(job, GetCurrentProcess())) {
      int error = Marshal.GetLastWin32Error(); CloseHandle(job); throw new Win32Exception(error);
    }
    return job;
  }
}
'@
$zipplyProcessJob = [ZipplyProcessJob]::Attach()
} catch {
  Write-Error "Не удалось подготовить управление деревом процессов: $_"
  exit 1
}
$zipplyProcessExit = 0
& {
${command}
  $global:zipplyCommandSucceeded = $?
  $global:zipplyNativeExit = $LASTEXITCODE
}
if (-not $global:zipplyCommandSucceeded) {
  if ($null -ne $global:zipplyNativeExit -and $global:zipplyNativeExit -ne 0) { $zipplyProcessExit = $global:zipplyNativeExit } else { $zipplyProcessExit = 1 }
}
exit $zipplyProcessExit
`
}
