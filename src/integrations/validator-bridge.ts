import { appConfig } from '../core/env.js';
import { getContractGateway } from './contracts/contract-gateway.js';
import type {
  AnchoredWindow,
  ClaimPreview,
  ClaimSignatureResponse,
  LiquidationEvidence,
  PolicyRecord
} from '../domain/types.js';

const SIGNATURE_PLACEHOLDER = `0x${'a'.repeat(128)}`;
const DEFAULT_DEADLINE_SECS = 15 * 60;

interface CurveClaimPayload {
  policyId: number;
  riskId: string;
  S: number;
  E: number;
  Lstar: number;
  refValue: number;
  curValue: number;
  payout: number;
  nonce: number;
  deadline: number;
}

interface LiquidationClaimPayload {
  policyId: number;
  riskId: string;
  liquidationId: string;
  user: string;
  collateralAsset: string;
  aavePool: string;
  S: number;
  E: number;
  liquidatedCollateralAmount: number;
  priceAtLiquidationE18: string;
  bonusBps: number;
  payout: number;
  nonce: number;
  deadline: number;
}

function ensureNumericPolicyId(policy: PolicyRecord): number {
  const parsed = Number(policy.nftTokenId);
  if (Number.isNaN(parsed)) {
    return Math.abs(policy.policyId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0));
  }
  return parsed;
}

function parseInsuredAmount(policy: PolicyRecord): number {
  if (policy.policyType === 'CURVE_LP') {
    return Number(policy.insuredAmount);
  }
  return Number(policy.insuredAmount) / 1e6;
}

function parseCoverageCap(policy: PolicyRecord): number {
  return Number(policy.coverageCapUSD);
}

function buildDomain(): Record<string, unknown> {
  return {
    name: 'LiquidityGuardPayout',
    version: '1',
    chainId: appConfig.CHAIN_ID ?? 1,
    verifyingContract: appConfig.PAYOUT_MODULE_ADDRESS ?? '0xPayoutModule'
  };
}

function computeCurvePayload(policy: PolicyRecord, window: AnchoredWindow): CurveClaimPayload {
  if (!window.start) {
    throw new Error(`Depeg window start not anchored for risk ${policy.riskId}`);
  }

  const S = window.start.timestamp;
  const E = window.end?.timestamp ?? Math.floor(Date.now() / 1000);
  const insured = parseInsuredAmount(policy);
  const coverageCap = parseCoverageCap(policy);
  const payout = Math.min(coverageCap, insured * 0.7);

  return {
    policyId: ensureNumericPolicyId(policy),
    riskId: policy.riskId,
    S,
    E,
    Lstar: insured,
    refValue: Math.round(insured * 1_000_000) / 1_000_000,
    curValue: Math.round((insured - payout) * 1_000_000) / 1_000_000,
    payout,
    nonce: policy.nonce,
    deadline: Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECS
  };
}

function computeLiquidationPayload(
  policy: PolicyRecord,
  window: AnchoredWindow,
  record: LiquidationEvidence
): LiquidationClaimPayload {
  if (!window.start) {
    throw new Error(`Depeg window start not anchored for risk ${policy.riskId}`);
  }

  const S = window.start.timestamp;
  const E = window.end?.timestamp ?? Math.floor(Date.now() / 1000);
  const coverageCap = parseCoverageCap(policy);
  const insured = parseInsuredAmount(policy);
  const payout = Math.min(coverageCap, insured * 0.1);

  const metadata = (policy.metadata ?? {}) as Record<string, unknown>;
  const collateralAsset = typeof metadata.collateralAsset === 'string'
    ? metadata.collateralAsset
    : '0x0000000000000000000000000000000000000000';
  const aavePool = typeof metadata.lendingPool === 'string'
    ? metadata.lendingPool
    : '0x0000000000000000000000000000000000000000';

  return {
    policyId: ensureNumericPolicyId(policy),
    riskId: policy.riskId,
    liquidationId: record.liquidationId,
    user: policy.wallet,
    collateralAsset,
    aavePool,
    S,
    E,
    liquidatedCollateralAmount: Math.round(insured * 0.12 * 1_000_000) / 1_000_000,
    priceAtLiquidationE18: record.twapE18,
    bonusBps: 1000,
    payout,
    nonce: policy.nonce,
    deadline: Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECS
  };
}

function formatPreview(
  policy: PolicyRecord,
  payload: CurveClaimPayload | LiquidationClaimPayload,
  payout: number
): ClaimPreview {
  return {
    policyId: policy.policyId,
    product: policy.product,
    policyType: policy.policyType,
    riskId: policy.riskId,
    S: payload.S,
    E: payload.E,
    payload: payload as unknown as Record<string, unknown>,
    payoutEstimate: payout
  };
}

