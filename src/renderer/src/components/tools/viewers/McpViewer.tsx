import React from 'react'
import { Server } from 'lucide-react'
import { StepArgs } from '../../../types/chat'

interface McpViewerProps {
  args?: StepArgs
  result?: string
  data?: unknown
}

export const McpViewer: React.FC<McpViewerProps> = ({ args = {}, result = '', data }) => {
  const serverName = (args.server_name as string) || (args.server as string) || 'mcp'
  const toolName = (args.tool_name as string) || (args.tool as string) || ''
  const mcpArgs = args.arguments || args

  const rawData = data as { raw?: any; images?: string[] } | undefined
  const images = rawData?.images || []

  return (
    <div className="mcp-step-viewer" style={{ padding: '8px 0', fontSize: '13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: 'rgba(167, 139, 250, 0.15)',
            color: '#c4b5fd',
            padding: '2px 8px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 600
          }}
        >
          <Server size={11} />
          <span>{serverName}{toolName ? ` / ${toolName}` : ''}</span>
        </span>
      </div>

      {/* Arguments preview if present */}
      {mcpArgs && typeof mcpArgs === 'object' && Object.keys(mcpArgs).length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--card-bg, rgba(255, 255, 255, 0.03))',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))',
            borderRadius: '8px',
            padding: '6px 10px',
            marginBottom: '8px',
            fontSize: '11.5px',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-secondary, #a1a1aa)'
          }}
        >
          <div style={{ color: 'var(--text-muted, #71717a)', fontSize: '10.5px', marginBottom: '2px' }}>Параметры:</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(mcpArgs, null, 2)}
          </pre>
        </div>
      )}

      {/* Text Result */}
      {result && (
        <div
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
            color: 'var(--code-text, var(--text-primary, #d1d5db))',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '260px',
            overflowY: 'auto',
            backgroundColor: 'var(--code-bg, var(--bg-surface, #0c0c0c))',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid var(--code-border, var(--border-card, #1f1f1f))'
          }}
        >
          {result}
        </div>
      )}

      {/* Image attachments if returned from MCP */}
      {images.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt="MCP Result Attachment"
              style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '8px', border: '1px solid var(--border-card, #333)' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
