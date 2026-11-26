/** Presentation metadata must not change execution identity. */
export function executionArgumentKey(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
    const { activity: _activity, ...args } = parsed as Record<string, unknown>
    return JSON.stringify(args)
  } catch { return raw }
}
