#!/usr/bin/env node

/**
 * Verify README.md has proper structure for new users.
 * 
 * Requirements (from falsifier):
 * - Not a single paragraph (has headings)
 * - Has quick start guide 
 * - Has extension instructions
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

try {
  // Check heading count
  const headingCount = parseInt(execSync('grep -c "^## " README.md', { encoding: 'utf8' }).trim());
  
  if (headingCount < 5) {
    console.error(`FAIL: Expected at least 5 level-2 headings, found ${headingCount}`);
    process.exit(1);
  }

  // Check content exists (not just fake headings)
  const content = readFileSync('README.md', 'utf8');
  
  // Verify required sections exist
  const hasQuickStart = /^## .*(?:quick start|getting started)/im.test(content);
  const hasExtending = /^## .*(?:extend|expand)/im.test(content);
  
  if (!hasQuickStart) {
    console.error('FAIL: Missing quick start section');
    process.exit(1);
  }
  
  if (!hasExtending) {
    console.error('FAIL: Missing extension section');
    process.exit(1);
  }
  
  // Verify sections have content (not empty)
  const sections = content.split(/^## /m).slice(1); // Skip text before first heading
  const emptySections = sections.filter(section => section.trim().split('\n').length < 3);
  
  if (emptySections.length > 0) {
    console.error('FAIL: Found empty sections with insufficient content');
    process.exit(1);
  }
  
  console.log(`PASS: README has ${headingCount} structured sections with required content`);
  process.exit(0);
  
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
