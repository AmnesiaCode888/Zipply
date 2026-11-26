import { useCallback, useEffect, useState } from 'react'
import { ZIPPLY_DOWNLOAD_URL, type UpdateState } from '../../../shared/updates'

const INITIAL_UPDATE_STATE: UpdateState = {
  currentVersion: '0.1.0',
  status: 'idle',
  latestVersion: null,
  releaseName: null,
  releaseUrl: ZIPPLY_DOWNLOAD_URL,
  publishedAt: null,
  checkedAt: null,
  error: null
}

export function useUpdates() {
  const [updateState, setUpdateState] = useState<UpdateState>(INITIAL_UPDATE_STATE)

  useEffect(() => {
    const bridge = window.api?.updates
    if (!bridge) return
    let active = true
    void bridge.getState().then(state => {
      if (active) setUpdateState(state)
    }).catch(() => {})
    const unsubscribe = bridge.onStateChanged(state => {
      if (active) setUpdateState(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const checkUpdates = useCallback(async () => {
    const bridge = window.api?.updates
    if (!bridge) return updateState
    const next = await bridge.check()
    setUpdateState(next)
    return next
  }, [updateState])

  const openDownload = useCallback(async () => {
    const bridge = window.api?.updates
    if (bridge) {
      await bridge.openDownload()
    } else {
      window.open(ZIPPLY_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')
    }
  }, [])

  return {
    updateState,
    checkUpdates,
    openDownload
  }
}
