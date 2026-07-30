# Deploying ShadowPool to Render

Two services: the **node** (matching enclave + relay + API) and the **web** frontend. Both are
defined in [`render.yaml`](render.yaml), so Render can deploy them as one Blueprint.

The contracts are already live on Coston2 — deployment does not touch them.

---

## Before you start: two Render-specific traps

**1. The enclave key must survive restarts.** By default the node generates its keypair into
`services/.data/enclave-keys.json` on first boot. Render's filesystem is ephemeral, so a
redeploy would generate a *new* key — which would no longer match the `teeSigner` registered
on-chain, and **every settlement would revert with `InvalidAttestation`**. The node therefore
reads `ENCLAVE_BOX_SECRET` and `ENCLAVE_SIGNER_KEY` from the environment when present. Set
them as secrets and the enclave identity stays stable.

**2. Free instances sleep after 15 minutes of inactivity.** A sleeping node doesn't match
orders. It wakes on the first HTTP request (~50s), and the frontend polls the API every few
seconds, so an open browser tab keeps it awake. For a judged demo, either keep a tab open or
use a paid instance (~$7/month) to avoid a cold start mid-presentation.

---

## Step 1 — Get your enclave key values

Run this **locally** and copy the two values. They already correspond to the signer registered
on-chain for the live Coston2 deployment, so nothing needs re-registering:

```bash
cd services
node -e 'const k=require("./.data/enclave-keys.json");
console.log("ENCLAVE_BOX_SECRET =", k.boxSecretHex);
console.log("ENCLAVE_SIGNER_KEY =", k.signerKeyHex);'
```

> Paste these straight into Render's dashboard. Don't commit them, don't send them over chat.

If you'd rather use a fresh enclave identity, delete `services/.data/enclave-keys.json`, run
`pnpm start` once to generate a new one, then re-register its signer on-chain:
```bash
cast send <SettlementEngine> 'setTeeSigner(address)' <new signer address> \
  --private-key $PRIVATE_KEY --rpc-url https://coston2-api.flare.network/ext/C/rpc --legacy
```

## Step 2 — Deploy the Blueprint

> **Use Blueprint, not "Web Service".** This repo has no root `package.json` — the two apps
> live in `services/` and `web/`. Only a Blueprint reads `render.yaml`, which is what sets
> each service's root directory and commands. Creating a plain Web Service instead makes
> Render run `yarn` at the repo root and fail with
> `Couldn't find a package.json file in "/opt/render/project/src"`.
>
> If you already created a plain Web Service, delete it and redo it as a Blueprint — or set,
> per service: **Root Directory** `services` (or `web`), **Build Command**
> `corepack enable && pnpm install --frozen-lockfile` (append `&& pnpm build` for web), and
> **Start Command** `pnpm start`.

1. Render → **New** → **Blueprint** → connect the GitHub repo (`Zaheer-sol/shadowpool`).
2. Render reads `render.yaml` and proposes two services.
3. It prompts for the secrets marked `sync: false`:

| Variable | Service | Value |
|---|---|---|
| `RELAY_KEY` | shadowpool-node | A **funded Coston2 private key** — pays gas for settlement transactions |
| `ENCLAVE_BOX_SECRET` | shadowpool-node | From step 1 |
| `ENCLAVE_SIGNER_KEY` | shadowpool-node | From step 1 |
| `NEXT_PUBLIC_API_URL` | shadowpool-web | Leave blank for now — set it in step 3 |

4. Deploy. Watch the node's logs for `enclave keys loaded from environment`, then
   `api listening on port …`.

## Step 3 — Point the frontend at the node

Once `shadowpool-node` is live, copy its URL (e.g. `https://shadowpool-node.onrender.com`) and
set it as `NEXT_PUBLIC_API_URL` on **shadowpool-web**, then **Manual Deploy → Clear build cache
& deploy**. `NEXT_PUBLIC_*` values are baked in at build time, so a restart alone won't pick it
up.

## Step 4 — Verify

```bash
curl https://<your-node>.onrender.com/api/enclave | jq '{chainId, status, signerAddress}'
```

Expect `chainId: 114` and a `signerAddress` matching the on-chain `teeSigner`:

```bash
cast call 0x3A552EB014a19ED2F09121F472431fB0910DFaaa 'teeSigner()(address)' \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
```

**If those two addresses differ, settlements will fail** — the enclave secrets are wrong or
weren't applied. Then open the web URL: the header should read "Enclave active · Coston2".

## Step 5 — End-to-end check against the deployed node

From your machine, pointing the scripts at the hosted API:

```bash
cd services
API_URL=https://<your-node>.onrender.com \
RPC_URL=https://coston2-api.flare.network/ext/C/rpc \
pnpm tsx scripts/simulate.ts
```

`FULL LIFECYCLE OK ✓` means the hosted deployment is genuinely working, not just serving pages.

---

## Notes

- **Trade history resets on redeploy.** `services/.data/trades.json` is ephemeral, so the
  Analytics page starts empty after each deploy. Attach a Render persistent disk mounted at
  `services/.data` if you want it to survive.
- **The relay key needs C2FLR.** Each settlement costs gas. Top up from
  [the faucet](https://faucet.flare.network) if settlements start failing.
- **Don't reuse the relay key as the enclave signer.** They're different roles: the relay key
  pays gas and is exposed to the host, while the enclave key authorizes settlements.
- **Region:** put both services in the same region to keep the frontend↔API hop short.
