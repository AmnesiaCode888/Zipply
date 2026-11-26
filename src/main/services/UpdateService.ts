import { EventEmitter } from 'events'
import {
  isUpdateAvailable,
  normalizeVersion,
  type UpdateState,
  ZIPPLY_DOWNLOAD_URL,
  ZIPPLY_RELEASES_API_URL
} from '../../shared/updates'

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const DEFAULT_INITIAL_DELAY_MS = 5000
const REQUEST_TIMEOUT_MS = 10_000

interface GitHubLatestRelease {
  tag_name?: string
  name?: string
  published_at?: string
  prerelease?: boolean
  draft?: boolean
}

export interface UpdateServiceDeps {
  currentVersion: string
  isPackaged: boolean
  openExternal: (url: string) => Promise<void>
  fetchFn?: typeof fetch
  releasesApiUrl?: string
  downloadUrl?: string
  checkIntervalMs?: number
  initialDelayMs?: number
}

export class UpdateService extends EventEmitter {
  private state: UpdateState
  private etag: string | null = null
  private cachedRelease: { version: string; name: string | null; publishedAt: string | null } | null = null
  private inflight: Promise<UpdateState> | null = null
  private initialTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private readonly fetchFn: typeof fetch
  private readonly releasesApiUrl: string
  private readonly downloadUrl: string
  private readonly checkIntervalMs: number
  private readonly initialDelayMs: number

  constructor(private readonly deps: UpdateServiceDeps) {
    super()
    this.fetchFn = deps.fetchFn ?? fetch
    this.releasesApiUrl = deps.releasesApiUrl ?? ZIPPLY_RELEASES_API_URL
    this.downloadUrl = deps.downloadUrl ?? ZIPPLY_DOWNLOAD_URL
    this.checkIntervalMs = deps.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.initialDelayMs = deps.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
    this.state = {
      currentVersion: normalizeVersion(deps.currentVersion),
      status: 'idle',
      latestVersion: null,
      releaseName: null,
      releaseUrl: this.downloadUrl,
      publishedAt: null,
      checkedAt: null,
      error: null
    }
  }

  public getState(): UpdateState {
    return { ...this.state }
  }

  public start(): void {
    if (!this.deps.isPackaged || this.initialTimer || this.intervalTimer) return
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null
      void this.checkForUpdates()
    }, this.initialDelayMs)
    this.initialTimer.unref?.()

    this.intervalTimer = setInterval(() => {
      void this.checkForUpdates()
    }, this.checkIntervalMs)
    this.intervalTimer.unref?.()
  }

  public dispose(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer)
      this.initialTimer = null
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
  }

  public async openDownloadPage(): Promise<void> {
    const parsed = new URL(this.downloadUrl)
    if (parsed.protocol !== 'https:') {
      throw new Error('Недопустимый протокол ссылки обновления.')
    }
    await this.deps.openExternal(parsed.toString())
  }

  public async checkForUpdates(options: { manual?: boolean } = {}): Promise<UpdateState> {
    if (this.inflight) return this.inflight
    const run = this.performCheck(options.manual === true).finally(() => {
      this.inflight = null
    })
    this.inflight = run
    return run
  }

  private async performCheck(manual: boolean): Promise<UpdateState> {
    this.setState({ ...this.state, status: 'checking', error: null })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Zipply/${this.state.currentVersion}`
      }
      if (this.etag) headers['If-None-Match'] = this.etag

      const response = await this.fetchFn(this.releasesApiUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      })

      if (response.status === 304 && this.cachedRelease) {
        return this.applyRelease(this.cachedRelease)
      }

      // GitHub returns 404 when a repo has no non-prerelease releases yet.
      if (response.status === 404) {
        this.cachedRelease = null
        return this.setState({
          ...this.state,
          status: 'up-to-date',
          latestVersion: this.state.currentVersion,
          releaseName: null,
          publishedAt: null,
          checkedAt: Date.now(),
          error: null
        })
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const nextEtag = response.headers.get('etag')
      if (nextEtag) this.etag = nextEtag

      const payload = (await response.json()) as GitHubLatestRelease
      if (payload.draft || payload.prerelease || !payload.tag_name) {
        this.cachedRelease = null
        return this.setState({
          ...this.state,
          status: 'up-to-date',
          latestVersion: this.state.currentVersion,
          releaseName: null,
          publishedAt: null,
          checkedAt: Date.now(),
          error: null
        })
      }

      const release = {
        version: normalizeVersion(payload.tag_name),
        name: payload.name?.trim() || null,
        publishedAt: payload.published_at || null
      }
      this.cachedRelease = release
      return this.applyRelease(release)
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? 'Таймаут проверки обновлений.'
        : 'Не удалось проверить обновления.'
      // Preserve an already discovered available update on background failures.
      if (!manual && this.state.latestVersion && isUpdateAvailable(this.state.currentVersion, this.state.latestVersion)) {
        return this.setState({
          ...this.state,
          status: 'available',
          checkedAt: Date.now()
        })
      }
      return this.setState({
        ...this.state,
        status: 'error',
        checkedAt: Date.now(),
        error: message
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private applyRelease(release: { version: string; name: string | null; publishedAt: string | null }): UpdateState {
    const available = isUpdateAvailable(this.state.currentVersion, release.version)
    return this.setState({
      ...this.state,
      status: available ? 'available' : 'up-to-date',
      latestVersion: release.version,
      releaseName: release.name,
      releaseUrl: this.downloadUrl,
      publishedAt: release.publishedAt,
      checkedAt: Date.now(),
      error: null
    })
  }

  private setState(next: UpdateState): UpdateState {
    this.state = next
    this.emit('state-changed', this.getState())
    return this.getState()
  }
}
