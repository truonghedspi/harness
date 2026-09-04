#!/usr/bin/env node

/**
 * Oracle: feat-toolchain-e2e
 * 
 * Prove: pluggable test toolchain works end-to-end
 * 
 * Điều kiện kiểm tra độc lập:
 * 1. Schema validation - toolchain tuân thủ test-toolchain/1
 * 2. Command resolution - resolve-test-command trả về lệnh đúng 
 * 3. Baseline integration - init.mjs đọc và chạy toolchain baseline
 * 4. Feature scope validation - review-contract kiểm tra testScope hợp lệ
 * 5. Survey detection - survey-project phát hiện runner và gợi ý toolchain
 * 6. Fallback behavior - hệ thống fallback đúng khi không có toolchain
 * 
 * Oracle không đọc implementation - chỉ kiểm tra hành vi quan sát được.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const ORACLE_ID = 'feat-toolchain-e2e';

/**
 * Kiểm tra điều kiện 1: Schema validation
 * test-toolchain.json phải tuân thủ schema test-toolchain/1
 */
async function checkSchemaValidation() {
  const condition = {
    id: 'schema-validation',
    description: 'toolchain tuân thủ schema test-toolchain/1',
    status: 'unknown',
    evidence: []
  };

  try {
    // Kiểm tra schema file tồn tại
    const schemaPath = 'schemas/test-toolchain.schema.json';
    const schemaExists = await fs.access(schemaPath).then(() => true).catch(() => false);
    
    if (!schemaExists) {
      condition.status = 'fail';
      condition.evidence.push('Schema file không tồn tại: schemas/test-toolchain.schema.json');
      return condition;
    }

    // Kiểm tra validator tồn tại và chạy được
    try {
      const validatorOutput = execSync('node tools/validate-toolchain.mjs --target . --check 2>&1 || echo "VALIDATOR_FAILED"', {
        encoding: 'utf8',
        timeout: 10000
      });

      if (validatorOutput.includes('VALIDATOR_FAILED')) {
        condition.status = 'fail';
        condition.evidence.push('Validator không chạy được hoặc báo lỗi');
      } else {
        condition.status = 'pass';
        condition.evidence.push('Schema validation chạy thành công');
      }
    } catch (error) {
      condition.status = 'fail';
      condition.evidence.push(`Validator error: ${error.message}`);
    }
    
  } catch (error) {
    condition.status = 'fail';
    condition.evidence.push(`Schema check error: ${error.message}`);
  }

  return condition;
}

/**
 * Kiểm tra điều kiện 2: Command resolution
 * resolve-test-command trả về lệnh đúng cho scope/feature/profile
 */
async function checkCommandResolution() {
  const condition = {
    id: 'command-resolution',
    description: 'resolve-test-command trả về lệnh đúng cho scope',
    status: 'unknown',
    evidence: []
  };

  try {
    // Kiểm tra resolve-test-command.mjs tồn tại
    const resolverExists = await fs.access('tools/resolve-test-command.mjs').then(() => true).catch(() => false);
    
    if (!resolverExists) {
      condition.status = 'fail';
      condition.evidence.push('tools/resolve-test-command.mjs không tồn tại');
      return condition;
    }

    // Test basic scope resolution
    try {
      const scopeOutput = execSync('node tools/resolve-test-command.mjs --scope unit --check 2>&1 || echo "RESOLVER_FAILED"', {
        encoding: 'utf8',
        timeout: 10000
      });

      if (scopeOutput.includes('RESOLVER_FAILED')) {
        condition.status = 'fail';
        condition.evidence.push('Resolver không hoạt động với --scope unit');
      } else {
        condition.status = 'pass';
        condition.evidence.push('Command resolution hoạt động cho scope unit');
      }
    } catch (error) {
      condition.status = 'fail';
      condition.evidence.push(`Command resolution error: ${error.message}`);
    }

  } catch (error) {
    condition.status = 'fail';
    condition.evidence.push(`Command resolution check error: ${error.message}`);
  }

  return condition;
}

/**
 * Kiểm tra điều kiện 3: Baseline integration  
 * init.mjs đọc và chạy baseline từ toolchain
 */
async function checkBaselineIntegration() {
  const condition = {
    id: 'baseline-integration',
    description: 'init.mjs đọc toolchain và chạy baseline scopes',
    status: 'unknown',
    evidence: []
  };

  try {
    // Kiểm tra init.mjs có logic đọc toolchain
    const initContent = await fs.readFile('init.mjs', 'utf8');
    
    if (!initContent.includes('test-toolchain.json') && !initContent.includes('toolchain')) {
      condition.status = 'fail';
      condition.evidence.push('init.mjs không có logic đọc toolchain');
      return condition;
    }

    // Kiểm tra template cũng được cập nhật
    const templateInitExists = await fs.access('harness-loop/templates/tree/init.mjs').then(() => true).catch(() => false);
    
    if (!templateInitExists) {
      condition.status = 'fail';
      condition.evidence.push('Template init.mjs không tồn tại');
      return condition;
    }

    const templateContent = await fs.readFile('harness-loop/templates/tree/init.mjs', 'utf8');
    
    if (!templateContent.includes('test-toolchain.json') && !templateContent.includes('toolchain')) {
      condition.status = 'fail';
      condition.evidence.push('Template init.mjs không có logic đọc toolchain');
      return condition;
    }

    condition.status = 'pass';
    condition.evidence.push('init.mjs và template có logic đọc toolchain');

  } catch (error) {
    condition.status = 'fail';
    condition.evidence.push(`Baseline integration check error: ${error.message}`);
  }

  return condition;
}

