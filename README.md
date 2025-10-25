# LiquidityGuard Backend

Fastify-based backend service for the LiquidityGuard insurance protocol. Handles policy issuance, claim processing, and validator coordination for protecting DeFi users against stablecoin depegs and liquidation cascades.

## Features

- REST API with OpenAPI/Swagger documentation at `/docs`
- Two insurance products: DEPEG_LP (Curve pool protection) and AAVE_DLP (Aave liquidation protection)
- EIP-712 signature-based policy quotes and claim verification
- PostgreSQL persistence for policies, claims, and drafts
- Integration with validator service for real-time risk monitoring
- HMAC-authenticated webhooks for event ingestion

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Docker (optional, for containerized deployment)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd liquidity-guard-be

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Start PostgreSQL (if not already running)
docker compose up db -d

# Run migrations (automatic on server start)
# Start development server
npm run dev
```

The API will be available at `http://localhost:3000` with interactive docs at `http://localhost:3000/docs`.

### Docker Deployment

```bash
# Start all services (PostgreSQL + Backend)
docker compose up --build

# Stop services
docker compose down
```

## Configuration

Environment variables are validated via Zod schemas. See `.env.example` for all available options.

### Critical Configuration

**Database:**

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/liquidityguard
# Or individual components:
DB_HOST=localhost
DB_PORT=5432
DB_USER=liquidityguard
DB_PASSWORD=your_password
DB_NAME=liquidityguard
```

**Blockchain:**

```bash
RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
CHAIN_ID=1  # 1 for mainnet, 11155111 for Sepolia

# Contract addresses (update after deployment)
POLICY_DISTRIBUTOR_ADDRESS=0x...
PAYOUT_MODULE_ADDRESS=0x...
RESERVE_POOL_ADDRESS=0x...
POLICY_NFT_ADDRESS=0x...
ORACLE_ANCHORS_ADDRESS=0x...
```

**Signing Keys:**

```bash
# Must match the signer registered in PolicyDistributor contract
QUOTE_SIGNER_KEY=0x...

# Used for submitting oracle anchor transactions
ORACLE_SIGNER_KEY=0x...
```

**Validator Integration:**

```bash
VALIDATOR_API_BASE_URL=http://localhost:3001
VALIDATOR_API_SECRET=your_shared_secret_key

# This secret MUST match WEBHOOK_SECRET in validator's .env
```

**API Server:**

```bash
PORT=3000
NODE_ENV=development  # or production
LOG_LEVEL=info        # debug, info, warn, error
```

## API Endpoints

### Public Endpoints

| Method | Path                        | Description                           |
| ------ | --------------------------- | ------------------------------------- |
| `GET`  | `/health`                   | Service health check                  |
| `POST` | `/v1/quote`                 | Get premium quote for policy          |
| `POST` | `/v1/policies`              | Create policy draft with signed quote |
| `POST` | `/v1/policies/:id/finalize` | Finalize policy after on-chain mint   |
| `GET`  | `/v1/policies`              | List policies for wallet              |
| `GET`  | `/v1/policies/:id`          | Get policy details                    |
| `GET`  | `/v1/claim/preview`         | Preview claim payout                  |
| `POST` | `/v1/claim/sign`            | Get signed claim payload              |
| `GET`  | `/v1/claims`                | List claims for wallet                |
| `GET`  | `/v1/claims/queue`          | View queued claims                    |
| `GET`  | `/v1/pools`                 | List monitored pools                  |
| `GET`  | `/v1/reserve/overview`      | Reserve pool statistics               |

### Protected Endpoints

| Method | Path                  | Description           | Auth         |
| ------ | --------------------- | --------------------- | ------------ |
| `POST` | `/v1/admin/anchors`   | Submit oracle anchor  | Bearer token |
| `POST` | `/v1/admin/whitelist` | Update pool whitelist | Bearer token |

### Internal Endpoints

| Method | Path                             | Description                | Auth           |
| ------ | -------------------------------- | -------------------------- | -------------- |
| `POST` | `/internal/validator/anchors`    | Receive depeg events       | HMAC signature |
| `POST` | `/internal/validator/pool-state` | Receive pool state updates | HMAC signature |

## Usage Examples

### Get Quote

```bash
curl -X POST http://localhost:3000/v1/quote \
  -H "Content-Type: application/json" \
  -d '{
    "product": "DEPEG_LP",
    "poolId": "curve-usdc-pyusd",
    "insuredLP": "10000000000000000000",
    "termDays": 30
  }'
