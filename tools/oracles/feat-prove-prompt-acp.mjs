#!/usr/bin/env node
/**
 * Oracle cho feat-prove-prompt-acp
 * 
 * Mục tiêu: Chứng minh tập trung prompt và Claude Code ACP hoạt động end-to-end
 * Falsifier: gen-agents tạo agent tham chiếu loop/*-prompt.md, hoặc dispatch.mjs fallback về Kiro khi HARNESS_RUNTIME chưa set
 */

import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const EXPECTED_CONDITIONS = [
  'prompts_centralized_in_prompts_dir',
  'no_legacy_prompts_in_loop',
  'gen_agents_references_correct_paths',
  'dispatch_uses_claude_code_runtime',
  'no_fallback_to_kiro_when_runtime_set',
  'demo_runs_full_path_successfully'
];

/**
 * Điều kiện 1: Tất cả prompt phải được tập trung trong prompts/
 */
function checkPromptsCentralized() {
  const promptsDir = 'prompts';
  const requiredPrompts = ['maker.md', 'checker.md', 'orchestrator.md'];
  
  if (!fs.existsSync(promptsDir)) {
    return { passed: false, reason: `Thư mục ${promptsDir} không tồn tại` };
  }
  
  for (const prompt of requiredPrompts) {
    const promptPath = path.join(promptsDir, prompt);
    if (!fs.existsSync(promptPath)) {
      return { passed: false, reason: `Thiếu prompt: ${promptPath}` };
    }
  }
  
  return { passed: true, reason: 'Tất cả prompt cần thiết đã được tập trung trong prompts/' };
}

/**
 * Điều kiện 2: Không còn legacy prompt trong loop/
 */
function checkNoLegacyPromptsInLoop() {
  const legacyPrompts = ['loop/maker-prompt.md', 'loop/checker-prompt.md'];
  
  for (const legacyPath of legacyPrompts) {
    if (fs.existsSync(legacyPath)) {
      return { passed: false, reason: `Legacy prompt vẫn tồn tại: ${legacyPath}` };
    }
  }
  
  return { passed: true, reason: 'Không còn legacy prompt trong loop/' };
}

/**
 * Điều kiện 3: gen-agents tạo config tham chiếu đúng đường dẫn
 */
function checkGenAgentsReferencesCorrectPaths() {
  try {
    // Chạy gen-agents với --check mode
    const result = execSync('node tools/gen-agents.mjs --target . --runtime claude --check', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Kiểm tra không có tham chiếu đến loop/*-prompt.md
    const hasLegacyPromptReferences = result.includes('loop/') && result.includes('-prompt.md');
    
    if (hasLegacyPromptReferences) {
      return { passed: false, reason: 'gen-agents vẫn tham chiếu legacy prompt paths' };
    }
    
    return { passed: true, reason: 'gen-agents tạo config với đường dẫn prompt đúng' };
  } catch (error) {
    return { passed: false, reason: `gen-agents --check thất bại: ${error.message}` };
  }
}

/**
 * Điều kiện 4: dispatch sử dụng Claude Code runtime
 */
function checkDispatchUsesClaudeRuntime() {
  try {
    // Kiểm tra selectRuntime function với HARNESS_RUNTIME=claude
    const testScript = `
      import { selectRuntime } from './loop/dispatch.mjs';
      const runtime = selectRuntime('claude');
      console.log('selected_runtime:', runtime);
    `;
    
    const result = execSync(`echo "${testScript}" | node --input-type=module`, { 
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HARNESS_RUNTIME: 'claude' }
    });
    
    const usesClaudeRuntime = result.includes('selected_runtime: claude');
    
    if (!usesClaudeRuntime) {
      return { passed: false, reason: 'selectRuntime không trả về claude khi HARNESS_RUNTIME=claude' };
    }
    
    return { passed: true, reason: 'dispatch.mjs chọn Claude Code runtime thành công' };
  } catch (error) {
    return { passed: false, reason: `Kiểm tra dispatch runtime thất bại: ${error.message}` };
  }
}

/**
 * Điều kiện 5: Không fallback về Kiro khi runtime đã set
 */
function checkNoFallbackWhenRuntimeSet() {
  try {
    // Kiểm tra rằng khi HARNESS_RUNTIME=claude, không fallback về kiro
    const testScript = `
      import { selectRuntime } from './loop/dispatch.mjs';
      try {
        const runtime = selectRuntime('claude');
        console.log('runtime_selected:', runtime);
        if (runtime === 'kiro') {
          console.log('ERROR: fallback_to_kiro');
        }
      } catch (error) {
        console.log('ERROR:', error.message);
      }
    `;
    
    const result = execSync(`echo "${testScript}" | node --input-type=module`, { 
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HARNESS_RUNTIME: 'claude' }
    });
    
    const fallsBackToKiro = result.includes('fallback_to_kiro') || result.includes('runtime_selected: kiro');
    
    if (fallsBackToKiro) {
      return { passed: false, reason: 'dispatch.mjs vẫn fallback về Kiro dù HARNESS_RUNTIME đã set' };
    }
    
    return { passed: true, reason: 'Không có fallback về Kiro khi runtime đã được set' };
  } catch (error) {
    return { passed: false, reason: `Kiểm tra fallback thất bại: ${error.message}` };
  }
}

/**
 * Điều kiện 6: Demo chạy thành công toàn bộ đường dẫn
 */
function checkDemoRunsFullPath() {
  try {
    const result = execSync('bash harness-loop/scripts/demo.sh', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const demoSuccess = !result.includes('FAILED') && !result.includes('ERROR');
    
    if (!demoSuccess) {
      return { passed: false, reason: 'demo.sh thất bại hoặc có lỗi' };
    }
    
    return { passed: true, reason: 'Demo chạy thành công toàn bộ đường dẫn' };
  } catch (error) {
    return { passed: false, reason: `Demo execution thất bại: ${error.message}` };
  }
}

/**
 * Chạy tất cả điều kiện kiểm tra
 */
function runOracle() {
  const conditions = [
    { name: 'prompts_centralized_in_prompts_dir', check: checkPromptsCentralized },
    { name: 'no_legacy_prompts_in_loop', check: checkNoLegacyPromptsInLoop },
    { name: 'gen_agents_references_correct_paths', check: checkGenAgentsReferencesCorrectPaths },
    { name: 'dispatch_uses_claude_code_runtime', check: checkDispatchUsesClaudeRuntime },
    { name: 'no_fallback_to_kiro_when_runtime_set', check: checkNoFallbackWhenRuntimeSet },
    { name: 'demo_runs_full_path_successfully', check: checkDemoRunsFullPath }
  ];
  
  const results = [];
  let allPassed = true;
  
  for (const condition of conditions) {
    console.log(`\nKiểm tra: ${condition.name}`);
    const result = condition.check();
    results.push({ condition: condition.name, ...result });
    
    console.log(`${result.passed ? '✅' : '❌'} ${result.reason}`);
    
    if (!result.passed) {
      allPassed = false;
    }
  }
  
  console.log(`\n${allPassed ? '🎉' : '💥'} Oracle kết quả: ${results.filter(r => r.passed).length}/${results.length} điều kiện đạt`);
  
  return {
    passed: allPassed,
    results: results,
    summary: `${results.filter(r => r.passed).length}/${results.length} conditions passed`
  };
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runOracle();
  process.exit(result.passed ? 0 : 1);
}

export { runOracle, EXPECTED_CONDITIONS };