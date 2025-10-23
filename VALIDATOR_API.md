# Validator Integration Requirements

This document describes the API surface and push notifications the backend expects from the LiquidityGuard Validator/Detector service. The goal is to replace all backend mocks with real data and signatures.

---

## 1. REST API (backend → validator)

All endpoints are assumed to live under `/validator/api`. Responses must be JSON with `Content-Type: application/json`. Authentication should rely on a shared secret (HMAC) or validator ECDSA signatures.

### 1.1 `GET /v1/risk`
List all risks with current status and telemetry.

**Response**
```json
{
  "items": [
    {
      "riskId": "0x...",
      "product": "DEPEG_LP",
      "poolId": "curve-pyusd-usdc",
      "state": "GREEN",
      "updatedAt": 1700000000,
      "latestWindow": {
        "S": 1700100000,
        "E": 1700120000
      },
      "metrics": {
        "twap1h": "0.985",
        "twap4h": "0.95",
        "liquidityUSD": "23000000"
      }
    }
  ]
}
```

### 1.2 `GET /v1/risk/{riskId}`
Detailed state for a single risk (same payload as above plus optional history of windows).

### 1.3 `POST /v1/claims/preview`
Request payout calculation for a policy.

**Request**
```json
{
  "policy": {
    "policyId": "1",
    "product": "DEPEG_LP",
    "riskId": "0x...",
    "owner": "0xWallet",
    "insuredAmount": "1000000000",
    "coverageCap": "800000000",
    "deductibleBps": 500,
    "startAt": 1700000000,
    "activeAt": 1700086400,
    "endAt": 1702700000,
    "claimedUpTo": 0,
    "metadata": {
      "poolId": "curve-pyusd-usdc"
    }
  },
  "claimMode": "FINAL",
  "timestamp": 1700500000
}
```

**Response**
```json
{
  "riskId": "0x...",
  "policyId": "1",
  "S": 1700400000,
  "E": 1700600000,
  "Lstar": "950000000",
  "refValue": "980000000",
  "curValue": "250000000",
  "payout": "730000000",
  "twapStart": "0.94",
  "twapEnd": "0.99",
  "snapshots": {
    "startCid": "bafy...",
    "endCid": "bafy..."
  },
  "inputs": {
    "minHeldBalance": "950000000",
    "deductibleApplied": "36500000",
    "coverageCapApplied": true
  }
}
```

### 1.4 `POST /v1/claims/sign`
Returns EIP-712 payload and signature for the payout.

**Response**
```json
{
  "policyId": "1",
  "riskId": "0x...",
  "typedData": {
    "domain": { "name": "LiquidityGuardPayout", "version": "1", "chainId": 1, "verifyingContract": "0xPayoutModule" },
    "types": {
      "ClaimPayload": [
        { "name": "policyId", "type": "uint256" },
        { "name": "riskId", "type": "bytes32" },
        { "name": "S", "type": "uint64" },
        { "name": "E", "type": "uint64" },
        { "name": "Lstar", "type": "uint256" },
        { "name": "refValue", "type": "uint256" },
        { "name": "curValue", "type": "uint256" },
        { "name": "payout", "type": "uint256" },
        { "name": "nonce", "type": "uint256" },
        { "name": "deadline", "type": "uint256" }
      ]
    },
    "message": {
      "policyId": "1",
      "riskId": "0x...",
      "S": 1700400000,
      "E": 1700600000,
      "Lstar": "950000000",
      "refValue": "980000000",
      "curValue": "250000000",
      "payout": "730000000",
      "nonce": "2",
      "deadline": 1700650000
    }
  },
  "signature": "0x...",
  "expiresAt": 1700650000,
  "calc": {
    "snapshots": { "startCid": "bafy...", "endCid": "bafy..." },
    "twap": { "start": "0.94", "end": "0.99" },
    "proofs": [
      { "label": "curveSnapshot", "link": "ipfs://bafy..." }
    ]
  }
}
```

---

## 2. Push Notifications (validator → backend)

Validator should POST signed JSON payloads to backend webhooks (e.g. `/internal/validator/...`). Each webhook must include an idempotency `eventId` and validator signature.

### 2.1 Depeg window events
`POST /internal/validator/anchors`
```json
{
  "type": "DEPEG_START",
  "riskId": "0x...",
  "timestamp": 1700400000,
  "twapE18": "940000000000000000",
  "snapshotCid": "bafy...",
  "txHash": "0x...",
  "signature": "0xvalidatorSig"
}
```
Analogous payload for `DEPEG_END`.

### 2.2 Depeg liquidation evidence
```json
{
  "type": "DEPEG_LIQ",
  "riskId": "0x...",
  "liquidationId": "0x...",
  "user": "0xPolicyOwner",
  "timestamp": 1700450000,
  "twapE18": "900000000000000000",
  "hfBeforeE4": 11500,
  "hfAfterE4": 9200,
  "snapshotCid": "bafy...",
  "txHash": "0x...",
  "signature": "0x..."
}
```

### 2.3 Pool state updates
`POST /internal/validator/pool-state`
```json
{
  "riskId": "0x...",
  "state": "YELLOW",
  "reason": "TWAP_1h < 0.985",
  "details": {
    "twap1h": "0.983",
    "twap4h": "0.991",
    "thresholds": { "warning": 0.985, "critical": 0.95 }
  },
  "timestamp": 1700500000,
  "signature": "0x..."
}
```

### 2.4 Optional: premium quotes
If the validator is the source of pricing, it can push quotes via `/internal/validator/quote` with fields such as `premiumUsd`, `coverageCapUsd`, `deductibleBps`, etc., signed by validator key.

---

## 3. Security & Delivery Requirements

- All requests/responses must be JSON.
- Use HMAC or ECDSA signatures (validator private key exposed in on-chain contracts) to authenticate both REST requests and webhooks.
- Include `expiresAt`/`deadline` values for signatures.
- Webhooks must contain an idempotent `eventId`; backend will store and ignore duplicates.
- Provide CID/IPFS references for all snapshots used in calculations.

---

## 4. Validator Responsibilities

1. Maintain historical and on-chain data for Curve/Aave pools (reserves, TWAP, health factor, transfers, etc.).
2. Detect depeg windows and update risk statuses (green/yellow/red).
3. Compute min-held LP balances for wallets (`minHeldLP[S,E]`).
4. Calculate payouts according to product formulas (including deductible and coverage caps).
5. Anchor depeg events and liquidation evidence on-chain (`OracleAnchors`), then push notifications to the backend.
6. Sign EIP-712 payloads with the validator key registered in `PayoutModule`.
7. Expose the REST API described above.

With the API defined here, the backend can operate without mocks: we will read risk states, compute quotes, preview claims, and submit signed payloads originating from the validator service.