```

Response:

```json
{
  "product": "DEPEG_LP",
  "premiumUSD": 198.0,
  "coverageCapUSD": 8910.0,
  "deductibleBps": 500,
  "cliffHours": 24,
  "pricingBreakdown": {
    "termRate": 0.02,
    "stressMultiplier": 1.0,
    "baseValueUSD": 9900
  }
}
```

### Create Policy Draft

```bash
curl -X POST http://localhost:3000/v1/policies \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "product": "DEPEG_LP",
    "poolId": "curve-usdc-pyusd",
    "insuredLP": "10000000000000000000",
    "termDays": 30
  }'
```

Response includes EIP-712 signature for use in on-chain transaction:

```json
{
  "draftId": "uuid",
  "quote": {
    "product": "DEPEG_LP",
    "poolId": "curve-usdc-pyusd",
    "insuredLP": "10000000000000000000",
    "premiumUSD": 198.0,
    "coverageCapUSD": 8910.0,
    "termDays": 30,
    "deductibleBps": 500,
    "cliffHours": 24,
    "nonce": 123,
    "deadline": 1700000000
  },
  "signature": "0x...",
  "expiresAt": "2024-01-01T12:00:00.000Z"
}
```

### Finalize Policy

After user calls `PolicyDistributor.buyPolicy()` on-chain:

```bash
curl -X POST http://localhost:3000/v1/policies/{draftId}/finalize \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "0x..."
  }'
```

### Preview Claim

```bash
curl "http://localhost:3000/v1/claim/preview?policyId=123"
```

Response:

```json
{
  "policyId": "123",
  "riskId": "0x...",
  "eligible": true,
  "payout": "730000000",
  "reason": "Depeg window detected",
  "window": {
    "start": 1700400000,
    "end": 1700600000
  },
  "snapshots": {
    "startCid": "bafy...",
    "endCid": "bafy..."
  }
}
```

### Submit Claim

```bash
curl -X POST http://localhost:3000/v1/claim/sign \
  -H "Content-Type: application/json" \
  -d '{
    "policyId": "123"
  }'
```

Response includes EIP-712 signature for `PayoutModule.executeClaim()`:

```json
{
  "policyId": "123",
  "payload": {
    "policyId": "123",
    "riskId": "0x...",
    "S": 1700400000,
    "E": 1700600000,
    "Lstar": "950000000",
    "refValue": "980000000",
    "curValue": "250000000",
    "payout": "730000000",
    "nonce": 2,
    "deadline": 1700650000
  },
  "signature": "0x...",
  "expiresAt": "2024-01-01T13:00:00.000Z"
}
```

## Architecture

### Components

```
┌─────────────────────────────────────────┐
│         Smart Contracts (EVM)           │
│  PolicyDistributor • PayoutModule       │
│  ReservePool • PolicyNFT                │
└────────┬────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────┐
│        Backend API (this service)        │
│  • Policy lifecycle management           │
│  • EIP-712 quote signing                 │
│  • Claim coordination                    │
│  • Webhook ingestion                     │
└────────┬────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────┐
│       Validator Service                  │
│  • Real-time pool monitoring             │
│  • Depeg detection (TWAP)                │
│  • Liquidation tracking (Aave)           │
│  • Claim calculation & signing           │
│  • Dual oracle (Chainlink + Pyth)        │
└──────────────────────────────────────────┘
```

### Data Flow

**Policy Purchase:**

1. Frontend requests quote from backend
2. Backend calculates premium using pricing model
3. Backend signs EIP-712 quote with `QUOTE_SIGNER_KEY`
4. Frontend calls `PolicyDistributor.buyPolicy()` with signature
5. Policy NFT minted on-chain
6. Frontend submits tx hash to backend for finalization
7. Backend verifies transaction and stores policy in PostgreSQL

**Claim Submission:**

1. Frontend requests claim preview
2. Backend delegates to validator API with HMAC authentication
3. Validator calculates payout from ClickHouse time-series data
4. Backend returns preview to frontend
5. User confirms and requests signature
6. Validator signs EIP-712 claim payload
7. Backend stores claim record and returns signature
8. Frontend calls `PayoutModule.executeClaim()` with signature
9. Contract verifies signature and executes payout

**Event Ingestion:**

1. Validator detects depeg or liquidation event
2. Validator submits oracle anchor transaction on-chain
3. Validator sends webhook to backend with HMAC signature
4. Backend verifies signature and stores event in PostgreSQL
5. Backend updates related policy metadata

## Database Schema

### Migrations

Migrations run automatically on server startup. Manual execution:

```bash
# Using npm script
npm run migrate

