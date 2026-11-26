import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, MessageCircleQuestion } from '../../icons'
import type { QuestionAnswer, QuestionItem, QuestionRequest } from '../../../../shared/agentEvents'

interface UserQuestionProps {
  question: { questionId: string } & QuestionRequest
  onAnswer?: (answer: QuestionAnswer) => void
}

const optionClass = 'group flex w-full min-w-0 items-center gap-3 rounded-[16px] bg-control px-4 py-2.5 text-left text-[15.5px] leading-[23px] text-primary border-none shadow-none cursor-pointer hover:bg-control-hover active:scale-[0.99] transition-colors break-words'
const inputClass = 'mt-2 w-full resize-y rounded-[16px] bg-surface-secondary px-4 py-2.5 text-[15.5px] leading-[23px] text-primary placeholder:text-secondary border-none outline-none shadow-none'
const optionGridStyle: React.CSSProperties = { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))' }
const secondaryButtonClass = 'rounded-full bg-control px-5 py-2.5 text-[15px] font-medium text-secondary border-none shadow-none cursor-pointer hover:bg-control-hover active:scale-95 transition-colors'
const primaryButtonClass = 'rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-on-accent border-none shadow-none cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default disabled:hover:bg-accent active:scale-95 transition-colors'

export const UserQuestion: React.FC<UserQuestionProps> = ({ question, onAnswer }) => {
  if ('questions' in question) return <QuestionGroup questions={question.questions} onAnswer={onAnswer} />
  return <SingleQuestion question={question} onAnswer={onAnswer} />
}

const Header: React.FC<{ count?: string; titleId?: string }> = ({ count, titleId }) => (
  <div className="flex items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-control text-primary"><MessageCircleQuestion size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <span id={titleId} className="text-[15px] font-medium text-secondary">Нужно уточнение</span>
    </div>
    {count && <span className="shrink-0 rounded-full bg-control px-3 py-1.5 text-[13px] font-medium tabular-nums text-secondary">{count}</span>}
  </div>
)

const SingleQuestion: React.FC<{ question: QuestionItem; onAnswer?: (answer: QuestionAnswer) => void }> = ({ question, onAnswer }) => {
  const [text, setText] = useState('')
  return (
    <div className="flex w-full min-h-0 justify-center px-4 pb-3" role="dialog" aria-labelledby="user-question-title" aria-live="polite" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onAnswer?.(null) } }}>
      <form className="flex w-full min-h-0 max-w-[760px] max-h-[min(55vh,560px)] flex-col overflow-y-auto rounded-[24px] bg-surface border-none shadow-none" onSubmit={event => { event.preventDefault(); if (text.trim()) onAnswer?.(text.trim()) }}>
        <div className="shrink-0 px-5 pt-4"><Header /></div>
        <div className="question-content min-h-0 overflow-y-auto overscroll-contain code-scrollbar px-5">
          <h2 id="user-question-title" className="mt-3 text-[19px] leading-[27px] font-semibold text-primary break-words">{question.question}</h2>
          {question.options.some(option => !isCustomOption(option)) && <div className="mt-3 grid gap-2" style={optionGridStyle}>
            {question.options.filter(option => !isCustomOption(option)).map((option, index) => <button key={index} type="button" onClick={() => onAnswer?.(option)} className={optionClass}><span className="min-w-0 flex-1">{option}</span><ArrowUpRight size={17} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-muted group-hover:text-primary" /></button>)}
          </div>}
          <label htmlFor="user-question-answer" className="mt-3 block text-[14px] font-medium text-secondary">Свой ответ</label>
          <textarea id="user-question-answer" value={text} onChange={event => setText(event.target.value)} maxLength={4000} rows={1} placeholder="Напишите ответ" className={inputClass} />
        </div>
        <div className="flex shrink-0 justify-end gap-2 px-5 py-3">
          <button type="button" onClick={() => onAnswer?.(null)} className={secondaryButtonClass}>Пропустить</button>
          <button type="submit" disabled={!text.trim()} className={primaryButtonClass}>Ответить</button>
        </div>
      </form>
    </div>
  )
}

function isCustomOption(option: string): boolean {
  return /^свой ответ[.!]?$/i.test(option.trim())
}

const QuestionGroup: React.FC<{ questions: QuestionItem[]; onAnswer?: (answer: QuestionAnswer) => void }> = ({ questions, onAnswer }) => {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  const [selected, setSelected] = useState<Array<number | null>>(() => questions.map(() => null))
  const [step, setStep] = useState(0)
  const setAnswer = (index: number, value: string, optionIndex: number | null): void => {
    setAnswers(current => current.map((answer, i) => i === index ? value : answer))
    setSelected(current => current.map((choice, i) => i === index ? optionIndex : choice))
  }
  const complete = answers.every(answer => answer.trim().length > 0)
  const current = questions[step]
  const last = step === questions.length - 1
  return (
    <div className="flex w-full min-h-0 justify-center px-4 pb-3" role="dialog" aria-labelledby="question-group-title" aria-live="polite" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onAnswer?.(null) } }}>
      <form className="flex w-full min-h-0 max-w-[760px] max-h-[min(55vh,560px)] flex-col overflow-y-auto rounded-[24px] bg-surface border-none shadow-none" onSubmit={event => { event.preventDefault(); if (!last && answers[step].trim()) setStep(step + 1); else if (last && complete) onAnswer?.(answers.map(answer => answer.trim())) }}>
        <div className="shrink-0 px-5 pt-5"><Header titleId="question-group-title" count={`${step + 1} из ${questions.length}`} /></div>
        <div className="question-content min-h-0 overflow-y-auto overscroll-contain code-scrollbar px-5 pb-1">
          <fieldset key={step} className="min-w-0 pt-4 border-none">
            <legend className="sr-only">{current.question}</legend>
            <p aria-hidden="true" className="text-[19px] leading-[27px] font-semibold text-primary break-words">{current.question}</p>
            {current.options.some(option => !isCustomOption(option)) && <div className="mt-3 grid gap-2" style={optionGridStyle}>
              {current.options.map((option, optionIndex) => isCustomOption(option) ? null : <button key={optionIndex} type="button" aria-pressed={selected[step] === optionIndex} onClick={() => setAnswer(step, option, optionIndex)} className={`${optionClass} ${selected[step] === optionIndex ? 'bg-control-hover' : ''}`}><span className="min-w-0 flex-1">{option}</span>{selected[step] === optionIndex && <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"><Check size={14} strokeWidth={2.5} /></span>}</button>)}
            </div>}
            <label htmlFor={`question-group-answer-${step}`} className="mt-4 block text-[14px] font-medium text-secondary">Свой ответ<span className="sr-only">: {current.question}</span></label>
            <textarea id={`question-group-answer-${step}`} value={selected[step] === null ? answers[step] : ''} onChange={event => setAnswer(step, event.target.value, null)} maxLength={4000} rows={2} placeholder="Напишите ответ" className={`${inputClass} bg-control`} />
          </fieldset>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
          <button type="button" onClick={() => onAnswer?.(null)} className={secondaryButtonClass}>Пропустить</button>
          <div className="flex shrink-0 gap-2">
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className={`${secondaryButtonClass} flex items-center gap-2`}><ArrowLeft size={16} aria-hidden="true" /><span>Назад</span></button>}
            <button type="submit" disabled={last ? !complete : !answers[step].trim()} className={`${primaryButtonClass} flex items-center gap-2`}>{last ? 'Ответить' : 'Далее'}{!last && <ArrowRight size={16} aria-hidden="true" />}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
