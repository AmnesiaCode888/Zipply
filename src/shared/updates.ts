export type UpdateStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'

export interface UpdateState {
  currentVersion: string
  status: UpdateStatus
  latestVersion: string | null
  releaseName: string | null
  releaseUrl: string
  publishedAt: string | null
  checkedAt: number | null
  error: string | null
}

export const ZIPPLY_DOWNLOAD_URL = 'https://zipply.my'
export const ZIPPLY_RELEASES_API_URL = 'https://api.github.com/repos/AmnesiaCode888/Zipply/releases/latest'

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = raw.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(cleaned)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? '0'),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

export function normalizeVersion(raw: string): string {
  const parsed = parseSemver(raw)
  if (!parsed) return raw.trim().replace(/^v/i, '')
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return parsed.prerelease.length > 0 ? `${base}-${parsed.prerelease.join('.')}` : base
}

/**
 * Compares two SemVer strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return normalizeVersion(a).localeCompare(normalizeVersion(b))

  for (const [va, vb] of [[pa.major, pb.major], [pa.minor, pb.minor], [pa.patch, pb.patch]]) {
    if (va !== vb) return va > vb ? 1 : -1
  }

  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1

  const len = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < len; i++) {
    const segA = pa.prerelease[i]
    const segB = pb.prerelease[i]
    if (segA === undefined) return -1
    if (segB === undefined) return 1
    if (segA === segB) continue
    const numA = /^\d+$/.test(segA) ? Number(segA) : null
    const numB = /^\d+$/.test(segB) ? Number(segB) : null
    if (numA !== null && numB !== null) return numA > numB ? 1 : -1
    if (numA !== null) return -1
    if (numB !== null) return 1
    return segA > segB ? 1 : -1
  }
  return 0
}

export function isUpdateAvailable(currentVersion: string, latestVersion: string): boolean {
  const parsedLatest = parseSemver(latestVersion)
  if (!parsedLatest || parsedLatest.prerelease.length > 0) return false
  return compareVersions(latestVersion, currentVersion) > 0
}
