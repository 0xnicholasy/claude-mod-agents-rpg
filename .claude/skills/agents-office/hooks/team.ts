// Own team label (D12). Pure: register.tsx runs `git branch --show-current` and passes the result in.
import { clean } from './log'

// The last path segment of the working directory; 'office' for the root.
export const baseName = (cwd: string): string => cwd.split('/').filter(part => part !== '').pop() ?? 'office'

// The branch from `git branch --show-current` output; empty when the run failed or HEAD is detached.
export const branchOf = (stdout: string, ok: boolean): string => (ok ? clean(stdout) : '')

// `basename (branch)`, or the basename alone when there is no branch.
export const teamLabel = (cwd: string, stdout: string, ok: boolean): string => {
  const name = clean(baseName(cwd))
  const branch = branchOf(stdout, ok)

  return branch === '' ? name : `${name} (${branch})`
}
