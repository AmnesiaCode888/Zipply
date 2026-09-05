import React, { memo } from 'react'
import { renderMarkdown } from './MarkdownRenderer'
import { useTypewriterStream } from '../hooks/useTypewriterStream'

export interface StreamingMarkdownProps {
  content: string
  isStreaming?: boolean
  onTick?: () => void
}

/**
 * High-performance streaming Markdown renderer with character-by-character typewriter
 * smoothing and an adaptive buffer catch-up engine.
 */
export const StreamingMarkdown: React.FC<StreamingMarkdownProps> = memo(
  ({ content, isStreaming = false, onTick }) => {
    const { displayedText, isTyping } = useTypewriterStream(content, isStreaming, {
      onCharRendered: onTick
    })

    return <>{renderMarkdown(displayedText, { isStreaming: isStreaming || isTyping })}</>
  }
)

StreamingMarkdown.displayName = 'StreamingMarkdown'

export default StreamingMarkdown
