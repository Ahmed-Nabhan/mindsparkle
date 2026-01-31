#!/bin/bash

# Sync Supabase service_role API key into GCP Secret Manager.
#
# IMPORTANT:
# - This does NOT rotate your Supabase keys.
# - After rotating keys in Supabase Dashboard, run this script to update the GCP secret.
#
# Usage:
#   ./scripts/sync_supabase_service_role_secret_to_gcp.sh \
#     --supabase-project-ref cszorvgzihzamgezlfjj \
#     --gcp-project mindsparkle \
#     --secret-name SUPABASE_SERVICE_ROLE_KEY

set -euo pipefail

SUPABASE_PROJECT_REF=""
GCP_PROJECT=""
SECRET_NAME="SUPABASE_SERVICE_ROLE_KEY"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --supabase-project-ref)
      SUPABASE_PROJECT_REF="$2"; shift 2;;
    --gcp-project)
      GCP_PROJECT="$2"; shift 2;;
    --secret-name)
      SECRET_NAME="$2"; shift 2;;
    *)
      echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ -z "$SUPABASE_PROJECT_REF" || -z "$GCP_PROJECT" ]]; then
  echo "Missing required args."
  echo "Example:"
  echo "  $0 --supabase-project-ref cszorvgzihzamgezlfjj --gcp-project mindsparkle"
  exit 1
fi

command -v supabase >/dev/null 2>&1 || { echo "supabase CLI not found"; exit 1; }
command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found (brew install jq)"; exit 1; }

TMP_KEYS_JSON="$(mktemp)"
trap 'rm -f "$TMP_KEYS_JSON"' EXIT

# Fetch keys JSON (do not print)
supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF" --output json > "$TMP_KEYS_JSON"

SERVICE_KEY="$(jq -r '.[] | select(.name=="service_role") | .api_key' "$TMP_KEYS_JSON")"
if [[ -z "$SERVICE_KEY" || "$SERVICE_KEY" == "null" ]]; then
  echo "Failed to read service_role key from Supabase CLI output"
  exit 1
fi

if gcloud secrets describe "$SECRET_NAME" --project "$GCP_PROJECT" >/dev/null 2>&1; then
  printf '%s' "$SERVICE_KEY" | gcloud secrets versions add "$SECRET_NAME" --project "$GCP_PROJECT" --data-file=- >/dev/null
  echo "updated secret: $SECRET_NAME"
else
  printf '%s' "$SERVICE_KEY" | gcloud secrets create "$SECRET_NAME" --project "$GCP_PROJECT" --replication-policy=automatic --data-file=- >/dev/null
  echo "created secret: $SECRET_NAME"
fi

unset SERVICE_KEY
