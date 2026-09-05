import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  ChevronRight,
  Plus,
  FolderPlus,
  RefreshCw,
  Minus,
  ExternalLink,
  Terminal,
  Trash2,
  Edit3,
  Copy,
  Folder
} from 'lucide-react'
import { FileIcon } from './FileIcon'
import './ProjectFileTree.css'

export interface ProjectFileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
  mtime: number
  ext: string
}

export interface ProjectFileTreeProps {
  rootPath: string
  onOpenFile?: (filePath: string) => void
  onOpenInTerminal?: (folderPath: string) => void
}

interface ContextMenuState {
  isOpen: boolean
  x: number
  y: number
  targetItem: ProjectFileEntry | null
}

interface InlineCreateState {
  parentPath: string
  type: 'file' | 'folder'
  value: string
}

export const ProjectFileTree: React.FC<ProjectFileTreeProps> = ({
  rootPath,
  onOpenFile,
  onOpenInTerminal
}) => {
  const [childrenMap, setChildrenMap] = useState<Record<string, ProjectFileEntry[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [isLoadingRoot, setIsLoadingRoot] = useState<boolean>(false)

  // Drag & Drop
  const [draggedItem, setDraggedItem] = useState<ProjectFileEntry | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  // Context Menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    targetItem: null
  })

  // Inline Rename
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState<string>('')

  // Inline Create
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null)

  const treeContainerRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  // Fetch children of a folder
  const loadDirectory = useCallback(async (dirPath: string) => {
    if (!window.api?.files?.readDir || !dirPath) return
    try {
      const res = await window.api.files.readDir(dirPath)
      if (res.success && res.items) {
        setChildrenMap((prev) => ({ ...prev, [dirPath]: res.items || [] }))
      }
    } catch (err) {
      console.error('Failed to load directory:', err)
    }
  }, [])

  // Initial load or rootPath change
  useEffect(() => {
    if (!rootPath) return
    setIsLoadingRoot(true)
    loadDirectory(rootPath).finally(() => {
      setIsLoadingRoot(false)
      setExpandedPaths(new Set([rootPath]))
    })
  }, [rootPath, loadDirectory])

  // Focus rename input when editing starts
  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus()
      const dotIndex = renameValue.lastIndexOf('.')
      if (dotIndex > 0) {
        renameInputRef.current.setSelectionRange(0, dotIndex)
      } else {
        renameInputRef.current.select()
      }
    }
  }, [renamingPath])

  // Focus inline create input when creation starts
  useEffect(() => {
    if (inlineCreate && createInputRef.current) {
      createInputRef.current.focus()
    }
  }, [inlineCreate])

  // Dismiss context menu on click outside
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (contextMenu.isOpen) {
        const target = e.target as HTMLElement
        if (!target.closest('.tree-context-menu')) {
          setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
        }
      }
    }
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [contextMenu.isOpen])

  // Toggle Folder expansion
  const toggleFolder = useCallback(
    (item: ProjectFileEntry) => {
      if (!item.isDirectory) return
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(item.path)) {
          next.delete(item.path)
        } else {
          next.add(item.path)
          if (!childrenMap[item.path]) {
            loadDirectory(item.path)
          }
        }
        return next
      })
    },
    [childrenMap, loadDirectory]
  )

  // Refresh entire tree
  const handleRefresh = useCallback(() => {
    if (!rootPath) return
    loadDirectory(rootPath)
    expandedPaths.forEach((path) => {
      if (path !== rootPath) loadDirectory(path)
    })
  }, [rootPath, expandedPaths, loadDirectory])

  // Collapse All folders
  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  // Start Inline Create
  const triggerCreate = (parentPath: string, type: 'file' | 'folder') => {
    setInlineCreate({ parentPath, type, value: '' })
    setExpandedPaths((prev) => new Set(prev).add(parentPath))
  }

  // Submit Inline Create
  const submitCreate = async () => {
    if (!inlineCreate || !inlineCreate.value.trim()) {
      setInlineCreate(null)
      return
    }
    const cleanName = inlineCreate.value.trim()
    const separator = inlineCreate.parentPath.includes('/') ? '/' : '\\'
    const newPath = inlineCreate.parentPath.endsWith(separator)
      ? `${inlineCreate.parentPath}${cleanName}`
      : `${inlineCreate.parentPath}${separator}${cleanName}`

    try {
      if (inlineCreate.type === 'file') {
        await window.api?.files?.createFile(newPath)
      } else {
        await window.api?.files?.createDir(newPath)
      }
      loadDirectory(inlineCreate.parentPath)
    } catch (err) {
      console.error('Create failed:', err)
    } finally {
      setInlineCreate(null)
    }
  }

  // Submit Inline Rename
  const submitRename = async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null)
      return
    }
    const separator = renamingPath.includes('/') ? '/' : '\\'
    const parentDir = renamingPath.substring(0, renamingPath.lastIndexOf(separator))
    const newPath = `${parentDir}${separator}${renameValue.trim()}`

    if (newPath !== renamingPath) {
      try {
        const res = await window.api?.files?.rename(renamingPath, newPath)
        if (res?.success) {
          loadDirectory(parentDir)
        }
      } catch (err) {
        console.error('Rename failed:', err)
      }
    }
    setRenamingPath(null)
  }

  // Delete item
  const handleDelete = async (item: ProjectFileEntry) => {
    const isConfirmed = window.confirm(`Удалить "${item.name}" в Корзину?`)
    if (!isConfirmed) return

    try {
      const res = await window.api?.files?.delete(item.path)
      if (res?.success) {
        const separator = item.path.includes('/') ? '/' : '\\'
        const parentDir = item.path.substring(0, item.path.lastIndexOf(separator))
        loadDirectory(parentDir || rootPath)
      }
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  // Right-click context menu handler
  const handleContextMenu = (e: React.MouseEvent, item: ProjectFileEntry | null) => {
    e.preventDefault()
    e.stopPropagation()

    let posX = e.clientX
    let posY = e.clientY

    // Guard window boundary
    if (posX + 190 > window.innerWidth) posX = window.innerWidth - 195
    if (posY + 230 > window.innerHeight) posY = window.innerHeight - 235

    setContextMenu({
      isOpen: true,
      x: Math.max(10, posX),
      y: Math.max(10, posY),
      targetItem: item
    })
  }

  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, item: ProjectFileEntry) => {
    e.stopPropagation()
    setDraggedItem(item)
    e.dataTransfer.setData('text/plain', item.path)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, targetItem: ProjectFileEntry) => {
    if (!draggedItem || draggedItem.path === targetItem.path) return
    if (!targetItem.isDirectory) return

    // Prevent dragging into a subfolder of itself
    if (targetItem.path.startsWith(draggedItem.path)) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverPath !== targetItem.path) {
      setDragOverPath(targetItem.path)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation()
    setDragOverPath(null)
  }

  const handleDrop = async (e: React.DragEvent, targetItem: ProjectFileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverPath(null)

    if (!draggedItem || !targetItem.isDirectory || draggedItem.path === targetItem.path) {
      setDraggedItem(null)
      return
    }

    try {
      const res = await window.api?.files?.move(draggedItem.path, targetItem.path)
      if (res?.success) {
        const separator = draggedItem.path.includes('/') ? '/' : '\\'
        const srcParent = draggedItem.path.substring(0, draggedItem.path.lastIndexOf(separator))
        loadDirectory(srcParent || rootPath)
        loadDirectory(targetItem.path)
        setExpandedPaths((prev) => new Set(prev).add(targetItem.path))
      }
    } catch (err) {
      console.error('Move failed:', err)
    } finally {
      setDraggedItem(null)
    }
  }

  // Recursive Tree Node Renderer
  const renderNode = (item: ProjectFileEntry, depth: number = 0) => {
    const isExpanded = expandedPaths.has(item.path)
    const isSelected = selectedPath === item.path
    const isDragOver = dragOverPath === item.path
    const isRenaming = renamingPath === item.path
    const children = childrenMap[item.path] || []

    return (
      <div key={item.path} className="tree-node-wrapper">
        <div
          className={`tree-node-row ${isSelected ? 'is-selected' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
          style={{ paddingLeft: '8px' }}
          onClick={() => {
            setSelectedPath(item.path)
            if (item.isDirectory) {
              toggleFolder(item)
            } else {
              onOpenFile?.(item.path)
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, item)}
          draggable={!isRenaming}
          onDragStart={(e) => handleDragStart(e, item)}
          onDragOver={(e) => handleDragOver(e, item)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, item)}
        >
          {/* Depth Indent Guides */}
          {depth > 0 && (
            <div className="tree-indent-guides">
              {Array.from({ length: depth }).map((_, i) => (
                <span key={i} className="tree-indent-guide-line" />
              ))}
            </div>
          )}

          {/* Chevron for directories */}
          {item.isDirectory ? (
            <span
              className={`tree-chevron-btn ${isExpanded ? 'is-open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleFolder(item)
              }}
            >
              <ChevronRight size={13} strokeWidth={2} />
            </span>
          ) : (
            <span className="tree-chevron-btn is-hidden">
              <ChevronRight size={13} />
            </span>
          )}

          {/* Icon */}
          <span className="tree-node-icon">
            <FileIcon name={item.name} isDirectory={item.isDirectory} isOpen={isExpanded} size={16} />
          </span>

          {/* Label or Inline Rename Input */}
          {isRenaming ? (
            <div className="tree-inline-input-wrapper" onClick={(e) => e.stopPropagation()}>
              <input
                ref={renameInputRef}
                type="text"
                className="tree-inline-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenamingPath(null)
                }}
                onBlur={submitRename}
              />
            </div>
          ) : (
            <span className="tree-node-label" title={item.path}>
              {item.name}
            </span>
          )}
        </div>

        {/* Inline Create Row if creating inside this directory */}
        {inlineCreate && inlineCreate.parentPath === item.path && (
          <div
            className="tree-node-row is-creating"
            style={{ paddingLeft: '8px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {depth + 1 > 0 && (
              <div className="tree-indent-guides">
                {Array.from({ length: depth + 1 }).map((_, i) => (
                  <span key={i} className="tree-indent-guide-line" />
                ))}
              </div>
            )}
            <span className="tree-chevron-btn is-hidden">
              <ChevronRight size={13} />
            </span>
            <span className="tree-node-icon">
              <FileIcon
                name={inlineCreate.value || (inlineCreate.type === 'folder' ? 'new_folder' : 'new_file')}
                isDirectory={inlineCreate.type === 'folder'}
                isOpen={false}
                size={16}
              />
            </span>
            <div className="tree-inline-input-wrapper">
              <input
                ref={createInputRef}
                type="text"
                className="tree-inline-input"
                placeholder={inlineCreate.type === 'file' ? 'имя-файла.ts' : 'папка'}
                value={inlineCreate.value}
                onChange={(e) => setInlineCreate((prev) => (prev ? { ...prev, value: e.target.value } : null))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate()
                  if (e.key === 'Escape') setInlineCreate(null)
                }}
                onBlur={submitCreate}
              />
            </div>
          </div>
        )}

        {/* Render Children when expanded */}
        {item.isDirectory && isExpanded && children.length > 0 && (
          <div className="tree-children-container">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootFolderName = rootPath ? rootPath.replace(/.*[/\\]/, '') || rootPath : 'Проект'
  const rootEntries = childrenMap[rootPath] || []

  return (
    <div className="project-file-tree-container" ref={treeContainerRef}>
      {/* Explorer Top Toolbar */}
      <div className="project-file-tree-header">
        <div className="tree-header-info" title={rootPath}>
          <FileIcon name={rootFolderName} isDirectory={true} isOpen={true} size={15} />
          <span className="tree-header-title">{rootFolderName}</span>
        </div>

        <div className="tree-header-actions">
          <button
            type="button"
            className="tree-header-btn"
            onClick={() => triggerCreate(rootPath, 'file')}
            title="Новый файл"
            aria-label="Новый файл"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="tree-header-btn"
            onClick={() => triggerCreate(rootPath, 'folder')}
            title="Новая папка"
            aria-label="Новая папка"
          >
            <FolderPlus size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="tree-header-btn"
            onClick={handleRefresh}
            title="Обновить дерево"
            aria-label="Обновить"
          >
            <RefreshCw size={12.5} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="tree-header-btn"
            onClick={handleCollapseAll}
            title="Свернуть все папки"
            aria-label="Свернуть все"
          >
            <Minus size={13} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Main Scrollable Tree Body */}
      <div
        className="project-file-tree-body"
        onContextMenu={(e) => handleContextMenu(e, null)}
      >
        {/* Inline Create Row for root folder */}
        {inlineCreate && inlineCreate.parentPath === rootPath && (
          <div className="tree-node-row is-creating" style={{ paddingLeft: '8px' }}>
            <span className="tree-chevron-btn is-hidden">
              <ChevronRight size={13} />
            </span>
            <span className="tree-node-icon">
              <FileIcon
                name={inlineCreate.value || (inlineCreate.type === 'folder' ? 'new_folder' : 'new_file')}
                isDirectory={inlineCreate.type === 'folder'}
                isOpen={false}
                size={16}
              />
            </span>
            <div className="tree-inline-input-wrapper">
              <input
                ref={createInputRef}
                type="text"
                className="tree-inline-input"
                placeholder={inlineCreate.type === 'file' ? 'имя-файла.ts' : 'папка'}
                value={inlineCreate.value}
                onChange={(e) => setInlineCreate((prev) => (prev ? { ...prev, value: e.target.value } : null))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate()
                  if (e.key === 'Escape') setInlineCreate(null)
                }}
                onBlur={submitCreate}
              />
            </div>
          </div>
        )}

        {/* Tree List */}
        {rootEntries.length > 0 ? (
          rootEntries.map((item) => renderNode(item, 0))
        ) : !isLoadingRoot ? (
          <div className="tree-empty-state">
            <Folder size={32} strokeWidth={1.4} className="tree-empty-icon" />
            <div className="tree-empty-title">Папка пуста</div>
            <div className="tree-empty-desc">Создайте файл или папку через панель выше.</div>
          </div>
        ) : null}
      </div>

      {/* Floating Right-Click Context Menu */}
      {contextMenu.isOpen && (
        <div
          className="tree-context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* If clicked on a directory or background: New File / Folder */}
          {(!contextMenu.targetItem || contextMenu.targetItem.isDirectory) && (
            <>
              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  const targetDir = contextMenu.targetItem?.path || rootPath
                  triggerCreate(targetDir, 'file')
                  setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
                }}
              >
                <Plus size={13} />
                <span>Новый файл</span>
              </button>
              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  const targetDir = contextMenu.targetItem?.path || rootPath
                  triggerCreate(targetDir, 'folder')
                  setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
                }}
              >
                <FolderPlus size={13} />
                <span>Новая папка</span>
              </button>
              <div className="tree-context-divider" />
            </>
          )}

          {/* If clicked on an item: Rename / Delete */}
          {contextMenu.targetItem && (
            <>
              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  if (contextMenu.targetItem) {
                    setRenamingPath(contextMenu.targetItem.path)
                    setRenameValue(contextMenu.targetItem.name)
                  }
                  setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
                }}
              >
                <Edit3 size={13} />
                <span>Переименовать</span>
              </button>

              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  if (contextMenu.targetItem?.path) {
                    navigator.clipboard.writeText(contextMenu.targetItem.path)
                  }
                  setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
                }}
              >
                <Copy size={13} />
                <span>Копировать путь</span>
              </button>
              <div className="tree-context-divider" />
            </>
          )}

          {/* Reveal in Windows Explorer */}
          <button
            type="button"
            className="tree-context-item"
            onClick={() => {
              const target = contextMenu.targetItem?.path || rootPath
              window.api?.files?.reveal(target)
              setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
            }}
          >
            <ExternalLink size={13} />
            <span>Показать в проводнике</span>
          </button>

          {/* Open in Terminal */}
          <button
            type="button"
            className="tree-context-item"
            onClick={() => {
              const target = contextMenu.targetItem
                ? contextMenu.targetItem.isDirectory
                  ? contextMenu.targetItem.path
                  : contextMenu.targetItem.path.replace(/[/\\][^/\\]+$/, '')
                : rootPath
              onOpenInTerminal?.(target)
              setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
            }}
          >
            <Terminal size={13} />
            <span>Открыть в терминале</span>
          </button>

          {/* Delete Option */}
          {contextMenu.targetItem && (
            <>
              <div className="tree-context-divider" />
              <button
                type="button"
                className="tree-context-item danger"
                onClick={() => {
                  if (contextMenu.targetItem) {
                    handleDelete(contextMenu.targetItem)
                  }
                  setContextMenu({ isOpen: false, x: 0, y: 0, targetItem: null })
                }}
              >
                <Trash2 size={13} />
                <span>Удалить</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ProjectFileTree
