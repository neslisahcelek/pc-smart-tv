#!/usr/bin/env node

/**
 * Git Pre-Push Hook Installer for Smart TV Launcher
 * Automatically sets up .git/hooks/pre-push to run pre-push review.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(REPO_ROOT, '.git', 'hooks');
const PRE_PUSH_FILE = path.join(HOOKS_DIR, 'pre-push');

if (!fs.existsSync(HOOKS_DIR)) {
  console.error('❌ .git/hooks klasörü bulunamadı. Bu komut git deposu kökünde çalıştırılmalıdır.');
  process.exit(1);
}

const hookContent = `#!/bin/sh
# Smart TV Launcher - Pre-Push Quality Gate Hook
# Otomatik olarak push öncesi AGENTS.md ve kalite kontrollerini çalıştırır.

echo ""
echo "🛡️  Git Push öncesi otomatik kod incelemesi ve testler başlatılıyor..."
echo ""

node scripts/pre-push-review.mjs
RESULT=$?

if [ $RESULT -ne 0 ]; then
  echo ""
  echo "❌ Push işlemi engellendi. Lütfen hataları düzelttikten sonra tekrar deneyin."
  echo "   (Zorunlu acil durumlarda: git push --no-verify)"
  echo ""
  exit 1
fi

exit 0
`;

fs.writeFileSync(PRE_PUSH_FILE, hookContent, { mode: 0o755, encoding: 'utf8' });
console.log('✅ Git pre-push hook başarıyla yüklendi: .git/hooks/pre-push');
console.log('💡 Artık "git push" yaptığınızda otomatik olarak pre-push review çalıştırılacaktır.');
