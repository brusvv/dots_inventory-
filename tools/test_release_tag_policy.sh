#!/usr/bin/env bash
set -euo pipefail
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
REMOTE="$ROOT/remote.git"
WORK="$ROOT/work"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RELEASE_VALIDATOR="$SCRIPT_DIR/validate_release_tag.sh"
export GITHUB_ENV="$ROOT/github-env"
: > "$GITHUB_ENV"

git init --bare --initial-branch=main "$REMOTE" >/dev/null
git clone "$REMOTE" "$WORK" >/dev/null 2>&1
git -C "$WORK" config user.name "Release Policy Tests"
git -C "$WORK" config user.email "release-policy-tests@example.invalid"
printf 'base\n' > "$WORK/base.txt"
git -C "$WORK" add base.txt
git -C "$WORK" commit -m "main baseline" >/dev/null
git -C "$WORK" push -u origin main >/dev/null 2>&1
MAIN_SHA="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" tag -a dots-inventory-v1.0.0 -m "Stable test"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.0.0 >/dev/null 2>&1

git -C "$WORK" switch -c feature/preview >/dev/null 2>&1
printf 'preview\n' > "$WORK/preview.txt"
git -C "$WORK" add preview.txt
git -C "$WORK" commit -m "preview change" >/dev/null
PREVIEW_SHA="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" push -u origin feature/preview >/dev/null 2>&1
git -C "$WORK" tag -a dots-inventory-v1.1.0-preview.1 -m "Preview test" -m "source-branch: feature/preview"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.1.0-preview.1 >/dev/null 2>&1

run_ok() {
  local tag="$1" sha="$2" expected_channel="$3" expected_branch="$4"
  local env_file="$ROOT/github-env"
  : > "$env_file"
  (cd "$WORK" && GITHUB_REF_NAME="$tag" GITHUB_SHA="$sha" GITHUB_ENV="$env_file" bash "$RELEASE_VALIDATOR") >/dev/null
  grep -Fx "RELEASE_CHANNEL=$expected_channel" "$env_file" >/dev/null
  grep -Fx "RELEASE_SOURCE_BRANCH=$expected_branch" "$env_file" >/dev/null
  echo "PASS accepts $expected_channel tag from $expected_branch"
}
run_fail() {
  local tag="$1" sha="$2" label="$3"
  if (cd "$WORK" && GITHUB_REF_NAME="$tag" GITHUB_SHA="$sha" bash "$RELEASE_VALIDATOR") >/dev/null 2>&1; then
    echo "FAIL unexpectedly accepted $label" >&2
    exit 1
  fi
  echo "PASS rejects $label"
}

run_ok dots-inventory-v1.0.0 "$MAIN_SHA" stable main
run_ok dots-inventory-v1.1.0-preview.1 "$PREVIEW_SHA" preview feature/preview

git -C "$WORK" tag -a dots-inventory-v1.1.0-preview.2 -m "Wrong branch" -m "source-branch: feature/missing"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.1.0-preview.2 >/dev/null 2>&1
run_fail dots-inventory-v1.1.0-preview.2 "$PREVIEW_SHA" "Preview with missing source branch"

git -C "$WORK" switch --orphan feature/unrelated >/dev/null 2>&1
git -C "$WORK" rm -rf . >/dev/null 2>&1 || true
printf 'unrelated\n' > "$WORK/unrelated.txt"
git -C "$WORK" add unrelated.txt
git -C "$WORK" commit -m "unrelated history" >/dev/null
UNRELATED_SHA="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" push -u origin feature/unrelated >/dev/null 2>&1
git -C "$WORK" tag -a dots-inventory-v1.1.0-preview.3 -m "Wrong ancestry" -m "source-branch: feature/preview"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.1.0-preview.3 >/dev/null 2>&1
run_fail dots-inventory-v1.1.0-preview.3 "$UNRELATED_SHA" "Preview commit outside declared branch"

git -C "$WORK" tag dots-inventory-v1.0.1 "$MAIN_SHA"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.0.1 >/dev/null 2>&1
run_fail dots-inventory-v1.0.1 "$MAIN_SHA" "lightweight tag"

git -C "$WORK" tag -a dots-inventory-v1.0.2 -m "Wrong stable source" "$PREVIEW_SHA"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.0.2 >/dev/null 2>&1
run_fail dots-inventory-v1.0.2 "$PREVIEW_SHA" "Stable commit outside main"

git -C "$WORK" tag -a dots-inventory-v1.0.3-rc.1 -m "Unsupported prerelease"
git -C "$WORK" push origin refs/tags/dots-inventory-v1.0.3-rc.1 >/dev/null 2>&1
run_fail dots-inventory-v1.0.3-rc.1 "$MAIN_SHA" "unsupported prerelease tag"

echo "All release tag policy tests passed."
