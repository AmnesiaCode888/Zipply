import React from 'react'

interface FileIconProps {
  name: string
  isDirectory: boolean
  isOpen?: boolean
  size?: number
  className?: string
}

// Helper: render a Material Icon Theme SVG from public/icons/
const MatIcon: React.FC<{ icon: string; size: number; className?: string }> = ({
  icon,
  size,
  className
}) => (
  <img
    src={`./icons/${icon}.svg`}
    width={size}
    height={size}
    alt=""
    aria-hidden="true"
    draggable={false}
    className={className}
    style={{ flexShrink: 0, display: 'inline-block' }}
  />
)

export const FileIcon: React.FC<FileIconProps> = ({
  name,
  isDirectory,
  isOpen = false,
  size = 16,
  className = ''
}) => {
  const lowerName = name.toLowerCase()

  // 1. Folders
  if (isDirectory) {
    if (lowerName === '.git') {
      return <MatIcon icon="git" size={size} className={className} />
    }
    if (lowerName === 'node_modules') {
      return <MatIcon icon={isOpen ? 'folder-node-open' : 'folder-node'} size={size} className={className} />
    }
    if (lowerName === 'src' || lowerName === 'source') {
      return <MatIcon icon={isOpen ? 'folder-src-open' : 'folder-src'} size={size} className={className} />
    }
    if (lowerName === 'components' || lowerName === 'widgets' || lowerName === 'views' || lowerName === 'pages') {
      return <MatIcon icon={isOpen ? 'folder-components-open' : 'folder-components'} size={size} className={className} />
    }
    if (lowerName === 'public' || lowerName === 'static' || lowerName === 'assets' || lowerName === 'images' || lowerName === 'media') {
      return <MatIcon icon={isOpen ? 'folder-public-open' : 'folder-public'} size={size} className={className} />
    }
    if (lowerName === 'dist' || lowerName === 'build' || lowerName === 'out' || lowerName === '.output') {
      return <MatIcon icon={isOpen ? 'folder-dist-open' : 'folder-dist'} size={size} className={className} />
    }
    if (lowerName === 'test' || lowerName === 'tests' || lowerName === '__tests__' || lowerName === 'spec' || lowerName === 'specs') {
      return <MatIcon icon={isOpen ? 'folder-test-open' : 'folder-test'} size={size} className={className} />
    }
    if (lowerName === 'hooks') {
      return <MatIcon icon={isOpen ? 'folder-hook-open' : 'folder-hook'} size={size} className={className} />
    }
    if (lowerName === 'utils' || lowerName === 'helpers') {
      return <MatIcon icon={isOpen ? 'folder-utils-open' : 'folder-utils'} size={size} className={className} />
    }
    if (lowerName === 'lib') {
      return <MatIcon icon={isOpen ? 'folder-lib-open' : 'folder-lib'} size={size} className={className} />
    }
    if (lowerName === 'app') {
      return <MatIcon icon={isOpen ? 'folder-app-open' : 'folder-app'} size={size} className={className} />
    }
    // Default folder
    return <MatIcon icon={isOpen ? 'folder-open' : 'folder'} size={size} className={className} />
  }

  // 2. Exact Filenames
  if (lowerName === 'package.json' || lowerName === 'package-lock.json' || lowerName === 'yarn.lock' || lowerName === 'pnpm-lock.yaml') {
    return <MatIcon icon="npm" size={size} className={className} />
  }
  if (lowerName === 'tsconfig.json' || lowerName.startsWith('tsconfig.')) {
    return <MatIcon icon="tsconfig" size={size} className={className} />
  }
  if (lowerName.includes('vite.config') || lowerName.includes('electron.vite')) {
    return <MatIcon icon="vite" size={size} className={className} />
  }
  if (lowerName.startsWith('.env')) {
    return <MatIcon icon="lock" size={size} className={className} />
  }
  if (lowerName === '.gitignore' || lowerName === '.gitattributes' || lowerName === '.gitmodules') {
    return <MatIcon icon="git" size={size} className={className} />
  }
  if (lowerName.includes('eslint')) {
    return <MatIcon icon="eslint" size={size} className={className} />
  }
  if (lowerName === '.editorconfig') {
    return <MatIcon icon="editorconfig" size={size} className={className} />
  }

  // 3. Extensions
  const ext = lowerName.split('.').pop() || ''

  switch (ext) {
    case 'tsx':
      return <MatIcon icon="react_ts" size={size} className={className} />
    case 'ts':
      return <MatIcon icon="typescript" size={size} className={className} />
    case 'jsx':
      return <MatIcon icon="react" size={size} className={className} />
    case 'js':
    case 'mjs':
    case 'cjs':
      return <MatIcon icon="javascript" size={size} className={className} />
    case 'json':
      return <MatIcon icon="json" size={size} className={className} />
    case 'css':
      return <MatIcon icon="css" size={size} className={className} />
    case 'scss':
    case 'sass':
    case 'less':
      return <MatIcon icon="sass" size={size} className={className} />
    case 'html':
    case 'htm':
      return <MatIcon icon="html" size={size} className={className} />
    case 'md':
    case 'markdown':
      return <MatIcon icon="markdown" size={size} className={className} />
    case 'py':
      return <MatIcon icon="python" size={size} className={className} />
    case 'sh':
    case 'bash':
    case 'zsh':
      return <MatIcon icon="powershell" size={size} className={className} />
    case 'ps1':
      return <MatIcon icon="powershell" size={size} className={className} />
    case 'bat':
    case 'cmd':
      return <MatIcon icon="powershell" size={size} className={className} />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
    case 'webp':
    case 'bmp':
      return <MatIcon icon="image" size={size} className={className} />
    case 'yml':
    case 'yaml':
      return <MatIcon icon="yaml" size={size} className={className} />
    case 'toml':
      return <MatIcon icon="toml" size={size} className={className} />
    case 'ini':
    case 'conf':
      return <MatIcon icon="settings" size={size} className={className} />
    default:
      return <MatIcon icon="file" size={size} className={className} />
  }
}

export default FileIcon
