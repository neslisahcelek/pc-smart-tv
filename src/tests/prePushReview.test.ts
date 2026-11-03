import { describe, it, expect } from 'vitest';
import {
  checkChromeProfileProtection,
  checkSecurityAudit,
  checkGitHygiene,
  runAllChecks
} from '../../scripts/pre-push-review.mjs';

describe('Pre-Push Review Agent Unit Tests', () => {
  it('detects --user-data-dir violation in diff', () => {
    const maliciousDiff = `
diff --git a/src/server/launcher.ts b/src/server/launcher.ts
+ spawn('chrome.exe', ['--user-data-dir=C:\\\\temp']);
    `;
    const res = checkChromeProfileProtection(maliciousDiff);
    expect(res.passed).toBe(false);
    expect(res.details?.some((d: string) => d.includes('--user-data-dir'))).toBe(true);
  });

  it('detects taskkill chrome violation in diff', () => {
    const maliciousDiff = `
diff --git a/src/server/cleanup.ts b/src/server/cleanup.ts
+ execSync('taskkill /f /im chrome.exe');
    `;
    const res = checkChromeProfileProtection(maliciousDiff);
    expect(res.passed).toBe(false);
    expect(res.details?.some((d: string) => d.includes('taskkill'))).toBe(true);
  });

  it('passes Chrome profile checks when codebase is clean', () => {
    const cleanDiff = `
diff --git a/src/client/tv/TVApp.tsx b/src/client/tv/TVApp.tsx
+ console.log('hello TV');
    `;
    const res = checkChromeProfileProtection(cleanDiff);
    expect(res.passed).toBe(true);
  });

  it('verifies security audit checks pass on clean codebase', () => {
    const res = checkSecurityAudit();
    expect(res.passed).toBe(true);
    expect(res.category).toBe('security');
  });

  it('executes git hygiene check cleanly', () => {
    const res = checkGitHygiene();
    expect(res.category).toBe('git_hygiene');
    expect(res.passed).toBe(true);
  });

  it('executes runAllChecks programmatic pipeline without errors', async () => {
    const result = await runAllChecks({
      skipBuild: true,
      skipTests: true,
      json: true,
      silent: true,
      noExit: true
    });

    expect(result).toHaveProperty('passed', true);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBe(6);
  });
});