export class ValidatorBridge {
  async previewClaim(policy: PolicyRecord): Promise<ClaimPreview> {
    const gateway = getContractGateway();
    const window = await gateway.getDepegWindow(policy.riskId);

    if (policy.policyType === 'CURVE_LP') {
      const payload = computeCurvePayload(policy, window);
      return formatPreview(policy, payload, payload.payout);
    }

    const metadata = (policy.metadata ?? {}) as Record<string, unknown>;
    const liquidationId = typeof metadata.lastLiquidationId === 'string' ? metadata.lastLiquidationId : undefined;
    if (!liquidationId) {
      throw new Error('No liquidation evidence available for policy');
    }

    const evidence = await gateway.getLiquidationEvidence(policy.riskId, liquidationId);
    if (!evidence) {
      throw new Error('Missing liquidation evidence for anchored liquidation');
    }

    const payload = computeLiquidationPayload(policy, window, evidence);
    return formatPreview(policy, payload, payload.payout);
  }

  async signClaim(policy: PolicyRecord): Promise<ClaimSignatureResponse> {
    const preview = await this.previewClaim(policy);
    const domain = buildDomain();

    if (policy.policyType === 'CURVE_LP') {
    const payload = preview.payload as unknown as CurveClaimPayload;
      const typedData = {
        types: {
          ClaimPayload: [
            { name: 'policyId', type: 'uint256' },
            { name: 'riskId', type: 'bytes32' },
            { name: 'S', type: 'uint64' },
            { name: 'E', type: 'uint64' },
            { name: 'Lstar', type: 'uint256' },
            { name: 'refValue', type: 'uint256' },
            { name: 'curValue', type: 'uint256' },
            { name: 'payout', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
          ]
        },
        primaryType: 'ClaimPayload',
        domain,
        message: {
          policyId: payload.policyId,
          riskId: payload.riskId,
          S: payload.S,
          E: payload.E,
          Lstar: Math.round(payload.Lstar * 1e6),
          refValue: Math.round(payload.refValue * 1e6),
          curValue: Math.round(payload.curValue * 1e6),
          payout: Math.round(payload.payout * 1e6),
          nonce: payload.nonce,
          deadline: payload.deadline
        }
      };

      return {
        policyId: policy.policyId,
        policyType: policy.policyType,
        riskId: policy.riskId,
        eip712Domain: domain,
        typedData,
        payload: payload as unknown as Record<string, unknown>,
        payout: payload.payout,
        signature: SIGNATURE_PLACEHOLDER,
        expiresAt: new Date(payload.deadline * 1000).toISOString()
      };
    }

    const payload = preview.payload as unknown as LiquidationClaimPayload;
    const typedData = {
      types: {
        LiquidationClaimPayload: [
          { name: 'policyId', type: 'uint256' },
          { name: 'riskId', type: 'bytes32' },
          { name: 'liquidationId', type: 'bytes32' },
          { name: 'user', type: 'address' },
          { name: 'collateralAsset', type: 'address' },
          { name: 'aavePool', type: 'address' },
          { name: 'S', type: 'uint64' },
          { name: 'E', type: 'uint64' },
          { name: 'liquidatedCollateralAmount', type: 'uint256' },
          { name: 'priceAtLiquidationE18', type: 'uint256' },
          { name: 'bonusBps', type: 'uint256' },
          { name: 'payout', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' }
        ]
      },
      primaryType: 'LiquidationClaimPayload',
      domain,
      message: {
        policyId: payload.policyId,
        riskId: payload.riskId,
        liquidationId: payload.liquidationId,
        user: payload.user,
        collateralAsset: payload.collateralAsset,
        aavePool: payload.aavePool,
        S: payload.S,
        E: payload.E,
        liquidatedCollateralAmount: Math.round(payload.liquidatedCollateralAmount * 1e6),
        priceAtLiquidationE18: payload.priceAtLiquidationE18,
        bonusBps: payload.bonusBps,
        payout: Math.round(payload.payout * 1e6),
        nonce: payload.nonce,
        deadline: payload.deadline
      }
    };

    return {
      policyId: policy.policyId,
      policyType: policy.policyType,
      riskId: policy.riskId,
      eip712Domain: domain,
      typedData,
      payload: payload as unknown as Record<string, unknown>,
      payout: payload.payout,
      signature: SIGNATURE_PLACEHOLDER,
      expiresAt: new Date(payload.deadline * 1000).toISOString()
    };
  }
}

export const validatorBridge = new ValidatorBridge();
