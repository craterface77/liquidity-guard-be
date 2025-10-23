import { badRequest } from '../core/errors.js';
import type {
  ClaimPreview,
  ClaimPreviewRequest,
  ClaimQueueItem,
  ClaimRecord,
  ClaimSignatureRequest,
  ClaimSignatureResponse
} from '../domain/types.js';
import { validatorApi } from '../integrations/validator-api.js';
import { policyService } from './policy.service.js';
import {
  createClaim,
  listClaimsByPolicy,
  listQueuedClaims
} from '../repositories/claim.repository.js';
import { updatePolicyStatus } from '../repositories/policy.repository.js';

const USDC_DECIMALS = 6;

function toUsdNumber(value: string | number | bigint | undefined): number {
  if (value === undefined) {
    return 0;
  }

  let bigintValue: bigint;
  if (typeof value === 'bigint') {
    bigintValue = value;
  } else if (typeof value === 'number') {
    bigintValue = BigInt(Math.trunc(value));
  } else {
    bigintValue = BigInt(value);
  }

  const divisor = BigInt(10 ** USDC_DECIMALS);
  return Number(bigintValue) / Number(divisor);
}

function toIsoTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function buildPolicyPayload(policy: Awaited<ReturnType<typeof policyService.getPolicyById>>) {
  const metadata = (policy.metadata ?? {}) as Record<string, unknown>;
  let coverageRatio: number | undefined;
  const rawCoverageRatio = metadata.coverageRatioBps;
  if (typeof rawCoverageRatio === 'number') {
    coverageRatio = rawCoverageRatio;
  } else if (typeof rawCoverageRatio === 'string') {
    const parsed = Number(rawCoverageRatio);
    coverageRatio = Number.isNaN(parsed) ? undefined : parsed;
  }
  return {
    policyId: policy.policyId,
    product: policy.product,
    riskId: policy.riskId,
    owner: policy.wallet,
    insuredAmount: (policy.insuredAmount ?? '0').toString(),
    coverageCap: (policy.coverageCapUSD ?? '0').toString(),
    deductibleBps: policy.deductibleBps,
    kBps: coverageRatio ?? 5_000,
    startAt: policy.startAt,
    activeAt: policy.activeAt,
    endAt: policy.endAt,
    claimedUpTo: policy.claimedUpTo,
    metadata
  };
}

export class ClaimService {
  constructor() {}

  async previewClaim(
    request: ClaimPreviewRequest
  ): Promise<ClaimPreview> {
    const policy = await policyService.getPolicyById(request.policyId);

    const validatorPayload = {
      policy: buildPolicyPayload(policy),
      claimMode: 'PREVIEW',
      timestamp: Math.floor(Date.now() / 1000)
    };

    try {
      const result = await validatorApi.previewClaim(validatorPayload);
      return {
        policyId: policy.policyId,
        product: policy.product,
        policyType: policy.policyType,
        riskId: policy.riskId,
        S: result.S,
        E: result.E,
        payload: result as unknown as Record<string, unknown>,
        payoutEstimate: toUsdNumber(result.payout)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to preview claim';
      throw badRequest('CLAIM_PREVIEW_FAILED', message);
    }
  }

  async signClaim(
    request: ClaimSignatureRequest
  ): Promise<ClaimSignatureResponse> {
    const policy = await policyService.getPolicyById(request.policyId);

    const signPayload = {
      policy: buildPolicyPayload(policy),
      claimMode: 'FINAL',
      timestamp: Math.floor(Date.now() / 1000)
    };

    let signatureResponse;
    try {
      signatureResponse = await validatorApi.signClaim(signPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign claim';
      throw badRequest('CLAIM_SIGNATURE_FAILED', message);
    }
    const typedMessage = signatureResponse.typedData?.message as Record<string, unknown> | undefined;
    const payoutAtomic = (typedMessage?.payout ?? '0') as string | number | bigint;
    const payout = toUsdNumber(payoutAtomic);

    const claimedUpToCandidate = typedMessage?.E;
    let claimedUpTo = policy.claimedUpTo;
    if (typeof claimedUpToCandidate === 'number') {
      claimedUpTo = claimedUpToCandidate;
    } else if (typeof claimedUpToCandidate === 'string') {
      const parsed = Number(claimedUpToCandidate);
      if (!Number.isNaN(parsed)) {
        claimedUpTo = parsed;
      }
    }

    if (!Number.isFinite(payout) || payout <= 0) {
      throw badRequest('INVALID_CLAIM_PAYOUT', 'Validator provided a non-positive payout amount.');
    }
    const coverageCap = toUsdNumber(policy.coverageCapUSD);
    const willQueue = payout > coverageCap * 0.8;

    await createClaim({
      policyId: policy.policyId,
      product: policy.product,
      payout: payout.toString(),
      status: willQueue ? 'queued' : 'signed',
      payload: (typedMessage ?? {}) as Record<string, unknown>,
      signature: signatureResponse.signature,
      expiresAt: signatureResponse.expiresAt ? new Date(signatureResponse.expiresAt * 1000) : null,
      txHash: null
    });

    await updatePolicyStatus(
      policy.policyId,
      willQueue ? 'queued' : 'claimed',
      claimedUpTo,
      policy.nonce + 1,
      {}
    );

    return {
      policyId: policy.policyId,
      policyType: policy.policyType,
      riskId: signatureResponse.riskId,
      eip712Domain: (signatureResponse.typedData?.domain ?? {}) as Record<string, unknown>,
      typedData: (signatureResponse.typedData ?? {}) as Record<string, unknown>,
      payload: (typedMessage ?? {}) as Record<string, unknown>,
      signature: signatureResponse.signature,
      payout,
      expiresAt: toIsoTimestamp(signatureResponse.expiresAt)
    };
  }

  async listClaims(wallet?: string): Promise<ClaimRecord[]> {
    if (!wallet) {
      return [];
    }

    const policies = await policyService.listPolicies(wallet);
    const seen = new Set<string>();
    const claims: ClaimRecord[] = [];
    for (const policy of policies) {
      const policyClaims = await listClaimsByPolicy(policy.policyId);
      claims.push(
        ...policyClaims
          .filter((claim) => {
            if (seen.has(claim.id)) {
              return false;
            }
            seen.add(claim.id);
            return true;
          })
          .map((claim) => ({
            claimId: claim.id,
            policyId: claim.policyId,
            product: claim.product as any,
            status: claim.status as any,
            payout: Number(claim.payout),
            createdAt: claim.createdAt.toISOString(),
            txHash: claim.txHash ?? undefined
          }))
      );
    }

    return claims.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async getClaimQueue(): Promise<ClaimQueueItem[]> {
    const queuedClaims = await listQueuedClaims();

    return queuedClaims.map((claim) => ({
      claimId: claim.id,
      policyId: claim.policyId,
      product: claim.product as any,
      riskId: claim.riskId,
      wallet: claim.wallet,
      payout: Number(claim.payout),
      queuedAt: claim.createdAt.toISOString(),
      status: claim.status as any
    }));
  }
}

export const claimService = new ClaimService();
