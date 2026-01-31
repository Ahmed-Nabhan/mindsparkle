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

  echo "Checking required Edge Function secrets..."
  if ! npx supabase secrets list --project-ref "$PROJECT_REF" --token "$ACCESS_TOKEN" | grep -q "OPENAI_API_KEY"; then
    echo "❌ Missing Supabase secret: OPENAI_API_KEY"
    echo "Set it securely (do NOT commit it):"
    echo "  npx supabase secrets set OPENAI_API_KEY=\"YOUR_OPENAI_KEY\" --project-ref \"$PROJECT_REF\" --token \"$ACCESS_TOKEN\""
    exit 1
  fi

  npx supabase functions deploy openai-proxy --project-ref "$PROJECT_REF" --token "$ACCESS_TOKEN"
else
  echo "Deploying using local supabase CLI (ensure you're logged in)..."

  echo "Checking required Edge Function secrets..."
  if ! supabase secrets list | grep -q "OPENAI_API_KEY"; then
    echo "❌ Missing Supabase secret: OPENAI_API_KEY"
    echo "Set it securely (do NOT commit it):"
    echo "  supabase secrets set OPENAI_API_KEY=\"YOUR_OPENAI_KEY\""
    exit 1
  fi

  supabase functions deploy openai-proxy
fi

echo "Deployment finished."
