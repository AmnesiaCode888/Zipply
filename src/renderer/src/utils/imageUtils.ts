import { AttachedImage } from '../types/chat'
import { dbSaveImage, dbLoadImage } from './indexedDb'

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
  'heic',
  'heif',
  'tiff',
  'tif'
])

export function isImageFile(file: File | null | undefined): boolean {
  if (!file) return false
  if (file.type && (file.type.startsWith('image/') || file.type.includes('image'))) return true
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.has(ext)
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || file.size === 0) {
      reject(new Error('Empty file cannot be read'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.length > 20) {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file as data URL'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

/**
 * Optimizes image data URL by safely downscaling if dimensions or size are too large,
 * preserving transparency and preventing canvas corruption.
 */
export async function optimizeImageDataUrl(
  dataUrl: string,
  maxWidth = 1920,
  maxHeight = 1920,
  quality = 0.85
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return dataUrl
  }

  // SVGs, GIFs, ICOs don't need raster downscaling
  if (
    dataUrl.startsWith('data:image/svg+xml') ||
    dataUrl.startsWith('data:image/gif') ||
    dataUrl.startsWith('data:image/x-icon') ||
    dataUrl.startsWith('data:image/vnd.microsoft.icon')
  ) {
    return dataUrl
  }

  // Small or moderate images don't need downscaling
  if (dataUrl.length < 350000) {
    return dataUrl
  }

  return new Promise((resolve) => {
    let resolved = false
    const safeResolve = (url: string) => {
      if (!resolved) {
        resolved = true
        resolve(url)
      }
    }

    // Safety timeout: never hang the UI
    const timer = setTimeout(() => {
      safeResolve(dataUrl)
    }, 1500)

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      clearTimeout(timer)
      try {
        const naturalW = img.naturalWidth || img.width
        const naturalH = img.naturalHeight || img.height

        if (naturalW <= 0 || naturalH <= 0) {
          safeResolve(dataUrl)
          return
        }

        if (naturalW <= maxWidth && naturalH <= maxHeight && dataUrl.length < 1000000) {
          safeResolve(dataUrl)
          return
        }

        let width = naturalW
        let height = naturalH

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height)
          height = maxHeight
        }

        width = Math.max(1, Math.round(width))
        height = Math.max(1, Math.round(height))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          safeResolve(dataUrl)
          return
        }

        const isPng = dataUrl.startsWith('data:image/png')
        const isWebp = dataUrl.startsWith('data:image/webp')

        if (!isPng && !isWebp) {
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, width, height)
        }

        ctx.drawImage(img, 0, 0, width, height)

        let outputMime = 'image/jpeg'
        if (isPng) outputMime = 'image/png'
        else if (isWebp) outputMime = 'image/webp'

        const compressed = canvas.toDataURL(outputMime, quality)
        if (
          compressed &&
          compressed.startsWith('data:image/') &&
          compressed.length > 200 &&
          compressed !== 'data:,'
        ) {
          safeResolve(compressed)
        } else {
          safeResolve(dataUrl)
        }
      } catch (err) {
        console.warn('[optimizeImageDataUrl] Optimization error, keeping original:', err)
        safeResolve(dataUrl)
      }
    }

    img.onerror = () => {
      clearTimeout(timer)
      safeResolve(dataUrl)
    }

    img.src = dataUrl
  })
}

export async function processImageFile(file: File): Promise<AttachedImage | null> {
  if (!isImageFile(file)) return null

  try {
    const rawDataUrl = await readFileAsDataUrl(file)
    if (!rawDataUrl || !rawDataUrl.startsWith('data:image/') || rawDataUrl === 'data:,') {
      console.warn('[processImageFile] Empty or invalid data URL for file:', file.name)
      return null
    }

    const optimizedDataUrl = await optimizeImageDataUrl(rawDataUrl)
    const validDataUrl =
      optimizedDataUrl &&
      optimizedDataUrl.startsWith('data:image/') &&
      optimizedDataUrl !== 'data:,' &&
      optimizedDataUrl.length > 50
        ? optimizedDataUrl
        : rawDataUrl

    const attached: AttachedImage = {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || 'image.jpg',
      dataUrl: validDataUrl,
      size: file.size
    }

    // Persist to IndexedDB immediately
    await dbSaveImage(attached)

    return attached
  } catch (err) {
    console.error('[processImageFile] Failed to process image file:', err)
    return null
  }
}

export { dbLoadImage }


