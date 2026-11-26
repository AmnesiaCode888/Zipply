import React, { useMemo, useRef, useState } from 'react'
import * as Diff from 'diff'
import { ChevronDown, ChevronUp, FileCode2, GitCompareArrows, RotateCcw } from '../../icons'
import type { DiffHunk, DiffHunkLine, WorkspaceFileDiff } from '../../../../shared/workspaceChanges'
import { highlightCodeTokens } from '../tools/syntaxTokenizer'

export type DiffViewMode = 'unified' | 'split'

interface ChangesDiffViewerProps {
  diff: WorkspaceFileDiff
  viewMode: DiffViewMode
  busyHunkIndex?: number | null
  canRevertHunk?: boolean
  onRevertHunk?: (hunkIndex: number) => void
}

interface WordSegment {
  text: string
  emphasized: boolean
}

interface EnrichedLine {
  line: DiffHunkLine
  segments?: WordSegment[]
}

interface SplitRow {
  left?: EnrichedLine
  right?: EnrichedLine
}

const MAX_WORD_DIFF_LINE_LEN = 600

function computeWordSegments(oldStr: string, newStr: string): { left: WordSegment[]; right: WordSegment[] } | null {
  if (oldStr.length > MAX_WORD_DIFF_LINE_LEN || newStr.length > MAX_WORD_DIFF_LINE_LEN) return null
  if (oldStr === newStr) return null
  const parts = Diff.diffWordsWithSpace(oldStr, newStr)
  const left: WordSegment[] = []
  const right: WordSegment[] = []
  for (const part of parts) {
    if (part.removed) {
      left.push({ text: part.value, emphasized: true })
    } else if (part.added) {
      right.push({ text: part.value, emphasized: true })
    } else {
      left.push({ text: part.value, emphasized: false })
      right.push({ text: part.value, emphasized: false })
    }
  }
  return { left, right }
}

function buildEnrichedRows(lines: DiffHunkLine[]): { unified: EnrichedLine[]; split: SplitRow[] } {
  const unified: EnrichedLine[] = []
  const split: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const cur = lines[i]
    if (cur.type === 'context') {
      const enriched: EnrichedLine = { line: cur }
      unified.push(enriched)
      split.push({ left: enriched, right: enriched })
      i++
      continue
    }
    const dels: DiffHunkLine[] = []
    const adds: DiffHunkLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])

    const pairedCount = Math.min(dels.length, adds.length)
    const enrichedDels: EnrichedLine[] = dels.map((l) => ({ line: l }))
    const enrichedAdds: EnrichedLine[] = adds.map((l) => ({ line: l }))

    for (let j = 0; j < pairedCount; j++) {
      const segs = computeWordSegments(dels[j].text, adds[j].text)
      if (segs) {
        enrichedDels[j].segments = segs.left
        enrichedAdds[j].segments = segs.right
      }
    }

    for (const d of enrichedDels) unified.push(d)
    for (const a of enrichedAdds) unified.push(a)

    const maxLen = Math.max(enrichedDels.length, enrichedAdds.length)
    for (let j = 0; j < maxLen; j++) {
      split.push({ left: enrichedDels[j], right: enrichedAdds[j] })
    }
  }
  return { unified, split }
}

function renderLineContent(enriched: EnrichedLine, emphasisClass: string): React.ReactNode {
  if (!enriched.line.text) return ' '
  if (!enriched.segments) return highlightCodeTokens(enriched.line.text)
  return enriched.segments.map((seg, idx) =>
    seg.emphasized ? (
      <span key={idx} className={emphasisClass}>
        {seg.text}
      </span>
    ) : (
      <React.Fragment key={idx}>{highlightCodeTokens(seg.text)}</React.Fragment>
    )
  )
}

