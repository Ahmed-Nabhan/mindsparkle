#!/usr/bin/env bash
# Deploy the openai-proxy Supabase Edge Function
# Requirements: supabase CLI installed and authenticated or use SUPABASE_ACCESS_TOKEN

set -e
FUNC_DIR="supabase/functions/openai-proxy"
PROJECT_REF=${SUPABASE_PROJECT_REF:-}
ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN:-}

if [ -z "$ACCESS_TOKEN" ] && ! command -v supabase >/dev/null 2>&1; then
  echo "Error: supabase CLI not installed and SUPABASE_ACCESS_TOKEN not set."
  echo "Install CLI: npm install -g supabase"
  exit 1
fi

if [ -n "$ACCESS_TOKEN" ]; then
  echo "Deploying using SUPABASE_ACCESS_TOKEN..."
  npx supabase functions deploy openai-proxy --project-ref "$PROJECT_REF" --token "$ACCESS_TOKEN"
else
  echo "Deploying using local supabase CLI (ensure you're logged in)..."
  supabase functions deploy openai-proxy
fi

echo "Deployment finished."
