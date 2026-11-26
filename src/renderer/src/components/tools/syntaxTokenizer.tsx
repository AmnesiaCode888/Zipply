import React from 'react'

// Tokenizer for C#, TypeScript, JavaScript in Apple Dark Mode palette
export function highlightCodeTokens(line: string): React.ReactNode[] {
  if (/^\s*<\/?[a-zA-Z!]/.test(line)) {
    return line.split(/(<\/?[\w:.-]+|\/?>|"[^"]*"|'[^']*')/g).map((part, index) =>
      /^<\/?[\w:.-]+|^\/?>$/.test(part)
        ? <span key={index} className="text-secondary">{part}</span>
        : /^['"]/.test(part)
          ? <span key={index} className="text-diff-add">{part}</span>
          : part
    )
  }
  // If line contains comments
  const commentIdx = line.indexOf('//')
  let codePart = line
  let commentPart = ''
  if (commentIdx !== -1) {
    codePart = line.substring(0, commentIdx)
    commentPart = line.substring(commentIdx)
  }

  const tokenRegex =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:using|namespace|public|private|protected|internal|class|struct|interface|enum|void|return|const|let|var|import|export|from|default|async|await|new|function|static|readonly|get|set|typeof|instanceof|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|override|virtual|abstract)\b)|(\b(?:true|false|null|undefined)\b)|(\b[A-Z][a-zA-Z0-9_]*\b)|(\b\d+\b)|([a-zA-Z_][a-zA-Z0-9_]*(?=\s*\())/g

  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(codePart)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(codePart.substring(lastIndex, match.index))
    }

    const [, str, keyword, boolVal, typeName, num, method] = match

    if (str) {
      nodes.push(
        <span key={match.index} className="text-diff-add">
          {str}
        </span>
      )
    } else if (keyword) {
      nodes.push(
        <span key={match.index} className="text-primary font-medium">
          {keyword}
        </span>
      )
    } else if (boolVal) {
      nodes.push(
        <span key={match.index} className="text-primary font-medium">
          {boolVal}
        </span>
      )
    } else if (typeName) {
      nodes.push(
        <span key={match.index} className="text-strong font-medium">
          {typeName}
        </span>
      )
    } else if (num) {
      nodes.push(
        <span key={match.index} className="text-secondary">
          {num}
        </span>
      )
    } else if (method) {
      nodes.push(
        <span key={match.index} className="text-primary">
          {method}
        </span>
      )
    }

    lastIndex = tokenRegex.lastIndex
  }

  if (lastIndex < codePart.length) {
    nodes.push(codePart.substring(lastIndex))
  }

  if (commentPart) {
    nodes.push(
      <span key="comment" className="text-muted italic">
        {commentPart}
      </span>
    )
  }

  return nodes
}