# Direct execution
node -r tsx/register src/core/migrations.ts
```

### Tables

**policies**

- Stores finalized policies after on-chain minting
- Indexed by `policy_id` (on-chain ID) and `wallet`
- Tracks `claimed_up_to` for partial claim support

**policy_drafts**

- Temporary storage for quotes before on-chain minting
- Deleted after successful finalization
- Expires after 1 hour (configurable)

**claims**

- Tracks all claim requests and executions
- Links to policies via `policy_id`
- Stores validator signature and transaction hash

**anchors** (from validator webhooks)

- Records depeg windows and liquidation events
- Stores IPFS CIDs for full event snapshots
- Used for claim verification

## Integration with Validator

The backend requires a running validator service. Setup:

### 1. Clone and Configure Validator

```bash
cd ..
git clone <validator-repo-url> liquidity-guard-validator
cd liquidity-guard-validator
npm install
cp .env.example .env
```

### 2. Configure Validator `.env`

Critical settings:

```bash
# API
PORT=3001

# Database
CLICKHOUSE_URL=http://localhost:8123

# Blockchain
RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
CHAIN_ID=1

# Pool Monitoring
POOL_ADDRESS=0x...
POOL_ID=curve-usdc-pyusd
DEPEG_THRESHOLD=0.02

# Aave Monitoring (optional)
ENABLE_AAVE_MONITORING=true
AAVE_LENDING_POOL_ADDRESS=0x...
AAVE_COLLATERAL_ASSET=0x...  # PYUSD
AAVE_PRICE_FEED=0x...         # Chainlink PYUSD/USD

# Pyth Fallback
ENABLE_PYTH_FALLBACK=true
PYTH_PRICE_FEED_ID=0x...

# Signing
SIGNER_PRIVATE_KEY=0x...
PAYOUT_VERIFIER_ADDRESS=0x...  # Must match backend's PAYOUT_MODULE_ADDRESS

# Backend Integration
WEBHOOK_BASE_URL=http://localhost:3000
WEBHOOK_SECRET=your_shared_secret  # Must match backend's VALIDATOR_API_SECRET
```

### 3. Start Validator Services

```bash
# Terminal 1: Start indexer worker
npm run start:indexer

# Terminal 2: Start API server
npm run start:api
```

### 4. Verify Integration

```bash
# Check validator health
curl http://localhost:3001/health

# Test backend → validator connection
curl http://localhost:3000/v1/pools
```

## Development

### Running Tests

```bash
# Unit tests
npm test

# Integration tests (requires running PostgreSQL)
npm run test:integration

# E2E tests (requires all services)
npm run test:e2e
```

### Code Structure

```
src/
├── core/              # Core utilities
│   ├── database.ts    # PostgreSQL client
│   ├── env.ts         # Environment validation
│   ├── errors.ts      # Error classes
│   └── migrations.ts  # Database migrations
├── domain/            # Domain types and schemas
│   └── types.ts       # TypeScript interfaces
├── http/              # HTTP layer
│   ├── middleware/    # Request middleware
│   ├── routes/        # Route handlers
│   │   ├── v1/        # Public API v1
│   │   └── internal/  # Internal webhooks
│   └── routes.ts      # Route registration
├── integrations/      # External service clients
│   ├── contracts/     # Smart contract clients
│   └── validator-api.ts # Validator HTTP client
├── repositories/      # Data access layer
│   ├── claim.repository.ts
│   ├── policy.repository.ts
│   └── policy-draft.repository.ts
├── services/          # Business logic
│   ├── admin.service.ts
│   ├── claim.service.ts
│   ├── policy.service.ts
│   ├── pool.service.ts
│   ├── pricing.service.ts
│   └── reserve.service.ts
├── app.ts            # Fastify app setup
└── server.ts         # HTTP server entry point
```

### Adding a New Endpoint

1. Define route handler in `src/http/routes/v1/`
2. Add Zod schema for request/response validation
3. Register route in `src/http/routes.ts`
4. Implement business logic in appropriate service
5. Update OpenAPI documentation (auto-generated from schemas)

### Database Changes

1. Create new migration in `src/core/migrations.ts`
2. Add migration to `MIGRATIONS` array
3. Update repository layer with new queries
4. Restart server (migrations run automatically)

## Security

### EIP-712 Signatures

All quotes and claims use typed structured data:

```typescript
const domain = {
  name: "LiquidityGuard",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: POLICY_DISTRIBUTOR_ADDRESS,
};

