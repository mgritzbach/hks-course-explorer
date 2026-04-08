#!/bin/bash
# Upload courses.json to Cloudflare KV
# Run ONCE after creating the KV namespace in the Cloudflare dashboard.
# Usage: bash scripts/upload_to_kv.sh <KV_NAMESPACE_ID> <ACCOUNT_ID> <API_TOKEN>
#
# You can also use wrangler if installed:
#   npx wrangler kv:key put --namespace-id=<NS_ID> "courses_data" --path=public/courses.json

NAMESPACE_ID="$1"
ACCOUNT_ID="$2"
API_TOKEN="$3"

if [ -z "$NAMESPACE_ID" ] || [ -z "$ACCOUNT_ID" ] || [ -z "$API_TOKEN" ]; then
  echo "Usage: bash scripts/upload_to_kv.sh <KV_NAMESPACE_ID> <ACCOUNT_ID> <API_TOKEN>"
  echo ""
  echo "Find these in your Cloudflare dashboard:"
  echo "  - ACCOUNT_ID: top-right of any page on dash.cloudflare.com"
  echo "  - KV_NAMESPACE_ID: Workers & Pages > KV > your namespace"
  echo "  - API_TOKEN: My Profile > API Tokens > Create Token (use 'Edit Workers KV Storage' template)"
  exit 1
fi

DATA=$(cat public/courses.json)

curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/courses_data" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-raw "$DATA"

echo ""
echo "Done! courses_data uploaded to KV namespace ${NAMESPACE_ID}"
