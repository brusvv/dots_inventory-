#!/usr/bin/env bash
set -euo pipefail

TAG="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
COMMIT="${GITHUB_SHA:?GITHUB_SHA is required}"

if [[ "$(git cat-file -t "refs/tags/$TAG" 2>/dev/null || true)" != "tag" ]]; then
  echo "::error::An annotated Git tag is required."
  exit 1
fi

if [[ "$TAG" =~ ^dots-inventory-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  CHANNEL="stable"
elif [[ "$TAG" =~ ^dots-inventory-v[0-9]+\.[0-9]+\.[0-9]+-preview\.[0-9]+$ ]]; then
  CHANNEL="preview"
else
  echo "::error::Use dots-inventory-vX.Y.Z for Stable or dots-inventory-vX.Y.Z-preview.N for Preview."
  exit 1
fi

git fetch origin '+refs/heads/*:refs/remotes/origin/*'

if [[ "$CHANNEL" == "stable" ]]; then
  if ! git merge-base --is-ancestor "$COMMIT" refs/remotes/origin/main; then
    echo "::error::Stable release commit must already be reachable from main."
    exit 1
  fi
  SOURCE_BRANCH="main"
else
  TAG_MESSAGE="$(git for-each-ref --format='%(contents)' "refs/tags/$TAG")"
  mapfile -t SOURCE_BRANCHES < <(printf '%s\n' "$TAG_MESSAGE" | sed -n 's/^source-branch: //p')
  if [[ "${#SOURCE_BRANCHES[@]}" -ne 1 ]]; then
    echo "::error::Preview tag annotation must contain exactly one source-branch declaration."
    exit 1
  fi
  SOURCE_BRANCH="${SOURCE_BRANCHES[0]}"
  if [[ ! "$SOURCE_BRANCH" =~ ^(feature|release|hotfix)/[A-Za-z0-9._/-]+$ ]]; then
    echo "::error::Preview annotated tag message must include source-branch: feature/your-branch (or release/hotfix)."
    exit 1
  fi
  if ! git show-ref --verify --quiet "refs/remotes/origin/$SOURCE_BRANCH"; then
    echo "::error::Preview source branch does not exist on origin: $SOURCE_BRANCH"
    exit 1
  fi
  if ! git merge-base --is-ancestor "$COMMIT" "refs/remotes/origin/$SOURCE_BRANCH"; then
    echo "::error::Tagged commit is not contained in declared source branch: $SOURCE_BRANCH"
    exit 1
  fi
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    printf 'RELEASE_CHANNEL=%s\n' "$CHANNEL"
    printf 'RELEASE_SOURCE_BRANCH=%s\n' "$SOURCE_BRANCH"
  } >> "$GITHUB_ENV"
fi
printf 'Validated %s release from %s at %s\n' "$CHANNEL" "$SOURCE_BRANCH" "$COMMIT"
