#!/usr/bin/env bash
# Permanently remove every Vercel Sandbox in a project.
#
# Defaults target the Kata Code sandbox test project. Pass --scope and --project
# to use it elsewhere. The script lists targets first and only deletes with --yes.
set -euo pipefail

scope="astro-labs"
project="vercel-sandbox-uat"
confirm=false

usage() {
  cat <<'EOF'
Usage: scripts/cleanup-vercel-sandboxes.sh [options]

Permanently delete every Vercel Sandbox and its snapshots in a project.

Options:
  --scope <team>       Vercel team slug (default: astro-labs)
  --project <project>  Vercel project name or ID (default: vercel-sandbox-uat)
  --yes                Delete the listed sandboxes
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope)
      scope="$2"
      shift 2
      ;;
    --project)
      project="$2"
      shift 2
      ;;
    --yes)
      confirm=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v vercel >/dev/null; then
  printf 'Vercel CLI is required. Install it with: npm install --global vercel\n' >&2
  exit 1
fi

names=()
cursor=""
while :; do
  command=(vercel sandbox list --scope "$scope" --project "$project" --all --limit 50)
  if [[ -n "$cursor" ]]; then
    command+=(--cursor "$cursor")
  fi

  output=$("${command[@]}")
  while IFS= read -r name; do
    names+=("$name")
  done < <(printf '%s\n' "$output" | awk '$2 ~ /^(creating|running|stopping|stopped|failed)$/ { print $1 }')

  cursor=$(printf '%s\n' "$output" | sed -n 's/.*--cursor \([^[:space:]]*\).*/\1/p')
  [[ -n "$cursor" ]] || break
done

if [[ ${#names[@]} -eq 0 ]]; then
  printf 'No sandboxes found in %s/%s.\n' "$scope" "$project"
  exit 0
fi

printf 'Found %d sandbox(es) in %s/%s:\n' "${#names[@]}" "$scope" "$project"
printf '  %s\n' "${names[@]}"

if [[ "$confirm" != true ]]; then
  printf '\nDry run only. Re-run with --yes to permanently delete them.\n'
  exit 0
fi

vercel sandbox remove "${names[@]}" --scope "$scope" --project "$project"
printf 'Requested deletion of %d sandbox(es).\n' "${#names[@]}"
