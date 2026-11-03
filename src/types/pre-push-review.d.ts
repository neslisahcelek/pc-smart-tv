declare module '*pre-push-review.mjs' {
  export interface CheckResult {
    name: string;
    category: 'golden_rule' | 'security' | 'compilation' | 'tests' | 'build' | 'git_hygiene';
    passed: boolean;
    severity: 'error' | 'warning' | 'info';
    message: string;
    details?: string[];
    durationMs?: number;
  }

  export interface RunOptions {
    staged?: boolean;
    strict?: boolean;
    skipBuild?: boolean;
    skipTests?: boolean;
    json?: boolean;
    silent?: boolean;
    noExit?: boolean;
  }

  export interface RunSummary {
    passed: boolean;
    totalDurationSeconds?: string;
    results: CheckResult[];
  }

  export function checkChromeProfileProtection(customDiff?: string | null): CheckResult;
  export function checkSecurityAudit(): CheckResult;
  export function checkGitHygiene(): CheckResult;
  export function checkTypeScript(): CheckResult;
  export function checkTests(): CheckResult;
  export function checkBuild(): CheckResult;
  export function runAllChecks(options?: RunOptions): Promise<RunSummary>;
}
