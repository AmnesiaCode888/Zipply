const POLITE_PREFIX_RE = /^(?:please|pls|now|then|ok|okay|пожалуйста|теперь|сейчас|тогда|ок|ладно|хорошо|can you|could you|would you|will you|help me|let's|lets|try to|need to|we need to|i need you to|можешь|сможешь|можете|попробуй|давай|давайте|нужно|надо|помоги|прошу|хочу чтобы ты)[,\s]+/i

const RU_END = '(?=\\s|[.!?,:;]|$)'
const NO_EDITS_EN_RE = /\b(?:(?:do not|don't|dont|never|avoid|without)\s+(?:edit|change|modify|write|touch|update|fix|refactor)|(?:just|only)\s+(?:explain|review|analyze|inspect|check|read|look|describe|summarize|answer|tell)|read[- ]?only|(?:no|without)\s+(?:edits|changes|modifications))\b/i
const NO_EDITS_RU_RE = /(?:не\s+(?:меняй|правь|изменяй|трогай|редактируй|пиши|обновляй|удаляй|фикси|чини)|без\s+(?:правок|изменений|редактирования|записи|кода)|(?:только|просто|лишь)\s+(?:объясни|проанализируй|проверь|посмотри|глянь|расскажи|опиши|подскажи|ответь|(?:сделай|проведи)\s+ревью)|только\s+(?:чтение|анализ))/i

const QUESTION_OR_EXPLAIN_START_RE = new RegExp(
  `^(?:(?:how|why|what|when|where|which|explain|describe|tell me|show me)\\b|(?:как|почему|зачем|что|где|когда|какой|объясни|расскажи|опиши|подскажи|покажи)${RU_END})`,
  'i'
)

const META_OR_REVIEW_REQUEST_RE = new RegExp(
  [
    // Code reviews / audits / summaries in chat
    `^(?:(?:сделай|проведи|напиши)\\s+(?:ревью|обзор|анализ|разбор|аудит|саммари)${RU_END}|(?:do|make|write)\\s+(?:a\\s+)?(?:code\\s+)?review\\b|code\\s+review\\b|review\\b)`,
    // Writing/adding/creating explanations, plans, summaries, or chat-only text
    `^(?:напиши|создай|добавь|сделай)\\s+(?:в\\s+(?:чат|ответе|ответ)|текстом|словами|кратк[ои]|подробн[оы]|пояснени|объяснени|инструкци|ответ|резюме|план|замечания|список)`,
    `^(?:напиши|write)[,\\s]+(?:как|почему|зачем|что|how|why|what)(?:\\b|${RU_END})`,
    `^(?:write|add|create)\\s+(?:in\\s+(?:chat|reply|response)|to\\s+(?:your\\s+)?(?:reply|response|context)|a\\s+(?:summary|explanation|review|list|description|plan)\\b)`,
    // Changing answer tone/format or updating the user on status
    `^(?:измени|обнови|поменяй|исправь)\\s+(?:формат|тон|стиль|язык|формулировку)(?:\\s|$)`,
    `^(?:change|update|fix)\\s+(?:the\\s+)?(?:tone|format|style|language|wording)\\s+(?:of\\s+)?(?:your\\s+)?(?:answer|response|reply)`,
    `^(?:добавь|add)\\s+(?:в\\s+контекст|к\\s+ответу|to\\s+context)(?:\\b|${RU_END})`,
    `^(?:обнови|update)\\s+(?:меня|нас|me|us)\\s+(?:по|о|on)(?:\\b|${RU_END})`
  ].join('|'),
  'i'
)

const DIRECT_EDIT_EN_RE = /^(?:fix|implement|add|create|modify|update|change|remove|delete|refactor|rename|migrate|edit|patch|rewrite|extract|split|move|replace)\b/i
const DIRECT_EDIT_RU_RE = new RegExp(
  `^(?:исправь|исправить|исправим|фикси|пофикси|пофиксить|пофиксим|почини|починить|починим|поправь|поправить|поправим|реализуй|реализовать|реализуем|добавь|добавить|добавим|создай|создать|создадим|измени|изменить|изменим|поменяй|поменять|поменяем|обнови|обновить|обновим|удали|удалить|удалим|убери|убрать|убер[её]м|переименуй|переименовать|переименуем|перепиши|переписать|перепишем|отрефактори|отрефакторить|отрефакторим|рефактори|разбей|разбить|разобь[её]м|вынеси|вынести|вынесем|перенеси|перенести|перенес[её]м|допили|допилить|допилим|внедри|внедрить|внедрим)${RU_END}`,
  'i'
)

const ARTIFACT_WRITE_VERB_RE = /^(?:write\b|make\b|wire\b|setup\b|set\s+up\b|configure\b|(?:напиши|напишем|сделай|сделаем|подключи|подключить|подключим|настрой|настроить|настроим)\s)/i
const ARTIFACT_TARGET_RE = /(?:\b(?:code|file|function|class|method|script|app|test|config|component|hook|module|endpoint|route)\b|код|файл|функци|метод|класс|скрипт|приложени|тест|конфиг|компонент|хук|модул|эндпоинт|роут|\.[a-z0-9]{1,8}\b)/i

function stripPolitePrefixes(text: string): string {
  let current = text.trim()
  for (let i = 0; i < 4; i++) {
    const next = current.replace(POLITE_PREFIX_RE, '').trim()
    if (next === current) break
    current = next
  }
  return current
}

/**
 * Returns true when the user explicitly asks for read-only inspection or forbids edits.
 */
export function requestsNoEdits(text: string): boolean {
  return NO_EDITS_EN_RE.test(text) || NO_EDITS_RU_RE.test(text)
}

/**
 * Heuristically determines whether a user message requests modifying workspace files.
 */
export function requestsWorkspaceChange(text: string): boolean {
  if (!text || requestsNoEdits(text)) return false
  const request = stripPolitePrefixes(text)
  if (!request) return false
  if (QUESTION_OR_EXPLAIN_START_RE.test(request)) return false
  if (META_OR_REVIEW_REQUEST_RE.test(request)) return false
  if (DIRECT_EDIT_EN_RE.test(request) || DIRECT_EDIT_RU_RE.test(request)) return true
  return ARTIFACT_WRITE_VERB_RE.test(request) && ARTIFACT_TARGET_RE.test(request)
}

/**
 * Resolves whether the current run expects workspace mutations given tool capability, goal, and steer corrections.
 */
export function resolveExpectsWorkspaceChange(
  latestGoal: string,
  corrections: readonly string[],
  canChangeWorkspace: boolean
): boolean {
  if (!canChangeWorkspace) return false
  const latestIntent = corrections.findLast(text => requestsNoEdits(text) || requestsWorkspaceChange(text)) ?? latestGoal
  return requestsWorkspaceChange(latestIntent)
}
