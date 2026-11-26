export async function readResponseText(response: Response, maxBytes = 2_000_000): Promise<string> {
  const length = Number(response.headers.get('content-length'))
  if (length > maxBytes) throw new Error('Превышен лимит размера ответа.')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new Error('Превышен лимит размера ответа.')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally { reader.releaseLock() }
}