const HunkCard: React.FC<{
  hunk: DiffHunk
  viewMode: DiffViewMode
  canRevert: boolean
  reverting: boolean
  onRevert?: () => void
  cardRef?: (el: HTMLElement | null) => void
}> = React.memo(({ hunk, viewMode, canRevert, reverting, onRevert, cardRef }) => {
  const { unified, split } = useMemo(() => buildEnrichedRows(hunk.lines), [hunk.lines])
  const counts = useMemo(() => {
    let added = 0
    let removed = 0
    for (const l of hunk.lines) {
      if (l.type === 'add') added++
      else if (l.type === 'del') removed++
    }
    return { added, removed }
  }, [hunk.lines])

  return (
    <section ref={cardRef} className="overflow-hidden rounded-[16px] bg-surface-secondary">
      <header className="flex items-center justify-between gap-3 bg-surface px-3.5 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0 truncate font-mono text-[12px] text-secondary">{hunk.header}</span>
          <span className="shrink-0 text-[11.5px] tabular-nums">
            {counts.added > 0 && <span className="text-diff-add">+{counts.added}</span>}
            {counts.added > 0 && counts.removed > 0 && ' '}
            {counts.removed > 0 && <span className="text-diff-remove">−{counts.removed}</span>}
          </span>
        </div>
        {canRevert && onRevert && (
          <button
            type="button"
            disabled={reverting}
            onClick={onRevert}
            title="Откатить этот блок изменений"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border-none bg-control px-2.5 text-[12px] font-medium text-secondary hover:bg-control-hover hover:text-primary active:scale-95 disabled:opacity-40 cursor-pointer transition-colors"
          >
            <RotateCcw size={12} strokeWidth={1.8} />
            <span>{reverting ? 'Откат…' : 'Откатить блок'}</span>
          </button>
        )}
      </header>

      {viewMode === 'unified' ? (
        <div className="overflow-x-auto code-scrollbar py-1">
          <div className="min-w-full w-max flex flex-col font-mono text-[13.5px] leading-[22px] select-text">
            {unified.map((item, idx) => {
              const isAdded = item.line.type === 'add'
              const isRemoved = item.line.type === 'del'
              return (
                <div
                  key={idx}
                  className={`flex items-stretch min-w-full w-max px-3 py-[1px] ${
                    isAdded ? 'diff-line-added' : isRemoved ? 'diff-line-removed' : 'hover:bg-hover'
                  }`}
                >
                  <div className="flex w-[64px] shrink-0 select-none items-center justify-between gap-1.5 pr-3 text-[11px] tabular-nums text-muted">
                    <span className={`w-5 text-right ${isRemoved ? 'text-diff-remove opacity-90 font-medium' : ''}`}>
                      {item.line.oldLine ?? ''}
                    </span>
                    <span className={`w-5 text-right ${isAdded ? 'text-diff-add opacity-90 font-medium' : ''}`}>
                      {item.line.newLine ?? ''}
                    </span>
                    <span className={`w-3 text-center font-bold ${isAdded ? 'text-diff-add' : isRemoved ? 'text-diff-remove' : 'text-transparent'}`}>
                      {isAdded ? '+' : isRemoved ? '-' : ' '}
                    </span>
                  </div>
                  <span className="flex-1 whitespace-pre pr-4 text-primary">
                    {renderLineContent(item, isAdded ? 'diff-word-added' : 'diff-word-removed')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto code-scrollbar py-1">
          <div className="grid min-w-[720px] grid-cols-2 font-mono text-[13px] leading-[22px] select-text">
            {split.map((row, idx) => {
              const leftDel = row.left?.line.type === 'del'
              const rightAdd = row.right?.line.type === 'add'
              return (
                <React.Fragment key={idx}>
                  <div
                    className={`flex items-stretch min-w-0 px-2.5 py-[1px] ${
                      leftDel ? 'diff-line-removed' : !row.left ? 'bg-canvas/40' : 'hover:bg-hover'
                    }`}
                  >
                    <span className="w-8 shrink-0 select-none pr-2.5 text-right text-[11px] tabular-nums text-muted">
                      {row.left?.line.oldLine ?? ''}
                    </span>
                    <span className="w-4 shrink-0 select-none text-center font-bold text-diff-remove">
                      {leftDel ? '-' : ''}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre text-primary">
                      {row.left ? renderLineContent(row.left, 'diff-word-removed') : ''}
                    </span>
                  </div>
                  <div
                    className={`flex items-stretch min-w-0 px-2.5 py-[1px] ${
                      rightAdd ? 'diff-line-added' : !row.right ? 'bg-canvas/40' : 'hover:bg-hover'
                    }`}
                  >
                    <span className="w-8 shrink-0 select-none pr-2.5 text-right text-[11px] tabular-nums text-muted">
                      {row.right?.line.newLine ?? ''}
                    </span>
                    <span className="w-4 shrink-0 select-none text-center font-bold text-diff-add">
                      {rightAdd ? '+' : ''}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre text-primary">
                      {row.right ? renderLineContent(row.right, 'diff-word-added') : ''}
                    </span>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
})

export const ChangesDiffViewer: React.FC<ChangesDiffViewerProps> = ({
  diff,
  viewMode,
  busyHunkIndex = null,
  canRevertHunk = true,
  onRevertHunk
}) => {
  const hunkRefs = useRef<Array<HTMLElement | null>>([])
  const [activeHunk, setActiveHunk] = useState(0)

  const jumpToHunk = (nextIndex: number) => {
    if (!diff.hunks.length) return
    const bounded = (nextIndex + diff.hunks.length) % diff.hunks.length
    setActiveHunk(bounded)
    const node = hunkRefs.current[bounded]
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      })
    }
  }

  if (diff.kind === 'binary') {
    return (
      <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-[20px] bg-surface p-6 text-center">
        <FileCode2 size={26} strokeWidth={1.5} className="text-secondary" />
        <div className="text-[15px] font-medium text-primary break-all">{diff.path.split('/').pop()}</div>
        <p className="text-[13.5px] leading-5 text-secondary">
          Бинарный файл нельзя показать в текстовом diff.
        </p>
      </div>
    )
  }

  if (diff.kind === 'too-large') {
    return (
      <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-[20px] bg-surface p-6 text-center">
        <FileCode2 size={26} strokeWidth={1.5} className="text-secondary" />
        <div className="text-[15px] font-medium text-primary break-all">{diff.path.split('/').pop()}</div>
        <p className="text-[13.5px] leading-5 text-secondary">
          {diff.warning || 'Файл или diff слишком большой для встроенного просмотра.'}
        </p>
      </div>
    )
  }

  if (diff.kind === 'empty' || diff.hunks.length === 0) {
    return (
      <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-[20px] bg-surface p-6 text-center">
        <GitCompareArrows size={24} strokeWidth={1.5} className="text-secondary" />
        <p className="text-[14px] leading-5 text-secondary">Текстовых различий не обнаружено.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {diff.hunks.length > 1 && (
        <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pb-2 text-[12px] text-secondary">
          <span className="tabular-nums">
            Блок {Math.min(activeHunk + 1, diff.hunks.length)} из {diff.hunks.length}
          </span>
          <button
            type="button"
            aria-label="Предыдущий блок изменений"
            title="Предыдущий блок"
            onClick={() => jumpToHunk(activeHunk - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-full border-none bg-surface text-secondary hover:bg-control hover:text-primary active:scale-95 cursor-pointer"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            aria-label="Следующий блок изменений"
            title="Следующий блок"
            onClick={() => jumpToHunk(activeHunk + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-full border-none bg-surface text-secondary hover:bg-control hover:text-primary active:scale-95 cursor-pointer"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto code-scrollbar px-3 pb-4">
        {diff.warning && (
          <div role="alert" className="rounded-[14px] bg-surface px-4 py-2.5 text-[13.5px] leading-5 text-primary">
            {diff.warning}
          </div>
        )}
        {diff.hunks.map((hunk, i) => (
          <HunkCard
            key={hunk.id}
            hunk={hunk}
            viewMode={viewMode}
            canRevert={canRevertHunk && diff.status !== 'conflicted'}
            reverting={busyHunkIndex === hunk.index}
            onRevert={onRevertHunk ? () => onRevertHunk(hunk.index) : undefined}
            cardRef={(el) => { hunkRefs.current[i] = el }}
          />
        ))}
      </div>
    </div>
  )
}
