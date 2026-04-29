export type KanbanCommandRisk = {
  risky: boolean
  matches: string[]
}

const RISK_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'rm -rf', pattern: /\brm\s+-[^\n;&|]*r[^\n;&|]*f|\brm\s+-[^\n;&|]*f[^\n;&|]*r/iu },
  { id: 'git reset --hard', pattern: /\bgit\s+reset\s+--hard\b/iu },
  { id: 'git clean', pattern: /\bgit\s+clean\b/iu },
  { id: 'git checkout -f', pattern: /\bgit\s+checkout\s+-f\b/iu },
  { id: 'git push --force', pattern: /\bgit\s+push\b[^\n;&|]*--force(?:-with-lease)?\b/iu },
  { id: 'chmod -R', pattern: /\bchmod\s+-R\b/iu },
  { id: 'chown -R', pattern: /\bchown\s+-R\b/iu },
  { id: 'sudo', pattern: /\bsudo\b/iu },
  { id: 'docker prune', pattern: /\bdocker\b[^\n;&|]*\bprune\b/iu },
  { id: 'kubectl delete', pattern: /\bkubectl\s+delete\b/iu },
  { id: 'terraform apply', pattern: /\bterraform\s+apply\b/iu },
  { id: 'terraform destroy', pattern: /\bterraform\s+destroy\b/iu },
  { id: 'curl pipe sh', pattern: /\bcurl\b[^\n]*\|\s*(?:ba)?sh\b/iu },
  { id: 'wget pipe sh', pattern: /\bwget\b[^\n]*\|\s*(?:ba)?sh\b/iu },
  { id: 'npm publish', pattern: /\bnpm\s+publish\b/iu },
]

export function classifyKanbanCommandRisk(command: string): KanbanCommandRisk {
  const matches = RISK_PATTERNS
    .filter((entry) => entry.pattern.test(command))
    .map((entry) => entry.id)
  return {
    risky: matches.length > 0,
    matches,
  }
}
