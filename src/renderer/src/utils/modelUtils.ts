/**
 * Helper to get a clean, human-readable display label for the currently active AI model.
 */
export function getModelDisplayName(): string {
  try {
    const saved = localStorage.getItem('zipply_ai_config') ||
                  localStorage.getItem('zipple_ai_config') ||
                  localStorage.getItem('clickcoder_ai_config') ||
                  localStorage.getItem('clickcode_ai_config') ||
                  localStorage.getItem('click_ai_config')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.model) {
        const raw = String(parsed.model).split('/').pop() || parsed.model
        if (raw === 'deepseek-chat') return 'DeepSeek-V3'
        if (raw === 'deepseek-reasoner') return 'DeepSeek-R1'
        if (raw === 'deepseek-coder') return 'DeepSeek Coder'
        if (raw.startsWith('gpt-4o-mini')) return 'GPT-4o mini'
        if (raw.startsWith('gpt-4o')) return 'GPT-4o'
        if (raw.startsWith('o3-mini')) return 'o3-mini'
        if (raw.startsWith('o1')) return 'o1'
        if (raw.includes('claude-3.5-sonnet') || raw.includes('claude-3-5-sonnet')) return 'Claude 3.5'
        if (raw.includes('llama-3.3')) return 'Llama 3.3'
        if (raw.includes('qwen2.5')) return 'Qwen 2.5'
        return raw.length > 14 ? raw.slice(0, 14) + '…' : raw
      }
    }
  } catch {}
  return 'DeepSeek-V3'
}
