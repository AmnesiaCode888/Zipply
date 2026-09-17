import assert from 'assert'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { SkillService } from '../src/main/agent/services/SkillService'

console.log('🧪 Starting Skills Sections & Transfer Verification...\n')

async function run() {
  // Test 1: Category resolution and assignment
  console.log('▶ Test 1: Verifying skill category assignment...')
  const skills = SkillService.getAllSkills()
  assert.ok(skills.length > 0, 'Should load skills')

  const categories = new Set(skills.map((s) => s.category || 'uncategorized'))
  console.log(`  Found categories: ${Array.from(categories).join(', ')}`)
  assert.ok(categories.has('system') || categories.has('tools') || categories.has('engineering'), 'Should have core/system/tools/engineering categories')

  for (const s of skills) {
    assert.ok(s.category, `Skill ${s.name} should have a category`)
    assert.ok(s.categoryLabel, `Skill ${s.name} should have a categoryLabel`)
  }
  console.log('  ✅ Category assignment verified.\n')

  // Test 2: Category bulk enable/disable
  console.log('▶ Test 2: Verifying toggleCategoryEnabled...')
  const testCategory = 'tools'
  const toolsSkills = skills.filter((s) => s.category === testCategory)
  assert.ok(toolsSkills.length > 0, `Should have skills in category '${testCategory}'`)

  // Disable category
  const disableRes = SkillService.toggleCategoryEnabled(testCategory, false)
  assert.strictEqual(disableRes.success, true, 'toggleCategoryEnabled(false) should succeed')
  
  const disabledSkillsAfter = SkillService.getAllSkills()
  const disabledTools = disabledSkillsAfter.filter((s) => s.category === testCategory)
  for (const s of disabledTools) {
    assert.strictEqual(s.enabled, false, `Skill ${s.name} should be disabled`)
  }
  console.log(`  Successfully disabled all ${disabledTools.length} skills in '${testCategory}'`)

  // Re-enable category
  const enableRes = SkillService.toggleCategoryEnabled(testCategory, true)
  assert.strictEqual(enableRes.success, true, 'toggleCategoryEnabled(true) should succeed')

  const enabledSkillsAfter = SkillService.getAllSkills()
  const enabledTools = enabledSkillsAfter.filter((s) => s.category === testCategory)
  for (const s of enabledTools) {
    assert.strictEqual(s.enabled, true, `Skill ${s.name} should be re-enabled`)
  }
  console.log(`  Successfully re-enabled all ${enabledTools.length} skills in '${testCategory}'`)
  console.log('  ✅ toggleCategoryEnabled verified.\n')

  // Test 3: Transfer skills into Zipply library
  console.log('▶ Test 3: Verifying transferSkills...')
  const tempSrcDir = path.join(os.tmpdir(), `test-codex-${Date.now()}`)
  fs.mkdirSync(tempSrcDir, { recursive: true })

  // Create a dummy Codex single skill and folder skill
  const dummyFile = path.join(tempSrcDir, 'codex-sample.md')
  fs.writeFileSync(dummyFile, '---\nname: codex-sample\ndescription: A sample skill from codex\ntriggers: ["codex", "sample"]\n---\n# Instructions\nDo sample work.', 'utf-8')

  const dummyFolder = path.join(tempSrcDir, 'codex-package-skill')
  fs.mkdirSync(path.join(dummyFolder, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(dummyFolder, 'SKILL.md'), '---\nname: codex-package-skill\ndescription: A package skill with scripts\ntriggers: ["package", "scripts"]\n---\n# Package Instructions\nExecute script.', 'utf-8')
  fs.writeFileSync(path.join(dummyFolder, 'scripts', 'run.sh'), 'echo "running"', 'utf-8')

  const transferItems = [
    { name: 'codex-sample', sourcePath: dummyFile, isFolder: false },
    { name: 'codex-package-skill', sourcePath: dummyFolder, isFolder: true }
  ]

  const transferRes = SkillService.transferSkills(transferItems, 'custom', false)
  assert.strictEqual(transferRes.success, true, 'transferSkills should succeed')
  assert.strictEqual(transferRes.count, 2, 'Should transfer 2 skills')

  // Verify transferred skills exist in Zipply
  const afterTransferSkills = SkillService.getAllSkills()
  const sampleSkill = afterTransferSkills.find((s) => s.name === 'codex-sample')
  const packageSkill = afterTransferSkills.find((s) => s.name === 'codex-package-skill')

  assert.ok(sampleSkill, 'codex-sample should be found in library')
  assert.ok(packageSkill, 'codex-package-skill should be found in library')
  assert.strictEqual(packageSkill?.isFolder, true, 'codex-package-skill should remain a folder skill')
  assert.ok(packageSkill?.files && packageSkill.files.includes('scripts/run.sh'), 'Folder skill should preserve internal scripts')
  console.log('  Transferred skills verified with file and folder preservation.')

  // Cleanup transferred test skills
  SkillService.deleteSkill('codex-sample')
  SkillService.deleteSkill('codex-package-skill')
  fs.rmSync(tempSrcDir, { recursive: true, force: true })
  console.log('  ✅ transferSkills verified.\n')

  // Test 4: System prompt ontology catalog
  console.log('▶ Test 4: Verifying ontology in getStableSkillsCatalogPrompt...')
  const prompt = SkillService.getStableSkillsCatalogPrompt()
  assert.ok(prompt.includes('<skills_ontology>'), 'Prompt must include <skills_ontology>')
  assert.ok(prompt.includes('<category'), 'Prompt must list categories')
  console.log('  ✅ Ontology prompt verified.\n')

  console.log('🎉 ALL SKILLS SECTIONS & TRANSFER TESTS PASSED SUCCESSFULLY!')
}

run().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