const types = {
  Quote: [
    { name: "product", type: "string" },
    { name: "poolId", type: "string" },
    { name: "insuredLP", type: "uint256" },
    { name: "premiumUSD", type: "uint256" },
    { name: "coverageCapUSD", type: "uint256" },
    { name: "termDays", type: "uint8" },
    { name: "deductibleBps", type: "uint16" },
    { name: "cliffHours", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const signature = await signer.signTypedData(domain, types, quote);
```

### HMAC Webhook Verification

All validator webhooks include HMAC-SHA256 signature:

```typescript
import crypto from "crypto";

function verifyWebhookSignature(request) {
  const signature = request.headers["x-lg-signature"];
  const body = JSON.stringify(request.body);

  const expectedSignature = crypto
    .createHmac("sha256", VALIDATOR_API_SECRET)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### Admin Endpoint Protection

Admin routes require Bearer token authentication:

```typescript
const authHeader = request.headers.authorization;
if (!authHeader?.startsWith("Bearer ")) {
  throw new Error("Missing authorization header");
}

const token = authHeader.substring(7);
if (token !== ADMIN_API_KEY) {
  throw new Error("Invalid API key");
}
```

## Deployment

### Production Checklist

**Pre-Deployment:**

- [ ] Smart contracts deployed and verified on Etherscan
- [ ] Contract addresses updated in `.env`
- [ ] Private keys generated and stored securely (use secret manager)
- [ ] PostgreSQL database provisioned
- [ ] ClickHouse database provisioned (for validator)
- [ ] RPC endpoint configured (Alchemy/Infura with sufficient rate limits)
- [ ] Validator service deployed and configured
- [ ] Shared secrets generated (`openssl rand -hex 32`)

**Configuration:**

- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=info` or `warn`
- [ ] Database connection pooling configured
- [ ] CORS settings configured for frontend origin
- [ ] Rate limiting enabled
- [ ] SSL/TLS certificates configured

**Monitoring:**

- [ ] Health check endpoint monitored
- [ ] Error logs aggregated (Datadog, Sentry, etc.)
- [ ] Database performance metrics tracked
- [ ] API response times monitored
- [ ] Webhook delivery success rates tracked

**Security:**

- [ ] Private keys stored in secret manager (not `.env` files)
- [ ] API keys rotated regularly
- [ ] Database backups automated
- [ ] DDoS protection configured
- [ ] Audit logs enabled

### Deployment Methods

**Docker:**

```bash
# Build image
docker build -t liquidity-guard-backend .

# Run container
docker run -d \
  --name liquidity-guard-backend \
  -p 3000:3000 \
  --env-file .env.production \
  liquidity-guard-backend

# View logs
docker logs -f liquidity-guard-backend
```

**PM2:**

```bash
# Install PM2
npm install -g pm2

# Build application
npm run build

# Start with PM2
pm2 start dist/server.js --name liquidity-guard-backend

# View logs
pm2 logs liquidity-guard-backend

# Monitor
pm2 monit
```

**Kubernetes:**
See `k8s/` directory for deployment manifests (if available).

## Troubleshooting

### Database Connection Issues

```bash
# Test PostgreSQL connection
psql $DATABASE_URL -c "SELECT 1"

# Check if database exists
psql $DATABASE_URL -c "\l"

# Check if migrations ran
psql $DATABASE_URL -c "\dt"
```

### Validator Integration Issues

```bash
# Check validator is running
curl http://localhost:3001/health

# Test validator API directly
curl -X POST http://localhost:3001/v1/claims/preview \
  -H "Content-Type: application/json" \
  -d '{"policy": {...}}'

# Verify shared secret matches
# Backend: VALIDATOR_API_SECRET
# Validator: WEBHOOK_SECRET
```

### Contract Interaction Issues

```bash
# Test RPC connection
curl -X POST $RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Verify contract deployed
cast code $POLICY_DISTRIBUTOR_ADDRESS --rpc-url $RPC_URL

# Check signer has funds
cast balance $(cast wallet address --private-key $QUOTE_SIGNER_KEY) --rpc-url $RPC_URL
```

### Common Errors

**"Invalid signature"**

- Check `QUOTE_SIGNER_KEY` matches on-chain registered signer
- Verify EIP-712 domain matches contract configuration
- Ensure nonce hasn't been used before

**"Webhook signature verification failed"**

- Confirm `VALIDATOR_API_SECRET` matches validator's `WEBHOOK_SECRET`
- Check timestamp isn't older than 5 minutes
- Verify webhook body hasn't been modified

**"Policy not found"**

- Ensure finalization was called after on-chain minting
- Check transaction hash is correct
- Verify transaction was mined successfully

## Support

For technical questions or issues:

- Review API documentation at `/docs`
- Check server logs for detailed error messages
- Verify environment configuration
- Consult [WHITEPAPER.md](./WHITEPAPER.md) for protocol details

## License

[License information]

## Additional Documentation

- [WHITEPAPER.md](./WHITEPAPER.md) - Protocol architecture and technical specifications
- [VALIDATOR_API.md](./VALIDATOR_API.md) - Validator API reference
- `.env.example` - Complete configuration reference
