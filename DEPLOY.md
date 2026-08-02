# Deploying ShadowPool to Render

ShadowPool deploys as **one service**. The node serves the API at `/api/*` and the
statically-exported frontend at every other path, from the same origin — so there's no second
service, no cross-service URL to configure, and no CORS.

The contracts are already live on Coston2; deploying does not touch them.

---

## Before you start: two things that will bite you

**1. The enclave key must survive restarts.** By default the node generates its keypair into
`services/.data/enclave-keys.json` on first boot. Render's filesystem is ephemeral, so a
redeploy would generate a *new* key — which would no longer match the `teeSigner` registered
on-chain, and **every settlement would revert with `InvalidAttestation`**. The node therefore
reads `ENCLAVE_BOX_SECRET` and `ENCLAVE_SIGNER_KEY` from the environment when present. Set
them and the enclave identity stays stable.

**2. Free instances sleep after 15 minutes of inactivity** and take ~50s to wake. A sleeping
node doesn't match orders. Keeping a browser tab open holds it awake (the UI polls every few
seconds); a paid instance (~$7/month) removes the cold start entirely.

---

## Step 1 — Collect the environment values

Run this locally; it writes every value you need into one gitignored file:

```bash
cd /path/to/shadowpool
node -e '
const k = require("./services/.data/enclave-keys.json");
const relay = require("fs").readFileSync("./contracts/.env","utf8").match(/PRIVATE_KEY=(\S+)/)[1];
console.log([
  "RPC_URL=https://coston2-api.flare.network/ext/C/rpc",
  "DEPLOYMENT_FILE=../contracts/deployments/114.json",
  "RELAY_KEY=" + relay,
  "ENCLAVE_BOX_SECRET=" + k.boxSecretHex,
  "ENCLAVE_SIGNER_KEY=" + k.signerKeyHex,
].join("\n"));
' > services/.data/render-env.txt
open -e services/.data/render-env.txt
```

> These are private keys. Paste them into Render's dashboard — don't commit them or send them
> over chat.

The enclave keys in that file already match the `teeSigner` registered on-chain, so nothing
needs re-registering. To use a fresh identity instead, delete
`services/.data/enclave-keys.json`, run `npm start` once, then:
```bash
cast send 0x3A552EB014a19ED2F09121F472431fB0910DFaaa 'setTeeSigner(address)' <new signer> \
  --private-key $PRIVATE_KEY --rpc-url https://coston2-api.flare.network/ext/C/rpc --legacy
```

## Step 2 — Create the service

**Either** Render → **New → Blueprint** → connect `Zaheer-sol/shadowpool` (it reads
`render.yaml` and configures everything), **or** a plain **Web Service** with:

| Setting | Value |
|---|---|
| Root Directory | *(leave blank — repo root)* |
| Build Command | `npm install` |
| Start Command | `npm start` |

Both work: the repo root has a `package.json` that builds the node and the frontend, and starts
the node.

## Step 3 — Add the environment variables

In the service's **Environment** tab, use **Add from .env** and paste all five lines from
`render-env.txt` at once. Save.

## Step 4 — Deploy and watch one line

Deploy (or **Resume Service** if it's suspended). Success looks like:

```
enclave keys loaded from environment
deployment loaded for chain 114: engine 0x3A552EB0…
api listening on port 10000
```

If you see **`generated new enclave keys`** instead, the enclave variables didn't apply — that
single line is the fastest diagnosis.

## Step 5 — Verify it actually works

```bash
curl https://<your-service>.onrender.com/api/enclave | jq '{chainId, status, signerAddress}'
```

`chainId` must be `114`, and `signerAddress` must equal the on-chain signer:

```bash
cast call 0x3A552EB014a19ED2F09121F472431fB0910DFaaa 'teeSigner()(address)' \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
```

**If those differ, settlements will fail.** Then open the URL in a browser — the header should
read "Enclave active · Coston2".

Finally, prove it settles rather than merely serving pages:

```bash
cd services
API_URL=https://<your-service>.onrender.com \
RPC_URL=https://coston2-api.flare.network/ext/C/rpc \
npx tsx scripts/simulate.ts
```

`FULL LIFECYCLE OK ✓` means the hosted deployment genuinely works.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Couldn't find a package.json file in "/opt/render/project/src"` | Old config; the repo root now has a `package.json`. Deploy the latest commit |
| `EROFS: read-only file system, unlink '/usr/bin/pnpm'` | `corepack enable` can't run on Render — the build uses plain npm now |
| `Cannot read properties of null (reading 'matches')` | Stale build cache from a different package manager. Builds now clear `node_modules` first; "Clear build cache & deploy" also fixes it |
| `ECONNREFUSED 127.0.0.1:8545` | `RPC_URL` not set — the node fell back to a local chain |
| `generated new enclave keys` | `ENCLAVE_BOX_SECRET` / `ENCLAVE_SIGNER_KEY` not set |
| 503 with `x-render-routing: suspend` | Service suspended or spun down — resume it |

## Notes

- **Trade history resets on redeploy.** `services/.data/trades.json` is ephemeral, so Analytics
  starts empty. Mount a Render persistent disk at `services/.data` to keep it.
- **The relay key needs C2FLR** for settlement gas — top up at
  [the faucet](https://faucet.flare.network).
- **Don't reuse the relay key as the enclave signer.** Different roles: the relay pays gas and
  is exposed to the host; the enclave key authorizes settlements.