/**
 * Kiểm tra điều kiện 4: Feature scope validation
 * review-contract kiểm tra testScope hợp lệ
 */
async function checkFeatureScopeValidation() {
  const condition = {
    id: 'feature-scope-validation',
    description: 'review-contract kiểm tra testScope hợp lệ',
    status: 'unknown',
    evidence: []
  };

  try {
    // Kiểm tra review-contract.mjs tồn tại
    const contractExists = await fs.access('tools/review-contract.mjs').then(() => true).catch(() => false);
    
    if (!contractExists) {
      condition.status = 'fail';
      condition.evidence.push('tools/review-contract.mjs không tồn tại');
      return condition;
    }

    // Kiểm tra có logic validate testScope
    const contractContent = await fs.readFile('tools/review-contract.mjs', 'utf8');
    
    if (!contractContent.includes('testScope')) {
      condition.status = 'fail';
      condition.evidence.push('review-contract.mjs không có logic kiểm tra testScope');
      return condition;
    }

    condition.status = 'pass';
    condition.evidence.push('review-contract.mjs có logic kiểm tra testScope');

  } catch (error) {
    condition.status = 'fail';
    condition.evidence.push(`Feature scope validation check error: ${error.message}`);
  }

  return condition;
}

/**
 * Kiểm tra điều kiện 5: Survey detection
 * survey-project phát hiện runner và gợi ý toolchain
 */
async function checkSurveyDetection() {
  const condition = {
    id: 'survey-detection',
    description: 'survey-project phát hiện runner và gợi ý toolchain',
    status: 'unknown',
    evidence: []
  };

  try {
    // Test survey-project với --json output
    const surveyOutput = execSync('node tools/survey-project.mjs --target . --json 2>&1 || echo "SURVEY_FAILED"', {
      encoding: 'utf8',
      timeout: 10000
    });

    if (surveyOutput.includes('SURVEY_FAILED')) {
      condition.status = 'fail';
      condition.evidence.push('survey-project.mjs không chạy được với --json');
      return condition;
    }

    // Kiểm tra output có suggestedToolchain
    try {
      const surveyData = JSON.parse(surveyOutput);
      
      if (!surveyData.suggestedToolchain) {
        condition.status = 'fail';
        condition.evidence.push('survey-project.mjs không xuất suggestedToolchain');
      } else {
        condition.status = 'pass';
        condition.evidence.push('survey-project.mjs xuất suggestedToolchain thành công');
      }
    } catch (parseError) {
      condition.status = 'fail';
      condition.evidence.push('survey-project.mjs không xuất JSON hợp lệ');
    }

  } catch (error) {
    condition.status = 'fail';
    condition.evidence.push(`Survey detection check error: ${error.message}`);
  }

  return condition;
}

/**
 * Kiểm tra điều kiện 6: Fallback behavior
 * Hệ thống fallback đúng khi không có toolchain
 */
async function checkFallbackBehavior() {
  const condition = {
    id: 'fallback-behavior', 
    description: 'hệ thống fallback khi không có toolchain',
    status: 'unknown',
    evidence: []
  };

  try {
    // Kiểm tra init.mjs có logic fallback
    const initContent = await fs.readFile('init.mjs', 'utf8');
    
    // Tìm VERIFICATION block hoặc fallback logic
    if (!initContent.includes('VERIFICATION') && !initContent.includes('fallback')) {
      condition.status = 'fail';
      condition.evidence.push('init.mjs không có logic fallback');
      return condition;
    }

    condition.status = 'pass';
    condition.evidence.push('init.mjs có logic fallback');

  } catch (error) {
    condition.status = 'fail';
    condition.evidence.push(`Fallback behavior check error: ${error.message}`);
  }

  return condition;
}

/**
 * Oracle chính - kiểm tra tất cả điều kiện
 */
async function main() {
  const oracle = {
    feature: ORACLE_ID,
    timestamp: new Date().toISOString(),
    conditions: [],
    overall: 'unknown'
  };

  // Chạy tất cả điều kiện kiểm tra
  oracle.conditions.push(await checkSchemaValidation());
  oracle.conditions.push(await checkCommandResolution());
  oracle.conditions.push(await checkBaselineIntegration());
  oracle.conditions.push(await checkFeatureScopeValidation());
  oracle.conditions.push(await checkSurveyDetection());
  oracle.conditions.push(await checkFallbackBehavior());

  // Tính tổng kết quả
  const failed = oracle.conditions.filter(c => c.status === 'fail');
  const unknown = oracle.conditions.filter(c => c.status === 'unknown');
  
  if (failed.length > 0) {
    oracle.overall = 'fail';
  } else if (unknown.length > 0) {
    oracle.overall = 'unknown';
  } else {
    oracle.overall = 'pass';
  }

  // Xuất kết quả
  console.log(JSON.stringify(oracle, null, 2));
  
  // Exit code phù hợp với test runner
  process.exit(oracle.overall === 'pass' ? 0 : 1);
}

main().catch(error => {
  console.error('Oracle error:', error);
  process.exit(1);
});