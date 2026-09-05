import { ChatSession, AttachedImage } from '../types/chat'

const DB_NAME = 'zipply_db'
const DB_VERSION = 1
const SESSIONS_STORE = 'chat_sessions'
const IMAGES_STORE = 'attached_images'

let dbPromise: Promise<IDBDatabase> | null = null

export function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      console.error('[IndexedDB] Failed to open database:', request.error)
      reject(request.error)
    }
  })

  return dbPromise
}

async function loadLegacyDbSessions(): Promise<any[]> {
  if (typeof window === 'undefined' || !window.indexedDB) return []
  const legacyDbNames = ['zipple_db', 'clickcoder_db', 'clickcode_db', 'click_db']

  for (const dbName of legacyDbNames) {
    const sessions = await new Promise<any[]>((resolve) => {
      try {
        const req = window.indexedDB.open(dbName, 1)
        req.onsuccess = () => {
          const legacyDb = req.result
          if (!legacyDb.objectStoreNames.contains(SESSIONS_STORE)) {
            legacyDb.close()
            return resolve([])
          }
          const tx = legacyDb.transaction([SESSIONS_STORE], 'readonly')
          const store = tx.objectStore(SESSIONS_STORE)
          const getReq = store.getAll()
          getReq.onsuccess = () => {
            legacyDb.close()
            resolve(getReq.result || [])
          }
          getReq.onerror = () => {
            legacyDb.close()
            resolve([])
          }
        }
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })

    if (sessions && sessions.length > 0) {
      return sessions
    }
  }
  return []
}

/**
 * Save all chat sessions to IndexedDB (no 5MB quota limit).
 */
export async function dbSaveSessions(sessions: ChatSession[]): Promise<void> {
  try {
    const db = await getDb()
    const tx = db.transaction([SESSIONS_STORE, IMAGES_STORE], 'readwrite')
    const sessionsStore = tx.objectStore(SESSIONS_STORE)
    const imagesStore = tx.objectStore(IMAGES_STORE)

    // Clear and re-populate sessions store with latest list
    const clearReq = sessionsStore.clear()
    await new Promise<void>((resolve, reject) => {
      clearReq.onsuccess = () => resolve()
      clearReq.onerror = () => reject(clearReq.error)
    })

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]
      sessionsStore.put({ ...session, _orderIndex: i })

      if (session.messages) {
        for (const msg of session.messages) {
          if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
              if (img && img.id && img.dataUrl) {
                imagesStore.put(img)
              }
            }
          }
        }
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.error('[IndexedDB] Failed to save sessions:', err)
  }
}

/**
 * Load all chat sessions from IndexedDB.
 */
export async function dbLoadSessions(): Promise<ChatSession[] | null> {
  try {
    const db = await getDb()
    const tx = db.transaction([SESSIONS_STORE, IMAGES_STORE], 'readonly')
    const sessionsStore = tx.objectStore(SESSIONS_STORE)
    const imagesStore = tx.objectStore(IMAGES_STORE)

    const getAllReq = sessionsStore.getAll()

    let rawSessions = await new Promise<any[]>((resolve, reject) => {
      getAllReq.onsuccess = () => resolve(getAllReq.result || [])
      getAllReq.onerror = () => reject(getAllReq.error)
    })

    let isFromLegacy = false
    if (!rawSessions || rawSessions.length === 0) {
      const legacySessions = await loadLegacyDbSessions()
      if (legacySessions && legacySessions.length > 0) {
        rawSessions = legacySessions
        isFromLegacy = true
      } else {
        return null
      }
    }

    // Sort by original order index
    rawSessions.sort((a, b) => (a._orderIndex ?? 0) - (b._orderIndex ?? 0))

    // Restore any missing image dataUrls from imagesStore
    const imagesMap = new Map<string, string>()
    const allImagesReq = imagesStore.getAll()
    const storedImages = await new Promise<AttachedImage[]>((resolve) => {
      allImagesReq.onsuccess = () => resolve(allImagesReq.result || [])
      allImagesReq.onerror = () => resolve([])
    })

    for (const img of storedImages) {
      if (img && img.id && img.dataUrl) {
        imagesMap.set(img.id, img.dataUrl)
      }
    }

    const sessions: ChatSession[] = rawSessions.map((s) => {
      const { _orderIndex, ...cleanSession } = s
      return {
        ...cleanSession,
        messages: cleanSession.messages.map((m: any) => {
          if (m.images && m.images.length > 0) {
            return {
              ...m,
              images: m.images.map((img: AttachedImage) => ({
                ...img,
                dataUrl: img.dataUrl || imagesMap.get(img.id) || ''
              }))
            }
          }
          return m
        })
      }
    })

    if (isFromLegacy && sessions.length > 0) {
      dbSaveSessions(sessions).catch((err) => {
        console.warn('[IndexedDB] Failed to persist migrated legacy sessions:', err)
      })
    }

    return sessions
  } catch (err) {
    console.error('[IndexedDB] Failed to load sessions:', err)
    return null
  }
}

/**
 * Save an individual image to IndexedDB.
 */
export async function dbSaveImage(image: AttachedImage): Promise<void> {
  if (!image || !image.id || !image.dataUrl) return
  try {
    const db = await getDb()
    const tx = db.transaction(IMAGES_STORE, 'readwrite')
    const store = tx.objectStore(IMAGES_STORE)
    store.put(image)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.error('[IndexedDB] Failed to save image:', err)
  }
}

/**
 * Load an individual image dataUrl by ID.
 */
export async function dbLoadImage(id: string): Promise<string | null> {
  if (!id) return null
  try {
    const db = await getDb()
    const tx = db.transaction(IMAGES_STORE, 'readonly')
    const store = tx.objectStore(IMAGES_STORE)
    const req = store.get(id)
    const result = await new Promise<AttachedImage | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return result?.dataUrl || null
  } catch (err) {
    console.error('[IndexedDB] Failed to load image:', err)
    return null
  }
}

/**
 * Delete an individual image by ID.
 */
export async function dbDeleteImage(id: string): Promise<void> {
  if (!id) return
  try {
    const db = await getDb()
    const tx = db.transaction(IMAGES_STORE, 'readwrite')
    const store = tx.objectStore(IMAGES_STORE)
    store.delete(id)
  } catch (err) {
    console.error('[IndexedDB] Failed to delete image:', err)
  }
}
