export function mergeSettingsDraft<T extends object>(saved: T, changes: Partial<T>): T {
  return { ...saved, ...changes }
}

export function createSettingsAutosave<T>(save: (draft: T) => boolean, onResult: (ok: boolean, draft: T) => void, delay = 500) {
  let pending: T | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (): boolean => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (pending === undefined) return true
    const draft = pending
    const ok = save(draft)
    if (ok) pending = undefined
    onResult(ok, draft)
    return ok
  }
  return {
    update(draft: T) {
      pending = draft
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delay)
    },
    flush,
    dispose() { if (timer) clearTimeout(timer); timer = undefined }
  }
}
