export type PoolState = 'Green' | 'Yellow' | 'Red';

export interface PoolListParams {
  state?: PoolState;
  chainId?: number;
}

export interface PoolMetrics {
  twap: number | null;
  reserveRatio: number | null;
  updatedAt: string | null;
}

export interface PoolSummary {
  poolId: string;
  chainId: number;
  name: string;
  address: string;
  riskId: string;
  state: PoolState;
  metrics: PoolMetrics;
}

export type ProductType = 'DEPEG_LP' | 'AAVE_DLP';
export type PolicyType = 'CURVE_LP' | 'AAVE_DLP';

export type TermDays = 10 | 20 | 30;

export interface DepegLpQuoteRequest {
  product: 'DEPEG_LP';
  poolId: string;
  insuredLP: number;
  termDays: TermDays;
}

export interface AaveDlpParams {
  chainId: number;
  lendingPool: string;
  collateralAsset: string;
  insuredAmountUSD: number;
  ltv?: number;
  healthFactor?: number;
}

export interface AaveDlpQuoteRequest {
  product: 'AAVE_DLP';
  params: AaveDlpParams;
  termDays: TermDays;
}

export type QuoteRequest = DepegLpQuoteRequest | AaveDlpQuoteRequest;

export interface QuoteResponse {
  product: ProductType;
  premiumUSD: number;
  coverageCapUSD: number;
  deductibleBps: number;
  cliffHours: number;
  pricingBreakdown: Record<string, unknown>;
}

export type PolicyStatus =
  | 'draft'
  | 'pending'
  | 'active'
  | 'expired'
  | 'claimed'
  | 'queued';

export interface PolicyDraftRequest {
  product: ProductType;
  wallet: string;
  params: Record<string, unknown>;
  termDays: TermDays;
  insuredAmount: number;
  idempotencyKey?: string;
}

export interface QuoteTypedData {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  message: Record<string, unknown>;
}

export interface MintParamsShape {
  policyType: number;
  riskId: string;
  insuredAmount: string;
  coverageCap: string;
  deductibleBps: number;
  startAt: number;
  activeAt: number;
  endAt: number;
  extraData: string;
}

export interface PolicyDraft extends QuoteResponse {
  draftId: string;
  wallet: string;
  params: Record<string, unknown>;
  termDays: TermDays;
  insuredAmount: number;
  createdAt: string;
  termsHash: string;
  riskId: string;
  policyType: PolicyType;
  startAt: number;
  activeAt: number;
  endAt: number;
  metadata: Record<string, unknown>;
  onchainCalldata?: Record<string, unknown>;
  distributorAddress: string;
  quoteSignature: string;
  quoteDeadline: number;
  quoteNonce: string;
  quoteTypedData: QuoteTypedData;
  mintParams: MintParamsShape;
}

export interface FinalizePolicyRequest {
  draftId: string;
  txHashMint: string;
  premiumTxHash?: string;
}

export interface PolicyRecord {
  policyId: string;
  draftId?: string;
  nftTokenId: string;
  policyType: PolicyType;
  riskId: string;
  product: ProductType;
  wallet: string;
  insuredAmount: string;
  termDays: TermDays;
  startAt: number;
  activeAt: number;
  endAt: number;
  claimedUpTo: number;
  nonce: number;
  status: PolicyStatus;
  coverageCapUSD: string;
  deductibleBps: number;
  metadata: Record<string, unknown>;
}

export type ClaimStatus =
  | 'pending'
  | 'signed'
  | 'submitted'
  | 'paid'
  | 'queued';

export interface ClaimPreviewRequest {
  policyId: string;
}

export interface ClaimPreview {
  policyId: string;
  product: ProductType;
  policyType: PolicyType;
  riskId: string;
  S: number | null;
  E: number | null;
  payload: Record<string, unknown>;
  payoutEstimate: number;
}

export interface ClaimSignatureRequest {
  policyId: string;
  requester?: string;
}

export interface ClaimSignatureResponse {
  policyId: string;
  policyType: PolicyType;
  riskId: string;
  eip712Domain: Record<string, unknown>;
  typedData: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  payout: number;
  expiresAt: string;
}

export interface ClaimRecord {
  claimId: string;
  policyId: string;
  product: ProductType;
  status: ClaimStatus;
  payout: number;
  createdAt: string;
  txHash?: string;
}

export interface ClaimQueueItem {
  claimId: string;
  policyId: string;
  product: ProductType;
  riskId: string;
  wallet: string;
  payout: number;
  queuedAt: string;
  status: ClaimStatus;
}

export interface ReserveOverview {
  navUSD: number;
  cashRatio: number;
  pendingClaimsUSD: number;
  pendingRedemptionsUSD: number;
  lgusdPricePerShare: number;
  updatedAt: string;
}

export type AnchorType =
  | 'DEPEG_START'
  | 'DEPEG_END'
  | 'DEPEG_LIQ'
  | 'LIQUIDATION';

export interface AnchorPayload {
  type: AnchorType;
  payload: Record<string, unknown>;
  ipfsCID: string;
  validatorSig: string;
}

export type WhitelistAction = 'ADD' | 'REMOVE' | 'UPDATE';

export interface WhitelistRequest {
  action: WhitelistAction;
  poolId: string;
  payload?: Record<string, unknown>;
}

export interface AnchoredWindow {
  riskId: string;
  start: AnchorPoint | null;
  end: AnchorPoint | null;
}

export interface AnchorPoint {
  timestamp: number;
  twapE18: string;
  snapshotCid: string;
}

export interface LiquidationEvidence {
  riskId: string;
  liquidationId: string;
  user: string;
  timestamp: number;
  twapE18: string;
  hfBeforeE4: number;
  hfAfterE4: number;
  snapshotCid: string;
}
