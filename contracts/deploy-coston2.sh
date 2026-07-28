#!/usr/bin/env bash
# One-command Coston2 deployment.
#
# Prereqs:
#   1. contracts/.env holds PRIVATE_KEY (cast wallet new) — already generated.
#   2. The deployer address is funded with C2FLR: https://faucet.flare.network (Coston2 tab).
#   3. The ShadowPool node has run at least once locally so services/.data/enclave-keys.json
#      exists — its signer address is registered as the TEE signer on-chain.
set -euo pipefail
cd "$(dirname "$0")"

source .env
RPC=https://coston2-api.flare.network/ext/C/rpc

BALANCE=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url $RPC)
echo "deployer $DEPLOYER_ADDRESS balance: $BALANCE wei"
if [ "$BALANCE" = "0" ]; then
  echo "✗ Not funded. Get C2FLR at https://faucet.flare.network then re-run."
  exit 1
fi

# Enclave signer from the node's sealed-storage stand-in.
TEE_SIGNER=$(node -e '
  const { Wallet } = require("../services/node_modules/ethers");
  const k = require("../services/.data/enclave-keys.json");
  console.log(new Wallet(k.signerKeyHex).address);
')
echo "registering TEE signer: $TEE_SIGNER"

PRIVATE_KEY=$PRIVATE_KEY TEE_SIGNER=$TEE_SIGNER \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --legacy

echo
echo "✓ Deployed. Record written to deployments/114.json"
echo "Next:"
echo "  node:     cd ../services && RPC_URL=$RPC RELAY_KEY=\$PRIVATE_KEY pnpm start"
echo "  frontend: cd ../web && NEXT_PUBLIC_API_URL=<node-url> pnpm build"
