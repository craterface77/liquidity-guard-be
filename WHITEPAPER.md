# LiquidityGuard Protocol

## Table of Contents

1. [Introduction](#introduction)
2. [Problem Statement](#problem-statement)
3. [Solution Architecture](#solution-architecture)
4. [Products](#products)
5. [Technical Implementation](#technical-implementation)
6. [Oracle System](#oracle-system)
7. [Pricing Model](#pricing-model)
8. [Security & Risk Management](#security--risk-management)
9. [Integration Points](#integration-points)

---

## Introduction

LiquidityGuard is a decentralized insurance protocol designed to protect DeFi users from two critical risk vectors:

- **Stablecoin depeg events** affecting liquidity pool positions
- **Liquidation cascades** triggered by collateral depegs on lending protocols

The protocol operates across three main components:

- Smart contracts (Solidity) handling policy issuance and payouts
- Backend service (Fastify + PostgreSQL) orchestrating business logic
- Validator service (Fastify + ClickHouse) monitoring on-chain events and providing oracle data

---

## Problem Statement

### 1. Stablecoin Depeg Risk

When stablecoins deviate significantly from their $1.00 peg, liquidity providers in AMM pools face:

- Impermanent loss amplification
- Inability to exit positions without significant slippage
- Cascading price impacts affecting the broader DeFi ecosystem

Historical example: USDC depeg (March 2023) caused $100M+ in losses across Curve pools.

### 2. Liquidation Cascade Risk

Stablecoin depegs directly impact lending protocols:

- User positions become undercollateralized
- Automated liquidations execute at unfavorable prices
- Collateral loss compounds the depeg impact

Example: When PYUSD depegs from $1.00 to $0.90, borrowers using PYUSD as collateral on Aave face liquidation even if their actual debt position hasn't changed.

---

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     USER (Web Browser)                       │
└────────────┬────────────────────────────────────────────────┘
             │
             │ Wallet Connect (WalletConnect v3)
             │
┌────────────▼────────────────────────────────────────────────┐
│         Frontend (Next.js + wagmi + viem)                    │
│  - Insurance dashboard UI                                    │
│  - Wallet integration (MetaMask, WalletConnect, Coinbase)    │
│  - Contract interactions (approve, buyPolicy, executeClaim)  │
│  - Real-time policy status updates                           │
└────────┬──────────────────────────────┬─────────────────────┘
         │                              │
         │ REST API calls               │ On-chain txs
         │                              │
┌────────▼──────────────────────┐   ┌──▼────────────────────────┐
│  Backend API (Fastify + PG)   │   │  Smart Contracts (Base)    │
│  - Pricing engine             │   │  - PolicyDistributor       │
│  - Policy drafts              │   │  - PolicyNFT               │
│  - Claim coordination         │   │  - PayoutModule            │
│  - Validator proxy            │   │  - ReservePool             │
│  - Admin operations           │   │  - OracleAnchors           │
└────────┬──────────────────────┘   └──┬────────────────────────┘
         │                              │
         │ HMAC webhooks                │ Write anchors
         │ REST API calls               │ Sign claims
         │                              │
┌────────▼──────────────────────────────▼─────────────────────┐
│      Validator Service (Fastify + ClickHouse)               │
│  - Curve pool monitoring (60s polls)                        │
│  - Aave liquidation detection                               │
│  - Depeg state machine (15min grace period)                 │
│  - EIP-712 claim signing                                    │
│  - Time-series storage (OLAP queries)                       │
│  - IPFS snapshot uploads                                    │
└────────┬────────────────────────────────────────────────────┘
         │
         │ RPC calls (Chainlink, contract reads)
         │ Hermes API (Pyth Network)
         │
┌────────▼────────────────────────────────────────────────────┐
│                    Blockchain Layer                          │
│  - Chainlink Price Feeds (PYUSD/USD)                        │
│  - Pyth Hermes API (fallback)                               │
│  - Curve Pool contracts (get_dy, balances)                  │
│  - Aave LendingPool (LiquidationCall events)                │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Smart Contracts:**

- Policy NFT minting and lifecycle management
- Premium collection and reserve management
- Payout execution based on validator signatures
- Oracle anchor storage for claim verification

**Backend API:**

- Quote generation with EIP-712 signatures
- Policy draft creation and finalization
- Claim request coordination with validator
- Webhook ingestion from validator

**Validator Service:**

- Real-time monitoring of Curve pools and Aave liquidations
- TWAP calculation and depeg detection
- Claim payload generation with EIP-712 signatures
- Snapshot storage (IPFS) for claim verification

---

## Products

### 1. DEPEG_LP (Curve Pool Depeg Protection)

**Coverage:** Protects LP token holders against losses from stablecoin depegs

**Trigger Conditions:**

- TWAP deviates >2% from peg ($0.98 or lower)
- Reserve ratio drops below threshold
- Event persists for minimum duration (configurable)

**Payout Formula:**

```
severity = max(lossQuoteBps - deductibleBps, 0)
rawPayout = (coverageCap × 8000 × severity) / (10000 × 10000)
payout = min(rawPayout, coverageCap)
```

Where:

- `lossQuoteBps`: Measured loss in basis points
- `deductibleBps`: 500 (5% deductible)
- Coverage cap: 90% of insured LP value

**Example:**

```
Insured: 10,000 LP tokens @ $0.99 = $9,900
Coverage Cap: $8,910 (90%)
Depeg: TWAP drops to $0.94 (6% loss)
Deductible: 5%
Net severity: 1% (6% - 5%)
Payout: ~$890
```

### 2. AAVE_DLP (Aave Liquidation Protection)

**Coverage:** Protects borrowers against collateral loss caused by stablecoin depeg events

**Trigger Conditions:**

- Collateral asset (e.g., PYUSD) price drops >2% from peg
- Liquidation occurs within 1-hour correlation window
- User holds active policy for affected collateral

**Payout Formula:**

```
maxPayout = coverageCap × (1 - deductibleBps/10000)
severity = (pegPrice - actualPrice) / pegPrice
payout = min(maxPayout, severity × insuredAmount)
```

Where:

- `coverageCap`: 10% of insured collateral amount
- `deductibleBps`: 500 (5% deductible)
- Correlation window: 3600 seconds (1 hour)

**Example:**

```
Insured: $10,000 PYUSD collateral
Coverage Cap: $1,000 (10%)
Depeg: PYUSD drops to $0.92 (8% loss)
Liquidation occurs 30 minutes after depeg start
Payout: $800 (8% loss on $10k, within cap)
```

---

## Technical Implementation

### Policy Lifecycle

**1. Quote Generation**

Backend receives quote request:

```json
{
  "product": "DEPEG_LP",
  "poolId": "curve-usdc-usdf",
  "insuredLP": "10000000000000000000",
  "termDays": 30
}
```

Backend calculates premium using pricing model and signs EIP-712 quote:

```typescript
const quote = {
  product: "DEPEG_LP",
  poolId: poolId,
  insuredLP: insuredLP,
  termDays: termDays,
  premiumUSD: calculatedPremium,
  coverageCapUSD: calculatedCap,
  cliffHours: 24,
  deductibleBps: 500,
  nonce: generateNonce(),
  deadline: Date.now() + 3600000,
};

const signature = await signer.signTypedData(domain, types, quote);
```

**2. Policy Purchase**

User calls `PolicyDistributor.buyPolicy()` with signed quote:

- USDC premium payment approved and transferred
- Policy NFT minted to user address
- Policy metadata stored on-chain

**3. Policy Finalization**

Frontend submits transaction hash to backend:

```
POST /v1/policies/:draftId/finalize
Body: { txHash: "0x..." }
```

Backend:

- Verifies transaction on-chain
- Extracts policy parameters from receipt
- Stores policy in PostgreSQL (atomic transaction)
- Deletes temporary draft

**4. Claim Submission**

User requests claim preview:

```
POST /v1/claim/preview
Body: { policyId: "123" }
```

Backend delegates to validator:

```
POST /validator/v1/claims/preview
Headers: { x-lg-hmac: calculatedHmac }
Body: { policy: { ...policyData }, claimMode: "FINAL" }
```

Validator:

- Queries ClickHouse for relevant depeg windows
- Calculates minimum held LP balance during period
- Computes payout based on product formula
- Returns preview with IPFS snapshot CIDs

User confirms and requests signature:

```
POST /v1/claim/sign
Body: { policyId: "123" }
```

Validator signs EIP-712 claim payload:

```typescript
const claimPayload = {
  policyId: policy.id,
  riskId: policy.riskId,
  S: depegWindow.start,
  E: depegWindow.end,
  Lstar: minHeldBalance,
  refValue: startValue,
  curValue: endValue,
  payout: calculatedPayout,
  nonce: nextNonce,
  deadline: now + 3600,
};

const signature = await validatorSigner.signTypedData(
  domain,
  types,
  claimPayload
);
```

User executes claim on-chain:

```solidity
PayoutModule.executeClaim(signature, claimPayload);
```

Contract verifies signature matches registered validator and transfers payout.

### Validator Event Detection

**Curve Pool Monitoring (DEPEG_LP)**

Every polling interval (10 seconds):

1. Query current pool reserves from on-chain
2. Calculate instantaneous price: `dy/dx`
3. Update TWAP with exponential moving average
4. Compare TWAP against thresholds ($0.98, $0.95)
5. If threshold breached:
   - Create risk event in ClickHouse
   - Submit oracle anchor transaction
   - Send webhook to backend (`DEPEG_START`)
6. Monitor until price recovers, then send `DEPEG_END` webhook

**Aave Liquidation Monitoring (AAVE_DLP)**

Every polling interval:

1. Fetch PYUSD price from Chainlink feed
2. If Chainlink fails, fallback to Pyth Network
3. Calculate deviation from $1.00 peg
4. If deviation >2%:
   - Open depeg window (1 hour)
   - Monitor for `LiquidationCall` events on Aave
5. For each liquidation where `collateralAsset == PYUSD`:
   - Store liquidation details in ClickHouse
   - Calculate health factor before/after
   - Submit oracle anchor transaction
   - Send webhook to backend (`DEPEG_LIQ`)
6. Close window when price recovers

### Database Schema

**PostgreSQL (Backend)**

```sql
-- Policy lifecycle
CREATE TABLE policies (
  id SERIAL PRIMARY KEY,
  policy_id TEXT UNIQUE NOT NULL,
  product TEXT NOT NULL,
  wallet TEXT NOT NULL,
  risk_id TEXT NOT NULL,
  insured_amount NUMERIC NOT NULL,
  coverage_cap NUMERIC NOT NULL,
  premium_usd NUMERIC NOT NULL,
  deductible_bps INTEGER NOT NULL,
  start_at BIGINT NOT NULL,
  active_at BIGINT NOT NULL,
  end_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  claimed_up_to NUMERIC DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Claims tracking
CREATE TABLE claims (
  id SERIAL PRIMARY KEY,
  policy_id INTEGER REFERENCES policies(id),
  payout_amount NUMERIC NOT NULL,
  status TEXT NOT NULL,
  risk_event_id TEXT,
  signature TEXT,
  tx_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**ClickHouse (Validator)**

```sql
-- Time-series pool data
CREATE TABLE pool_samples (
  sample_id String,
  risk_id String,
  timestamp UInt64,
  reserve0 String,
  reserve1 String,
  price_0_1 Float64,
  twap_1h Float64,
  twap_4h Float64,
  liquidity_usd Float64,
  tags Array(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(timestamp))
ORDER BY (risk_id, timestamp);

-- Depeg events
CREATE TABLE risk_events (
  event_id String,
  risk_id String,
  risk_type String,
  event_type String,
  timestamp UInt64,
  window_start UInt64,
  window_end Nullable(UInt64),
  severity_bps Nullable(UInt32),
  metadata String,
  snapshot_cid Nullable(String),
  created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (risk_id, timestamp);

-- Aave liquidations
CREATE TABLE liquidations (
  liquidation_id String,
  risk_id String,
  pool_id String,
  user_address String,
  collateral_asset String,
  debt_asset String,
  liquidated_collateral_amount String,
  debt_covered String,
  liquidator String,
  timestamp UInt64,
  block_number UInt64,
  tx_hash String,
  health_factor_before Nullable(String),
  health_factor_after Nullable(String),
  price_at_liquidation Nullable(Float64),
  deviation_bps Nullable(UInt32),
  created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(timestamp))
ORDER BY (pool_id, timestamp, liquidation_id);
```

---

## Oracle System

### Dual Oracle Architecture

The validator implements a redundant oracle system for maximum reliability:

**Primary: Chainlink Price Feeds**

- Battle-tested, decentralized oracle network
- Push-based updates (typically 0.5% deviation threshold)
- High trust, used by major DeFi protocols

**Fallback: Pyth Network**

- Ultra-low latency (400ms updates)
- Pull-based model (on-demand price updates)
- 100+ blockchain support via Hermes API

**Automatic Failover Logic:**

```typescript
async function getCollateralPrice(
  chainlinkFeed: string,
  pythFeedId: string
): Promise<number> {
  try {
    const chainlinkPrice = await chainlinkOracle.latestAnswer(chainlinkFeed);
    return chainlinkPrice / 1e8;
  } catch (error) {
    logger.warn("chainlink_fetch_failed_trying_pyth");
    const pythPrice = await pythOracle.getLatestPrice(pythFeedId);
    return pythPrice.price;
  }
}
```

**Benefits:**

- 99.99%+ uptime through redundancy
- Faster updates during volatility (Pyth's 400ms latency)
- No single point of failure
- Cost optimization (Pyth free via Hermes API)

### Oracle Anchor System

All detected events are anchored on-chain via `OracleAnchors` contract:

```solidity
struct Anchor {
  bytes32 riskId;
  uint64 timestamp;
  AnchorType anchorType;  // DEPEG_START, DEPEG_END, DEPEG_LIQ
  bytes32 dataHash;       // keccak256(abi.encode(eventData))
  string snapshotCid;     // IPFS CID of full snapshot
}
```

This provides:

- Immutable event record for claim verification
- Gas-efficient on-chain reference
- Full data availability via IPFS
- Trustless audit trail

---

## Pricing Model

### Term-Based Rates

Base premium rates scale with policy duration:

```typescript
const TERM_BASE_RATE = {
  10: 0.01, // 1.0%
  20: 0.015, // 1.5%
  30: 0.02, // 2.0%
};
```

Rationale: Longer exposure periods increase probability of triggering event.

### DEPEG_LP Pricing

```typescript
premiumUSD = baseValueUSD × baseRate × stressMultiplier

// Where:
baseValueUSD = insuredLP × currentTWAP
baseRate = TERM_BASE_RATE[termDays]
stressMultiplier = calculateStressMultiplier(poolState, reserveRatio)
```

**Stress Multipliers:**

```typescript
function calculateStressMultiplier(state, reserveRatio) {
  if (state === "RED") return 1.4; // Critical risk
  if (state === "YELLOW") return 1.25; // Warning state

  // Green state depends on reserve depth
  if (reserveRatio < 0.3) return 1.35; // Low reserves
  if (reserveRatio < 0.5) return 1.2; // Medium reserves
  return 1.0; // Healthy reserves
}
```

Pool state classification:

- **RED**: TWAP < $0.95 (5%+ depeg)
- **YELLOW**: TWAP < $0.98 (2%+ depeg) or reserve ratio < 0.3
- **GREEN**: Normal operating conditions

### AAVE_DLP Pricing

```typescript
premiumUSD = insuredAmountUSD × baseRate × riskMultiplier

// Where:
riskMultiplier = ltvStress × healthFactorStress

ltvStress = (ltv > 0.7)
  ? 1 + (ltv - 0.7) × 1.5
  : 1.0

healthFactorStress = (healthFactor < 1.3)
  ? 1.2
  : 1.0
```

Rationale:

- **LTV (Loan-to-Value)**: Higher LTV means closer to liquidation threshold
- **Health Factor**: HF < 1.3 indicates dangerous zone (liquidation at HF < 1.0)

### Example Calculations

**DEPEG_LP (Green, 30 days):**

```
Insured: 10,000 LP @ TWAP $0.99
Base value: $9,900
Base rate: 2.0%
Stress multiplier: 1.0 (healthy)
Premium: $9,900 × 0.02 × 1.0 = $198
Coverage cap: $8,910 (90%)
```

**DEPEG_LP (Red, 30 days):**

```
Insured: 10,000 LP @ TWAP $0.94
Base value: $9,400
Base rate: 2.0%
Stress multiplier: 1.4 (critical)
Premium: $9,400 × 0.02 × 1.4 = $263.20
Coverage cap: $8,460 (90%)
```

**AAVE_DLP (Safe position, 30 days):**

```
Insured: $10,000 PYUSD
LTV: 0.65, Health Factor: 1.5
Base rate: 2.0%
Risk multiplier: 1.0 × 1.0 = 1.0
Premium: $10,000 × 0.02 × 1.0 = $200
Coverage cap: $1,000 (10%)
```

**AAVE_DLP (Risky position, 30 days):**

```
Insured: $10,000 PYUSD
LTV: 0.82, Health Factor: 1.15
Base rate: 2.0%
LTV stress: 1 + (0.82-0.7) × 1.5 = 1.18
HF stress: 1.2 (HF < 1.3)
Risk multiplier: 1.18 × 1.2 = 1.416
Premium: $10,000 × 0.02 × 1.416 = $283.20
Coverage cap: $1,000 (10%)
```

---

## Security & Risk Management

### Smart Contract Security

**EIP-712 Signature Verification:**
All quotes and claim payloads use typed structured data signing:

```solidity
bytes32 digest = keccak256(abi.encodePacked(
  "\x19\x01",
  DOMAIN_SEPARATOR,
  keccak256(abi.encode(QUOTE_TYPEHASH, quote))
));
address signer = ecrecover(digest, v, r, s);
require(signer == trustedQuoteSigner, "Invalid signature");
```

**Nonce-Based Replay Protection:**
Each quote and claim payload includes monotonically increasing nonce:

```solidity
require(payload.nonce == policyNonces[policyId] + 1, "Invalid nonce");
policyNonces[policyId]++;
```

**Deadline Enforcement:**
All signatures expire after fixed period:

```solidity
require(block.timestamp <= payload.deadline, "Signature expired");
```

**Coverage Cap Enforcement:**
Maximum payout cannot exceed pre-defined cap:

```solidity
uint256 payout = min(
  calculatedPayout,
  policy.coverageCap - policy.claimedUpTo
);
```

### API Security

**HMAC Signature Verification (Webhooks):**
All validator webhooks include HMAC-SHA256 signature:

```typescript
const expectedSignature = crypto
  .createHmac("sha256", VALIDATOR_API_SECRET)
  .update(JSON.stringify(request.body))
  .digest("hex");

const providedSignature = request.headers["x-lg-signature"];

if (
  !crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(providedSignature)
  )
) {
  throw new Error("Invalid webhook signature");
}
```

**Timestamp-Based Replay Protection:**
Webhooks older than 5 minutes rejected:

```typescript
const timestamp = request.body.timestamp;
const now = Date.now() / 1000;
if (Math.abs(now - timestamp) > 300) {
  throw new Error("Webhook timestamp too old");
}
```

**Admin Endpoint Protection:**
Admin routes require Bearer token authentication:

```typescript
const authHeader = request.headers.authorization;
if (!authHeader || !authHeader.startsWith("Bearer ")) {
  throw new Error("Missing authorization");
}

const token = authHeader.substring(7);
if (token !== ADMIN_API_KEY) {
  throw new Error("Invalid API key");
}
```

### Economic Security

**Deductible (5%):**
Users bear first 5% of losses, reducing moral hazard:

```typescript
const netSeverity = Math.max(0, lossQuoteBps - DEDUCTIBLE_BPS);
```

**Coverage Caps:**

- DEPEG_LP: 90% of insured value (prevents profit from depeg)
- AAVE_DLP: 10% of insured value (covers typical depeg losses)

**Cliff Period (24 hours):**
Policies inactive for 24 hours after purchase, preventing front-running:

```solidity
require(
  block.timestamp >= policy.activeAt,
  "Policy still in cliff period"
);
```

**Claim Queue System:**
Large claims (>80% of reserves) automatically queued:

```typescript
if (payout > reserve.totalAssets() * 0.8) {
  claim.status = "QUEUED";
  // Process when reserves replenish
} else {
  claim.status = "EXECUTED";
  reserve.withdraw(payout, policy.owner);
}
```

### Oracle Manipulation Resistance

**TWAP (Time-Weighted Average Price):**
Uses exponential moving average over 1-4 hour windows, resistant to flash loan attacks.

**Dual Oracle System:**
Chainlink + Pyth redundancy prevents single oracle manipulation.

**On-Chain Anchoring:**
All oracle data anchored on-chain with IPFS snapshots for verification.

**Correlation Windows:**
AAVE_DLP requires depeg + liquidation within 1-hour window, preventing false positives.

---

## Integration Points

### Backend API Endpoints

**Policy Management:**

```
POST   /v1/policies          - Create policy draft with signed quote
POST   /v1/policies/:id/finalize - Finalize policy after on-chain mint
GET    /v1/policies          - List policies by wallet
GET    /v1/policies/:id      - Get policy details
```

**Claims:**

```
GET    /v1/claim/preview     - Preview claim payout
POST   /v1/claim/sign        - Request signed claim payload
GET    /v1/claims            - List claims by wallet
GET    /v1/claims/queue      - View queued claims (>80% reserve)
```

**Pricing:**

```
POST   /v1/quote             - Get premium quote
```

**Pool Data:**

```
GET    /v1/pools             - List monitored pools with state
```

**Reserve:**

```
GET    /v1/reserve/overview  - Reserve NAV, cash ratio, lgUSD price
```

**Admin (Protected):**

```
POST   /v1/admin/anchors     - Submit oracle anchor
POST   /v1/admin/whitelist   - Update pool whitelist
```

**Internal Webhooks:**

```
POST   /internal/validator/anchors     - Receive depeg/liquidation events
POST   /internal/validator/pool-state  - Receive pool state updates
```

### Validator API Endpoints

**Risk Data:**

```
GET    /v1/risk              - List all monitored risks
GET    /v1/risk/:riskId      - Get detailed risk state
```

**Claims:**

```
POST   /v1/claims/preview    - Calculate claim payout
POST   /v1/claims/sign       - Generate EIP-712 claim signature
```

### Smart Contract Interfaces

**PolicyDistributor:**

```solidity
function buyPolicy(
  QuoteData calldata quote,
  bytes calldata signature
) external returns (uint256 policyId);
```

**PayoutModule:**

```solidity
function executeClaim(
  ClaimPayload calldata payload,
  bytes calldata signature
) external returns (uint256 payout);
```

**ReservePool:**

```solidity
function deposit(uint256 assets) external returns (uint256 shares);
function redeem(uint256 shares) external returns (uint256 assets);
```

### Configuration Requirements

**Backend `.env`:**

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/liquidityguard

# Blockchain
RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
CHAIN_ID=1

# Contract Addresses
POLICY_DISTRIBUTOR_ADDRESS=0x...
PAYOUT_MODULE_ADDRESS=0x...
RESERVE_POOL_ADDRESS=0x...

# Signing Keys
QUOTE_SIGNER_KEY=0x...
ORACLE_SIGNER_KEY=0x...

# Validator Integration
VALIDATOR_API_BASE_URL=http://localhost:3001
VALIDATOR_API_SECRET=shared_secret_32_bytes

# API
PORT=3000
LOG_LEVEL=info
```

**Validator `.env`:**

```bash
# Database
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=liquidityguard

# Blockchain
RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
CHAIN_ID=1

# Curve Monitoring
POOL_ADDRESS=0x...
POOL_ID=curve-usdc-usdf
DEPEG_THRESHOLD=0.02
POLL_INTERVAL_MS=10000

# Aave Monitoring
ENABLE_AAVE_MONITORING=true
AAVE_LENDING_POOL_ADDRESS=0x...
AAVE_COLLATERAL_ASSET=0x...  # PYUSD
AAVE_PRICE_FEED=0x...         # Chainlink PYUSD/USD

# Pyth Fallback
ENABLE_PYTH_FALLBACK=true
PYTH_PRICE_FEED_ID=0x...      # PYUSD/USD feed ID

# Signing
SIGNER_PRIVATE_KEY=0x...
PAYOUT_VERIFIER_ADDRESS=0x...  # Must match PayoutModule

# Webhooks
WEBHOOK_BASE_URL=http://localhost:3000
WEBHOOK_SECRET=shared_secret_32_bytes

# API
PORT=3001
LOG_LEVEL=info
```

---

## Conclusion

LiquidityGuard provides comprehensive protection against two of DeFi's most significant risk vectors: stablecoin depegs and liquidation cascades. Through a combination of real-time on-chain monitoring, dual oracle redundancy, and automated payout execution, the protocol offers users a reliable safety net for their DeFi positions.

The modular architecture allows for easy extension to additional products and chains, while the security-first design ensures protocol integrity through multiple layers of verification and economic safeguards.
