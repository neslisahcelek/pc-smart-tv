#!/usr/bin/env node

/**
 * Pre-Push Code Review & Quality Gate Agent for Smart TV Launcher
 * 
 * Verifies code against AGENTS.md Golden Rules, Security Policies,
 * TypeScript compilation, Unit/Integration tests, and Production Build.
 * 
 * Can be run via:
 *   npm run review
 *   npm run pre-push
 *   node scripts/pre-push-review.mjs [--staged] [--strict] [--skip-build] [--skip-tests] [--json]
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..');

// Command line arguments
const args = process.argv.slice(2);
export const IS_STAGED_ONLY = args.includes('--staged');
export const IS_STRICT = args.includes('--strict');
export const SKIP_BUILD = args.includes('--skip-build');
export const SKIP_TESTS = args.includes('--skip-tests') || Boolean(process.env.VITEST);
export const OUTPUT_JSON = args.includes('--json');

// Color helpers
const isColorSupported = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
const colors = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  gray: isColorSupported ? '\x1b[90m' : '',
  bgRed: isColorSupported ? '\x1b[41m\x1b[37m' : '',
  bgGreen: isColorSupported ? '\x1b[42m\x1b[30m' : '',
};

export function runCmd(cmd, options = {}) {
  const start = Date.now();
  const res = spawnSync(cmd, {
    cwd: REPO_ROOT,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
  const durationMs = Date.now() - start;
  return {
    status: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error,
    durationMs
  };
}

export function getGitDiff(stagedOnly = false) {
  const cmd = stagedOnly ? 'git diff --cached' : 'git diff HEAD';
  const res = runCmd(cmd);
  if (res.status !== 0) {
    return runCmd('git diff').stdout;
  }
  return res.stdout;
}

export function getChangedFiles(stagedOnly = false) {
  const cmd = stagedOnly ? 'git diff --name-only --cached' : 'git status --porcelain';
  const res = runCmd(cmd);
  if (res.status !== 0) return [];
  
  if (stagedOnly) {
    return res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  }
  
  return res.stdout
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean);
}

export function getCodeGitDiff(stagedOnly = false) {
  const excludeSpecs = [
    ':!*.test.*',
    ':!*.spec.*',
    ':!*.d.ts',
    ':!*.md',
    ':!*pre-push-review*',
    ':!*install-git-hooks*'
  ].map(s => `"${s}"`).join(' ');

  const cmd = stagedOnly 
    ? `git diff --cached -- "src/**" "scripts/**" ${excludeSpecs}` 
    : `git diff HEAD -- "src/**" "scripts/**" ${excludeSpecs}`;
  const res = runCmd(cmd);
  if (res.status === 0) {
    return res.stdout;
  }
  return runCmd(`git diff -- "src/**" "scripts/**" ${excludeSpecs}`).stdout;
}

// -------------------------------------------------------------
// CHECK 1: Personal Chrome Profile Protection (AGENTS.md 1.1)
// -------------------------------------------------------------
export function checkChromeProfileProtection(customDiff = null) {
  const diff = customDiff !== null ? customDiff : getCodeGitDiff(IS_STAGED_ONLY);
  const issues = [];

  // Check 1: No --user-data-dir in diff
  if (diff.includes('--user-data-dir')) {
    issues.push('KOD DEĞİŞİKLİĞİNDE `--user-data-dir` TESPİT EDİLDİ! AGENTS.md Kural 1.1 gereği kullanıcının varsayılan profili korunmalıdır, ayrı profil açılamaz.');
  }

  // Check 2: No taskkill chrome.exe in diff
  const taskkillRegex = /taskkill\s+.*chrome(\.exe)?/i;
  if (taskkillRegex.test(diff)) {
    issues.push('KOD DEĞİŞİKLİĞİNDE `taskkill ... chrome.exe` TESPİT EDİLDİ! AGENTS.md Kural 1.1 gereği Chrome süreçleri zorla kapatılamaz (kullanıcı sekmeleri ve lockfile hasar görür).');
  }

  // Also scan all source files in src/
  const srcFiles = getAllFiles(path.join(REPO_ROOT, 'src'), ['.ts', '.tsx', '.js', '.vbs', '.bat']);
  for (const file of srcFiles) {
    // Skip test files from false positive check on literal test strings
    if (file.includes('.test.') || file.includes('.d.ts')) continue;
    
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('--user-data-dir')) {
      const relPath = path.relative(REPO_ROOT, file);
      issues.push(`'${relPath}' içinde '--user-data-dir' bulundu!`);
    }
    if (taskkillRegex.test(content)) {
      const relPath = path.relative(REPO_ROOT, file);
      issues.push(`'${relPath}' içinde 'taskkill chrome.exe' bulundu!`);
    }
  }

  return {
    name: 'Kişisel Chrome Profili Koruması (Kural 1.1)',
    category: 'golden_rule',
    passed: issues.length === 0,
    severity: 'error',
    message: issues.length === 0 
      ? 'Chrome kullanıcı profili güvende (ayrı profil ve taskkill chrome tespit edilmedi).' 
      : 'Kişisel Chrome profili kuralı ihlal edildi!',
    details: issues
  };
}

// -------------------------------------------------------------
// CHECK 2: Zero Leakage Security Audit (AGENTS.md 2.1 & 2.2)
// -------------------------------------------------------------
export function checkSecurityAudit() {
  const issues = [];
  const warnings = [];

  // 1. Sensitive files staged or in git tracking
  const gitStatus = runCmd('git status --porcelain').stdout;
  const sensitiveFileRegex = /(^\?\?|^A |^M )\s*(.*(\.env|\.pem|\.key|id_rsa|credentials\.json).*)$/m;
  const lines = gitStatus.split('\n');
  for (const line of lines) {
    if (sensitiveFileRegex.test(line)) {
      issues.push(`Korumalı hassas dosya git izlemesinde tespit edildi: ${line.trim()}`);
    }
  }

  // 2. Client-side secrets leak check (src/client/ never has API keys or tokens)
  const clientFiles = getAllFiles(path.join(REPO_ROOT, 'src', 'client'), ['.ts', '.tsx', '.js', '.css', '.html']);
  const apiKeyPatterns = [
    /AIza[0-9A-Za-z-_]{35}/g, // Google API Key
    /YOUTUBE_API_KEY/g,
    /PROGRESS_TOKEN/g,
    /ghp_[0-9a-zA-Z]{36}/g,  // GitHub token
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g
  ];

  for (const file of clientFiles) {
    const relPath = path.relative(REPO_ROOT, file);
    const content = fs.readFileSync(file, 'utf8');

    for (const pattern of apiKeyPatterns) {
      if (pattern.test(content)) {
        issues.push(`Frontend kodunda ('${relPath}') yasaklı token veya API anahtarı deseni eşleşti: ${pattern}`);
      }
    }
  }

  // 3. WebSocket and LAN Security integrity check
  const wsHubPath = path.join(REPO_ROOT, 'src', 'server', 'wsHub.ts');
  if (fs.existsSync(wsHubPath)) {
    const wsContent = fs.readFileSync(wsHubPath, 'utf8');
    if (!wsContent.includes('verifyClient')) {
      issues.push('wsHub.ts içinde `verifyClient` (Origin doğrulama) koruması bulunamadı!');
    }
    if (!wsContent.includes('16 * 1024') && !wsContent.includes('16384')) {
      warnings.push('wsHub.ts içinde 16 KB WebSocket payload limit denetimi değiştirilmiş olabilir.');
    }
    if (!wsContent.includes('validateClientMessage')) {
      issues.push('wsHub.ts içinde `validateClientMessage` whitelist denetimi eksik!');
    }
  }

  // 4. Safe URL validation check
  const protocolPath = path.join(REPO_ROOT, 'src', 'shared', 'protocol.ts');
  if (fs.existsSync(protocolPath)) {
    const protoContent = fs.readFileSync(protocolPath, 'utf8');
    if (!protoContent.includes('isSafeHttpsUrl')) {
      issues.push('protocol.ts içinde `isSafeHttpsUrl` güvenlik fonksiyonu bulunamadı!');
    }
  }

  // 5. Arbitrary exec/eval check
  const serverFiles = getAllFiles(path.join(REPO_ROOT, 'src', 'server'), ['.ts', '.js']);
  for (const file of serverFiles) {
    const relPath = path.relative(REPO_ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    if (/\beval\s*\(/.test(content)) {
      issues.push(`'${relPath}' içinde tehlikeli 'eval()' çağrısı bulundu!`);
    }
  }

  return {
    name: 'Güvenlik ve Bilgi Sızıntısı Koruması (Kural 2.1 & 2.2)',
    category: 'security',
    passed: issues.length === 0,
    severity: 'error',
    message: issues.length === 0 
      ? 'Frontend ve sunucu güvenlik kontrolleri eksiksiz (Zero Leakage sağlandı).' 
      : 'Güvenlik ilkeleri ihlal edildi!',
    details: [...issues, ...warnings]
  };
}

// -------------------------------------------------------------
// CHECK 3: Git Hygiene & Conflict Markers
// -------------------------------------------------------------
export function checkGitHygiene() {
  const issues = [];
  const warnings = [];
  const diff = getGitDiff(IS_STAGED_ONLY);

  // Unresolved merge conflict markers
  const conflictRegex = /^(<{7}|={7}|>{7})(\s|$)/m;
  if (conflictRegex.test(diff)) {
    issues.push('Kodda çözülmemiş Git merge conflict işaretleri (`<<<<<<<`, `=======`, `>>>>>>>`) bulundu!');
  }

  // Check changed files list
  const changedFiles = getChangedFiles(IS_STAGED_ONLY);
  if (changedFiles.length === 0) {
    warnings.push('İncelenecek herhangi bir dosya değişikliği bulunamadı (çalışma alanı temiz).');
  }

  // Check for debug logs left in diff
  const debugLogMatches = diff.match(/\+\s*console\.(log|debug)\(/g);
  if (debugLogMatches && debugLogMatches.length > 0) {
    warnings.push(`Değişikliklerde ${debugLogMatches.length} adet yeni \`console.log/debug\` ifadesi tespit edildi.`);
  }

  return {
    name: 'Git Hijyeni ve Çakışma Kontrolü',
    category: 'git_hygiene',
    passed: issues.length === 0,
    severity: issues.length === 0 && warnings.length > 0 ? 'warning' : (issues.length === 0 ? 'info' : 'error'),
    message: issues.length === 0
      ? (warnings.length > 0 ? 'Çakışma yok, ancak bazı dikkat edilmesi gereken noktalar var.' : 'Git çalışma alanı temiz ve çakışmasız.')
      : 'Git hijyen hatası tespit edildi!',
    details: [...issues, ...warnings]
  };
}

// -------------------------------------------------------------
// CHECK 4: TypeScript Typecheck (`npm run typecheck`)
// -------------------------------------------------------------
export function checkTypeScript() {
  const res = runCmd('npm run typecheck');
  const passed = res.status === 0;
  const issues = [];
  
  if (!passed) {
    const errorLines = (res.stdout + '\n' + res.stderr)
      .split('\n')
      .filter(l => l.includes('error TS') || l.includes('): error'))
      .slice(0, 10);
    issues.push(...errorLines);
  }

  return {
    name: 'TypeScript Tip Doğrulaması (npm run typecheck)',
    category: 'compilation',
    passed,
    severity: 'error',
    durationMs: res.durationMs,
    message: passed ? 'TypeScript tip denetimi sıfır hatayla geçti.' : 'TypeScript tip hataları bulundu!',
    details: issues
  };
}

// -------------------------------------------------------------
// CHECK 5: Automated Test Suite (`npm test`)
// -------------------------------------------------------------
export function checkTests() {
  if (SKIP_TESTS) {
    return {
      name: 'Birim ve Entegrasyon Testleri (npm test)',
      category: 'tests',
      passed: true,
      severity: 'info',
      message: 'Testler vitest ortamında veya kullanıcı bayrağıyla atlandı (--skip-tests).'
    };
  }

  const res = runCmd('npm test');
  const passed = res.status === 0;
  const issues = [];
  
  if (!passed) {
    const failureLines = (res.stdout + '\n' + res.stderr)
      .split('\n')
      .filter(l => l.includes('FAIL') || l.includes('Error:') || l.includes('failed'))
      .slice(0, 10);
    issues.push(...failureLines);
  }

  return {
    name: 'Birim ve Entegrasyon Testleri (npm test)',
    category: 'tests',
    passed,
    severity: 'error',
    durationMs: res.durationMs,
    message: passed ? 'Tüm Vitest testleri başarıyla tamamlandı.' : 'Bazı testler başarısız oldu!',
    details: issues
  };
}

// -------------------------------------------------------------
// CHECK 6: Production Build (`npm run build`)
// -------------------------------------------------------------
export function checkBuild() {
  if (SKIP_BUILD) {
    return {
      name: 'Üretim Derlemesi (npm run build)',
      category: 'build',
      passed: true,
      severity: 'info',
      message: 'Üretim derlemesi kullanıcı bayrağıyla atlandı (--skip-build).'
    };
  }

  const res = runCmd('npm run build');
  const passed = res.status === 0;
  const issues = [];
  
  if (!passed) {
    const errorLines = (res.stdout + '\n' + res.stderr)
      .split('\n')
      .filter(l => l.includes('error') || l.includes('Error') || l.includes('Failed'))
      .slice(0, 10);
    issues.push(...errorLines);
  }

  return {
    name: 'Üretim Derlemesi (npm run build)',
    category: 'build',
    passed,
    severity: 'error',
    durationMs: res.durationMs,
    message: passed ? 'İstemci ve sunucu paketleri hatasız derlendi.' : 'Üretim derlemesi başarısız oldu!',
    details: issues
  };
}

// Helper: Recursively get all files
export function getAllFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        results.push(...getAllFiles(fullPath, extensions));
      }
    } else if (entry.isFile()) {
      if (!extensions || extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// -------------------------------------------------------------
// RUNNER & FORMATTER
// -------------------------------------------------------------
export async function runAllChecks(options = {}) {
  const isStaged = options.staged ?? IS_STAGED_ONLY;
  const isStrict = options.strict ?? IS_STRICT;
  const skipBuild = options.skipBuild ?? SKIP_BUILD;
  const skipTests = options.skipTests ?? SKIP_TESTS;
  const outputJson = options.json ?? OUTPUT_JSON;

  const results = [];
  const startTime = Date.now();
  
  if (!outputJson) {
    console.log(`\n${colors.bold}${colors.cyan}=====================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}  🛡️  SMART TV LAUNCHER — PRE-PUSH CODE REVIEW AGENT ${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}=====================================================${colors.reset}`);
    console.log(`${colors.dim}Hedef: Push öncesi AGENTS.md altın kuralları ve kalite kapıları denetimi${colors.reset}\n`);
  }

  // 1. Golden Rules
  if (!outputJson) process.stdout.write(`⏳ [1/6] Kişisel Chrome profili kuralları denetleniyor... `);
  const r1 = checkChromeProfileProtection();
  results.push(r1);
  if (!outputJson) logInlineResult(r1);

  // 2. Security Audit
  if (!outputJson) process.stdout.write(`⏳ [2/6] Güvenlik ve bilgi sızıntısı (Zero Leakage) taranıyor... `);
  const r2 = checkSecurityAudit();
  results.push(r2);
  if (!outputJson) logInlineResult(r2);

  // 3. Git Hygiene
  if (!outputJson) process.stdout.write(`⏳ [3/6] Git hijyeni ve çakışma kontrolü yapılıyor... `);
  const r3 = checkGitHygiene();
  results.push(r3);
  if (!outputJson) logInlineResult(r3);

  // 4. TypeScript Typecheck
  if (!outputJson) process.stdout.write(`⏳ [4/6] TypeScript tip denetimi çalıştırılıyor... `);
  const r4 = checkTypeScript();
  results.push(r4);
  if (!outputJson) logInlineResult(r4);

  // 5. Automated Tests
  if (!outputJson) process.stdout.write(`⏳ [5/6] Birim ve entegrasyon testleri koşturuluyor... `);
  const r5 = checkTests();
  results.push(r5);
  if (!outputJson) logInlineResult(r5);

  // 6. Production Build
  if (!outputJson) process.stdout.write(`⏳ [6/6] Üretim derlemesi (Vite & tsc) doğrulanıyor... `);
  const r6 = checkBuild();
  results.push(r6);
  if (!outputJson) logInlineResult(r6);

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const hasErrors = results.some(r => !r.passed && r.severity === 'error');
  const hasWarnings = results.some(r => r.severity === 'warning' || (r.details && r.details.length > 0));

  if (outputJson) {
    const payload = {
      passed: !hasErrors && (!isStrict || !hasWarnings),
      totalDurationSeconds: totalDuration,
      results
    };
    if (!options.silent) {
      console.log(JSON.stringify(payload, null, 2));
    }
    return payload;
  }

  // Render Detailed Report
  console.log(`\n${colors.bold}-------------------- DENETİM RAPORU --------------------${colors.reset}`);
  for (const r of results) {
    const icon = r.passed 
      ? (r.severity === 'warning' ? '⚠️ ' : '✅') 
      : '❌';
    const tag = r.passed 
      ? (r.severity === 'warning' ? `${colors.yellow}[UYARI]${colors.reset}` : `${colors.green}[GEÇTİ]${colors.reset}`) 
      : `${colors.red}[BAŞARISIZ]${colors.reset}`;
    
    const timeStr = r.durationMs ? ` ${colors.dim}(${(r.durationMs / 1000).toFixed(2)}s)${colors.reset}` : '';
    console.log(`${icon} ${tag} ${colors.bold}${r.name}${colors.reset}${timeStr}`);
    console.log(`   ${colors.dim}↳ ${r.message}${colors.reset}`);
    
    if (r.details && r.details.length > 0) {
      for (const d of r.details) {
        console.log(`     ${colors.yellow}• ${d}${colors.reset}`);
      }
    }
  }

  console.log(`${colors.bold}--------------------------------------------------------${colors.reset}`);
  
  if (hasErrors) {
    console.log(`\n${colors.bgRed} ❌ PUSH ENGELLENDİ: Kritik kontroller başarısız oldu! ${colors.reset}`);
    console.log(`${colors.red}Lütfen yukarıdaki hataları giderip tekrar deneyin.\n${colors.reset}`);
    if (!options.noExit) process.exit(1);
    return { passed: false, results };
  } else if (hasWarnings && isStrict) {
    console.log(`\n${colors.bgRed} ❌ PUSH ENGELLENDİ: --strict modunda uyarılar tespit edildi! ${colors.reset}\n`);
    if (!options.noExit) process.exit(1);
    return { passed: false, results };
  } else {
    console.log(`\n${colors.bgGreen} 🚀 PUSH ONAYLANDI: Tüm kontroller başarıyla tamamlandı (${totalDuration}s)! ${colors.reset}`);
    console.log(`${colors.green}Kod güvenle uzak sunucuya (origin) gönderilebilir.\n${colors.reset}`);
    if (!options.noExit) process.exit(0);
    return { passed: true, results };
  }
}

function logInlineResult(result) {
  const timeStr = result.durationMs ? ` (${(result.durationMs / 1000).toFixed(2)}s)` : '';
  if (result.passed) {
    if (result.severity === 'warning') {
      console.log(`${colors.yellow}UYARI${colors.reset}${timeStr}`);
    } else {
      console.log(`${colors.green}TAMAM${colors.reset}${timeStr}`);
    }
  } else {
    console.log(`${colors.red}HATALI${colors.reset}${timeStr}`);
  }
}

// Only run automatically if executed directly as a CLI script
const isDirectCliExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectCliExecution) {
  runAllChecks().catch(err => {
    console.error('\nBeklenmeyen bir hata oluştu:', err);
    process.exit(1);
  });
}
