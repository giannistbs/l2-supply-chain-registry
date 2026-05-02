#!/usr/bin/env bash
# Deploy PackageRegistry to all three L2 Sepolia testnets.
# Requires env: PRIVATE_KEY, and one or more of:
#   SCROLL_SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL, ARBITRUM_SEPOLIA_RPC_URL
# Records addresses in deployments.json.
set -euo pipefail

cd "$(dirname "$0")/.."

DEPLOYMENTS_FILE="deployments.json"
[[ -f "$DEPLOYMENTS_FILE" ]] || echo '{}' > "$DEPLOYMENTS_FILE"

deploy_to() {
  local name=$1
  local rpc_var=$2
  local rpc_url=${!rpc_var:-}
  if [[ -z "$rpc_url" ]]; then
    echo "[skip] $name: $rpc_var not set"
    return
  fi
  echo "[deploy] $name via $rpc_var"
  local out
  out=$(forge script script/Deploy.s.sol:Deploy --rpc-url "$rpc_url" --broadcast --slow 2>&1)
  echo "$out" | tail -5
  local chain_dir
  chain_dir=$(ls -td broadcast/Deploy.s.sol/*/ | head -1)
  local addr
  addr=$(jq -r '.transactions[0].contractAddress' "${chain_dir}/run-latest.json")
  echo "[$name] deployed at $addr"
  tmp=$(mktemp)
  jq --arg k "$name" --arg v "$addr" '.[$k] = $v' "$DEPLOYMENTS_FILE" > "$tmp" && mv "$tmp" "$DEPLOYMENTS_FILE"
}

deploy_to "scroll-sepolia"   SCROLL_SEPOLIA_RPC_URL
deploy_to "base-sepolia"     BASE_SEPOLIA_RPC_URL
deploy_to "arbitrum-sepolia" ARBITRUM_SEPOLIA_RPC_URL

echo "Final deployments:"
cat "$DEPLOYMENTS_FILE"
