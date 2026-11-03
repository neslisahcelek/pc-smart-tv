---
name: pre-push-review
description: >-
  Runs pre-push code review and quality audits for the Smart TV Launcher project.
  Use when the user asks to review changes before pushing, check code against AGENTS.md rules,
  verify pre-push quality gates (typecheck, tests, build, security, personal Chrome profile),
  or prepare code for a git push.
---

# Pre-Push Code Review Agent

This skill guides the agent through an automated and semantic pre-push code review for the `tv-controller` repository, enforcing the golden rules and security principles outlined in `AGENTS.md`.

## Quality Gates Checklist

Always verify each of the following 6 quality gates before approving any code push:

1. **Personal Chrome Profile Protection (Rule 1.1)**:
   - Ensure `--user-data-dir` is NEVER introduced.
   - Ensure `taskkill /f /im chrome.exe` or any forced Chrome kill is NEVER called.
   - Verify Windows Task Scheduler (`SmartTvLauncher-OpenTv`) / user session isolation is preserved.

2. **Zero Leakage & Security Audit (Rule 2.1 & 2.2)**:
   - `src/client/` must NEVER contain API keys, passwords, or tokens.
   - Public APIs (`/api/health`) must only return boolean status flags, never secrets.
   - `.env` must remain gitignored.
   - Private LAN check (`isPrivateLanIp`) and WebSocket `verifyClient` (Origin header check) must remain intact.
   - WebSocket payload limit (16 KB) and `validateClientMessage` whitelist must be enforced.
   - URL navigation must enforce `isSafeHttpsUrl`. No arbitrary shell `eval` or dynamic execution.

3. **Git Hygiene & Conflict Check**:
   - No leftover merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
   - No stray temporary, credential, or cache files staged for commit.

4. **TypeScript Verification**:
   - `npm run typecheck` (`tsc --noEmit`) must succeed with 0 errors.

5. **Test Suite**:
   - `npm test` (`vitest run`) must pass all unit and integration tests.

6. **Production Build**:
   - `npm run build` (`vite build && tsc -p tsconfig.server.json`) must compile cleanly.

---

## Review Execution Steps

### Step 1: Run the Automated Pre-Push Review Tool
Execute the project's pre-push review script:

```bash
npm run review
# Or with structured JSON output:
node scripts/pre-push-review.mjs --json
```

If you only want to review staged commits:
```bash
node scripts/pre-push-review.mjs --staged
```

### Step 2: Semantic Git Diff Inspection
Inspect changes using `git diff HEAD` (or `git diff --cached` for staged changes):
- Check for functional regressions in TV launcher or iPhone remote touch / touchpad.
- Verify focus management (`focusAntigravity` must only run on explicit user action, TV must stay on top).
- Check that new WebSocket commands are added to `validateClientMessage` and `describeCommandInTurkish`.

### Step 3: Produce Review Report
Generate a summary report for the user detailing:
- **Status**: `APPROVED / PUSH HAZIR` or `BLOCKED / DÜZELTME GEREKLİ`
- **Quality Gates Matrix**: Table of the 6 checks with PASS / FAIL / WARN.
- **Diff Analysis**: Highlight key changes and architectural impact.
- **Recommended Actions**: Specific commands or code adjustments if issues are detected.
