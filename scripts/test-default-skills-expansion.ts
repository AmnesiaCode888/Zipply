import assert from 'assert'
import { DEFAULT_SKILLS, DEFAULT_SKILLS_VERSION } from '../src/main/agent/services/DefaultSkillsData'
import { SkillService } from '../src/main/agent/services/SkillService'

console.log('🧪 Starting Default Skills Expansion Verification...\n')

async function run() {
  console.log(`▶ Verifying DEFAULT_SKILLS_VERSION: ${DEFAULT_SKILLS_VERSION}`)
  assert.ok(DEFAULT_SKILLS_VERSION >= 2, 'DEFAULT_SKILLS_VERSION should be >= 2')

  console.log(`▶ Verifying total count of default skills: ${DEFAULT_SKILLS.length}`)
  assert.ok(DEFAULT_SKILLS.length >= 15, `Expected at least 15 skills, got ${DEFAULT_SKILLS.length}`)

  const requiredSkillNames = [
    'tool-file-mastery',
    'tool-terminal-mastery',
    'tool-grep-mastery',
    'tool-web-intelligence',
    'tool-subagents-swarm',
    'tool-skills-and-learning',
    'tool-memory-compass',
    'tool-mcp-integration',
    'tool-schedule-automation',
    'when-stuck',
    'systematic-debugging',
    'web-research-troubleshooting',
    'test-driven-development',
    'frontend-modern-web',
    'backend-api-architecture',
    'database-migrations-sql',
    'performance-profiling',
    'code-standards',
    'git-workflows',
    'docker-management',
    'mcp-builder',
    'chat-history-reflection',
    'skills-continuous-evolution'
  ]

  const skillNameSet = new Set<string>()

  for (const item of DEFAULT_SKILLS) {
    assert.ok(item.fileName.endsWith('.md'), `File name must end with .md: ${item.fileName}`)
    const parsed = SkillService.parseRawContent(item.content)
    const name = parsed.metadata.name || item.fileName.replace('.md', '')
    skillNameSet.add(name)

    assert.ok(parsed.metadata.description && parsed.metadata.description.length > 10, `Skill ${name} must have a description`)
    assert.ok(Array.isArray(parsed.metadata.triggers) && parsed.metadata.triggers.length >= 3, `Skill ${name} must have at least 3 triggers`)
    assert.ok(Array.isArray(parsed.metadata.tags) && parsed.metadata.tags.length >= 1, `Skill ${name} must have tags`)
    assert.ok(parsed.body && parsed.body.length > 150, `Skill ${name} must have detailed body content`)
  }

  for (const req of requiredSkillNames) {
    assert.ok(skillNameSet.has(req), `Missing required skill: ${req}`)
  }

  console.log('  ✅ All required skills present with valid frontmatter, triggers, and body.\n')

  // Task 2: Verify SkillService seeding and retrieval
  console.log('▶ Verifying Task 2: SkillService.init() and seeding...')
  SkillService.init()

  const allSkills = SkillService.getAllSkills()
  console.log(`  Loaded ${allSkills.length} total skills via SkillService`)
  assert.ok(allSkills.length >= 21, `Expected at least 21 skills in SkillService, found ${allSkills.length}`)

  for (const req of requiredSkillNames) {
    const found = allSkills.find((s) => s.name.toLowerCase() === req.toLowerCase())
    assert.ok(found, `SkillService must discover seeded skill: ${req}`)
  }
  console.log('  ✅ All 21 default skills successfully seeded and discovered by SkillService.\n')

  // Verify search on troubleshooting queries
  console.log('▶ Verifying Search on "запуталась" / "не знаю что делать"...')
  const stuckSearchResults = await SkillService.searchSkillsAsync('я запуталась и не знаю что делать дальше', { limit: 3 })
  assert.ok(stuckSearchResults.length > 0, 'Search should find skills for stuck query')
  const topStuck = stuckSearchResults[0]
  assert.strictEqual(topStuck.name, 'when-stuck', `Top skill for stuck query should be when-stuck, got ${topStuck.name}`)
  console.log(`  ✅ Top skill for stuck query: ${topStuck.name} (${topStuck.similarityScore}% match, ${topStuck.matchReason})\n`)

  // Verify search on tool file queries
  console.log('▶ Verifying Search on "как безопасно отредактировать файл"...')
  const fileSearchResults = await SkillService.searchSkillsAsync('как безопасно отредактировать файл и сделать diff', { limit: 3 })
  assert.ok(fileSearchResults.length > 0, 'Search should find skills for file editing query')
  const topFile = fileSearchResults[0]
  assert.strictEqual(topFile.name, 'tool-file-mastery', `Top skill for file edit query should be tool-file-mastery, got ${topFile.name}`)
  console.log(`  ✅ Top skill for file query: ${topFile.name} (${topFile.similarityScore}% match, ${topFile.matchReason})\n`)

  // Verify search on past chats reflection
  console.log('▶ Verifying Search on "посмотреть прошлые чаты"...')
  const chatSearchResults = await SkillService.searchSkillsAsync('посмотреть прошлые чаты и сессии ретроспектива', { limit: 3 })
  assert.ok(chatSearchResults.length > 0, 'Search should find skills for chat history query')
  const topChat = chatSearchResults[0]
  assert.strictEqual(topChat.name, 'chat-history-reflection', `Top skill for chat history query should be chat-history-reflection, got ${topChat.name}`)
  console.log(`  ✅ Top skill for chat history query: ${topChat.name} (${topChat.similarityScore}% match, ${topChat.matchReason})\n`)

  // Verify search on continuous evolution
  console.log('▶ Verifying Search on "улучшить свои навыки на основе диалогов"...')
  const evoSearchResults = await SkillService.searchSkillsAsync('улучшить свои навыки на основе диалогов самообучение', { limit: 3 })
  assert.ok(evoSearchResults.length > 0, 'Search should find skills for evolution query')
  const topEvo = evoSearchResults[0]
  assert.strictEqual(topEvo.name, 'skills-continuous-evolution', `Top skill for evolution query should be skills-continuous-evolution, got ${topEvo.name}`)
  console.log(`  ✅ Top skill for evolution query: ${topEvo.name} (${topEvo.similarityScore}% match, ${topEvo.matchReason})\n`)

  // Verify MemoryTool action="sessions"
  console.log('▶ Verifying Task: MemoryTool action="sessions"...')
  const { MemoryTool } = await import('../src/main/agent/tools/MemoryTool')
  const memoryTool = new MemoryTool()
  const memResult = await memoryTool.execute(JSON.stringify({ action: 'sessions' }), null as any)
  assert.ok(memResult.formattedContent && memResult.formattedContent.length > 0, 'MemoryTool sessions action should return content')
  console.log('  ✅ MemoryTool: action="sessions" executed cleanly.\n')

  console.log('🎉 Task 1 & 2 verification passed cleanly!\n')

  // Task 3: Verify Cognitive Protocol in PromptProviders
  console.log('▶ Verifying Task 3: Cognitive & Operational Protocols in PromptProviders...')
  const { IdentityProvider, SkillsProvider, SandwichReminderProvider } = await import('../src/main/agent/core/PromptProviders')

  const identityPrompt = IdentityProvider.render({ agentId: 'zipply' })
  assert.ok(identityPrompt.includes('Perplexity, Stuck & Troubleshooting Protocol'), 'Identity prompt should contain Perplexity & Troubleshooting Protocol')
  assert.ok(identityPrompt.includes('Tier 1 (Skills First)'), 'Identity prompt should include Tier 1 Skills First')
  assert.ok(identityPrompt.includes('Tier 2 (Web Intelligence)'), 'Identity prompt should include Tier 2 Web Intelligence')
  assert.ok(identityPrompt.includes('Tier 3 (Environment Inspection & Delegation)'), 'Identity prompt should include Tier 3 Environment Inspection')
  assert.ok(identityPrompt.includes('read_terminal'), 'Identity prompt should reference read_terminal')
  console.log('  ✅ IdentityProvider: Two-Tier Troubleshooting Reflex verified.')

  const skillsPrompt = SkillsProvider.render({
    agentId: 'zipply',
    coreSkillsPrompt: '### [CORE-SKILL: code-standards]',
    extraSkillsCatalogPrompt: '<available_skills/>'
  })
  assert.ok(skillsPrompt && skillsPrompt.includes('On-Demand Procedural Skills'), 'SkillsProvider should instruct on using procedural skills')
  assert.ok(skillsPrompt.includes('read_skill') && skillsPrompt.includes('search_skills'), 'SkillsProvider should mention read_skill and search_skills')
  console.log('  ✅ SkillsProvider: On-Demand Procedural Skills directive verified.')

  const reminderPrompt = SandwichReminderProvider.render({ agentId: 'zipply' })
  assert.ok(reminderPrompt.includes('search skills (search_skills) or search the web (web_search)'), 'SandwichReminderProvider should remind about searching skills/web')
  console.log('  ✅ SandwichReminderProvider: Stuck recovery reminder verified.\n')

  console.log('🎉 ALL TASKS (1, 2, 3) VERIFICATION PASSED SUCCESSFULLY!')
}

run().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
