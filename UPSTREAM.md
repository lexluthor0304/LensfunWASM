# Upstream Tracking

## Source of truth

- Upstream repo: https://github.com/lensfun/lensfun.git
- Integration mode: git submodule (`third_party/lensfun`)
- Current pinned commit: `698a39eea69be00f4f25b6da6c1ad34b1f162b50`
- Commit date: `2026-06-13`
- Commit subject: `Add Sony E 15mm F1.4 G`

## Update policy

- Pin exact commits.
- Upgrade manually via PR.
- Run full build/test after each bump.

## Update steps

1. `scripts/sync-upstream.sh origin/master`
2. Review upstream diff impact (API, DB changes, compile behavior)
3. Rebuild wasm assets
4. Run tests
5. Update this file with new commit metadata
