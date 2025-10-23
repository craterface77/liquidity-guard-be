import { AbiCoder, keccak256, toUtf8Bytes, Wallet, parseUnits } from 'ethers';
import { z } from 'zod';

import { badRequest, notFound } from '../core/errors.js';
import type {
  FinalizePolicyRequest,
  MintParamsShape,
  PolicyDraft,
  PolicyDraftRequest,
  PolicyRecord,
  PolicyType,
  QuoteRequest,
  QuoteTypedData,
  TermDays
} from '../domain/types.js';
import { appConfig } from '../core/env.js';
import { pricingService } from './pricing.service.js';
import {
  createQuoteSigner,
  extractPolicyMintedFromTx,
  getPolicyDistributorContract,
  getPolicyNftContract,
  getProvider
} from '../integrations/contracts/liquidity-guard-client.js';
import {
  createPolicyDraft,
  deletePolicyDraft,
  getPolicyDraftById,
  type CreatePolicyDraftInput
} from '../repositories/policy-draft.repository.js';
import {
  upsertPolicy,
  upsertPolicyAndDeleteDraft,
  listPoliciesByWallet,
  getPolicyById as fetchPolicyById
} from '../repositories/policy.repository.js';
import type { PolicyDraftRecord } from '../repositories/policy-draft.repository.js';
import type { PolicyRecord as RepoPolicyRecord } from '../repositories/policy.repository.js';
import { addSeconds, currentUnixTime } from '../utils/datetime.js';

const CURVE_POLICY_TYPE = 0;
const AAVE_POLICY_TYPE = 1;
const QUOTE_DOMAIN_NAME = 'LiquidityGuardDistributor';
const QUOTE_DOMAIN_VERSION = '1';
const QUOTE_TYPES: QuoteTypedData['types'] = {
  Quote: [
    { name: 'buyer', type: 'address' },
    { name: 'policyType', type: 'uint8' },
    { name: 'riskId', type: 'bytes32' },
    { name: 'insuredAmount', type: 'uint256' },
    { name: 'coverageCap', type: 'uint256' },
    { name: 'deductibleBps', type: 'uint32' },
    { name: 'startAt', type: 'uint64' },
    { name: 'activeAt', type: 'uint64' },
    { name: 'endAt', type: 'uint64' },
    { name: 'extraDataHash', type: 'bytes32' },
    { name: 'premium', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' }
  ]
};

const depegParamsSchema = z.object({
  poolId: z.string().min(1)
});

const aaveParamsSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  lendingPool: z.string().min(1),
  collateralAsset: z.string().min(1),
  coverageRatioBps: z.coerce.number().int().nonnegative().max(10_000).optional(),
  maxPayoutBps: z.coerce.number().int().nonnegative().max(10_000).optional()
});

interface QuoteContext {
  riskId: string;
  policyType: PolicyType;
  sanitizedParams: Record<string, unknown>;
  metadata: Record<string, unknown>;
  extraData: string;
  termDays: TermDays;
}

export class PolicyService {
  private readonly quoteSigner: Wallet;

  constructor() {
    this.quoteSigner = createQuoteSigner();
  }

  async createDraft(request: PolicyDraftRequest): Promise<PolicyDraft> {
    const distributorAddress = appConfig.POLICY_DISTRIBUTOR_ADDRESS;
    if (!distributorAddress) {
      throw badRequest('CONFIG_MISSING', 'POLICY_DISTRIBUTOR_ADDRESS is not configured.');
    }

    const {
      riskId,
      policyType,
      sanitizedParams,
      metadata,
      extraData,
      termDays
    } = this.buildQuoteContext(request);

    const quote = await pricingService.getQuote(this.buildQuoteRequest(request, sanitizedParams));
    const cliffSeconds = quote.cliffHours * 3600;
    const now = currentUnixTime();
    const startAt = now + 300; // include short buffer for user confirmation
    const activeAt = addSeconds(startAt, cliffSeconds);
    const endAt = addSeconds(activeAt, termDays * 86_400);

    const premiumAtomic = this.toUSDC(quote.premiumUSD);
    const premiumDecimal = quote.premiumUSD.toFixed(6);
    const coverageCapAtomic = this.toUSDC(quote.coverageCapUSD);
    const coverageCapDecimal = quote.coverageCapUSD.toFixed(6);
    const insuredAmountAtomic = this.toInsuredAmount(request.product, request.insuredAmount);

    const mintParams: MintParamsShape = {
      policyType: policyType === 'CURVE_LP' ? CURVE_POLICY_TYPE : AAVE_POLICY_TYPE,
      riskId,
      insuredAmount: insuredAmountAtomic,
      coverageCap: coverageCapAtomic,
      deductibleBps: quote.deductibleBps,
      startAt,
      activeAt,
      endAt,
      extraData
    };

    const provider = getProvider();
    const chainId = appConfig.CHAIN_ID ?? Number((await provider.getNetwork()).chainId);
    const distributor = getPolicyDistributorContract();
    const nonce = await distributor.nonces(request.wallet);
    const deadline = addSeconds(currentUnixTime(), 60 * 60); // 1 hour

    const typedData: QuoteTypedData = {
      domain: {
        name: QUOTE_DOMAIN_NAME,
        version: QUOTE_DOMAIN_VERSION,
        chainId,
        verifyingContract: distributorAddress
      },
      types: QUOTE_TYPES,
      message: {
        buyer: request.wallet,
        policyType: mintParams.policyType,
        riskId: mintParams.riskId,
        insuredAmount: BigInt(mintParams.insuredAmount),
        coverageCap: BigInt(mintParams.coverageCap),
        deductibleBps: mintParams.deductibleBps,
        startAt: BigInt(mintParams.startAt),
        activeAt: BigInt(mintParams.activeAt),
        endAt: BigInt(mintParams.endAt),
        extraDataHash: keccak256(extraData),
        premium: BigInt(premiumAtomic),
        deadline: BigInt(deadline),
        nonce: nonce
      }
    };

    const signature = await this.quoteSigner.signTypedData(
      typedData.domain,
      typedData.types,
      typedData.message
    );

    const typedDataForClient: QuoteTypedData = {
      domain: typedData.domain,
      types: typedData.types,
      message: {
        buyer: request.wallet,
        policyType: mintParams.policyType,
        riskId: mintParams.riskId,
        insuredAmount: mintParams.insuredAmount,
        coverageCap: mintParams.coverageCap,
        deductibleBps: mintParams.deductibleBps,
        startAt: mintParams.startAt,
        activeAt: mintParams.activeAt,
        endAt: mintParams.endAt,
        extraDataHash: keccak256(extraData),
        premium: premiumAtomic,
        deadline: deadline.toString(),
        nonce: nonce.toString()
      }
    };

    const draft = await createPolicyDraft(
      this.buildDraftDbInput({
        request,
        riskId,
        policyType,
        metadata,
        sanitizedParams,
        quote,
        mintParams,
        premiumAtomic,
        premiumDecimal,
        coverageCapDecimal,
        startAt,
        activeAt,
        endAt,
        signature,
        deadline,
        nonce: nonce.toString(),
        distributorAddress,
        typedData: typedDataForClient,
        extraData
      })
    );

    return this.mapDraftRecordToResponse(draft, {
      quote,
      mintParams,
      signature,
      deadline,
      nonce: nonce.toString(),
      distributorAddress,
      typedData: typedDataForClient
    });
  }

  async finalizeDraft(request: FinalizePolicyRequest): Promise<PolicyRecord> {
    const draft = await getPolicyDraftById(request.draftId);
    if (!draft) {
      throw notFound('POLICY_DRAFT_NOT_FOUND', `Policy draft ${request.draftId} was not found.`);
    }

    const minted = await extractPolicyMintedFromTx(request.txHashMint);
    if (minted.owner.toLowerCase() !== draft.wallet.toLowerCase()) {
      throw badRequest('MINT_MISMATCH', 'Minted policy owner does not match draft wallet.');
    }

    const policyNft = getPolicyNftContract();
    const policyData = await policyNft.policyData(minted.policyId);

    const policyId = minted.policyId.toString();
    const onchainPolicyType = Number(policyData.policyType ?? 0) === AAVE_POLICY_TYPE ? 'AAVE_DLP' : 'CURVE_LP';

    const policyRecord = await upsertPolicyAndDeleteDraft({
      id: policyId,
      draftId: draft.id,
      wallet: minted.owner.toLowerCase(),
      product: draft.product,
      policyType: onchainPolicyType,
      riskId: (policyData.riskId ?? draft.riskId)?.toString() ?? draft.riskId,
      insuredAmount: policyData.insuredAmount?.toString() ?? draft.insuredAmount,
      coverageCapUsd: policyData.coverageCap
        ? this.fromUSDCAtomic(policyData.coverageCap)
        : draft.coverageCapUsd,
      deductibleBps: Number(policyData.deductibleBps ?? draft.deductibleBps),
      termDays: draft.termDays,
      startAt: Number(policyData.startAt ?? BigInt(draft.startAt)),
      activeAt: Number(policyData.activeAt ?? BigInt(draft.activeAt)),
      endAt: Number(policyData.endAt ?? BigInt(draft.endAt)),
      claimedUpTo: Number(policyData.claimedUpTo ?? 0n),
      nonce: 0,
      status: this.computeStatus(
        Number(policyData.startAt ?? BigInt(draft.startAt)),
        Number(policyData.endAt ?? BigInt(draft.endAt))
      ),
      metadata: {
        ...draft.metadata,
        premiumTxHash: request.premiumTxHash ?? null
      },
      nftTokenId: policyId
    }, draft.id);

    return this.mapPolicyRecord(policyRecord);
  }

  async listPolicies(wallet?: string): Promise<PolicyRecord[]> {
    if (!wallet) {
      return [];
    }
    const records = await listPoliciesByWallet(wallet);
    return records.map((record) => this.mapPolicyRecord(record));
  }

  async getPolicyById(policyId: string): Promise<PolicyRecord> {
    const record = await fetchPolicyById(policyId);
    if (!record) {
      throw notFound('POLICY_NOT_FOUND', `Policy ${policyId} was not found.`);
    }
    return this.mapPolicyRecord(record);
  }

  private buildQuoteRequest(
    request: PolicyDraftRequest,
    sanitizedParams: Record<string, unknown>
  ): QuoteRequest {
    if (request.product === 'DEPEG_LP') {
      return {
        product: 'DEPEG_LP',
        poolId: sanitizedParams.poolId as string,
        insuredLP: request.insuredAmount,
        termDays: request.termDays
      };
    }

    return {
      product: 'AAVE_DLP',
      params: {
        chainId: sanitizedParams.chainId as number,
        lendingPool: sanitizedParams.lendingPool as string,
        collateralAsset: sanitizedParams.collateralAsset as string,
        insuredAmountUSD: request.insuredAmount,
        ltv: sanitizedParams.ltv as number | undefined,
        healthFactor: sanitizedParams.healthFactor as number | undefined
      },
      termDays: request.termDays
    };
  }

  private buildQuoteContext(
    request: PolicyDraftRequest
  ): QuoteContext {
    if (request.product === 'DEPEG_LP') {
      const parsed = depegParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw badRequest('INVALID_PARAMS', 'Missing poolId for DEPEG_LP policy.', parsed.error.issues);
      }

      const riskId = keccak256(toUtf8Bytes(parsed.data.poolId));

      return {
        riskId,
        policyType: 'CURVE_LP',
        sanitizedParams: { poolId: parsed.data.poolId },
        metadata: { poolId: parsed.data.poolId },
        extraData: '0x',
        termDays: request.termDays
      };
    }

    const parsed = aaveParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw badRequest(
        'INVALID_PARAMS',
        'Missing or invalid lending configuration for AAVE_DLP policy.',
        parsed.error.issues
      );
    }

    const coverageRatio = parsed.data.coverageRatioBps ?? 8_000;
    const maxPayout = parsed.data.maxPayoutBps ?? 1_000;

    const extraData = AbiCoder.defaultAbiCoder().encode(
      ['tuple(uint32,address,address,uint16,uint16)'],
      [[
        parsed.data.chainId,
        parsed.data.lendingPool,
        parsed.data.collateralAsset,
        coverageRatio,
        maxPayout
      ]]
    );

    const riskId = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['uint32', 'address', 'address'],
        [parsed.data.chainId, parsed.data.lendingPool, parsed.data.collateralAsset]
      )
    );

    return {
      riskId,
      policyType: 'AAVE_DLP',
      sanitizedParams: {
        chainId: parsed.data.chainId,
        lendingPool: parsed.data.lendingPool,
        collateralAsset: parsed.data.collateralAsset,
        coverageRatioBps: coverageRatio,
        maxPayoutBps: maxPayout
      },
      metadata: {
        chainId: parsed.data.chainId,
        lendingPool: parsed.data.lendingPool,
        collateralAsset: parsed.data.collateralAsset,
        coverageRatioBps: coverageRatio,
        maxPayoutBps: maxPayout
      },
      extraData,
      termDays: request.termDays
    };
  }

  private buildDraftDbInput(params: {
    request: PolicyDraftRequest;
    riskId: string;
    policyType: PolicyType;
    metadata: Record<string, unknown>;
    sanitizedParams: Record<string, unknown>;
    quote: { premiumUSD: number; coverageCapUSD: number; deductibleBps: number; pricingBreakdown: Record<string, unknown> };
    mintParams: MintParamsShape;
    premiumAtomic: string;
    premiumDecimal: string;
    coverageCapDecimal: string;
    startAt: number;
    activeAt: number;
    endAt: number;
    signature: string;
    deadline: number;
    nonce: string;
    distributorAddress: string;
    typedData: QuoteTypedData;
    extraData: string;
  }): CreatePolicyDraftInput {
    return {
      wallet: params.request.wallet.toLowerCase(),
      product: params.request.product,
      policyType: params.policyType,
      riskId: params.riskId,
      termDays: params.request.termDays,
      insuredAmount: params.mintParams.insuredAmount,
      premiumUsd: params.premiumDecimal,
      coverageCapUsd: params.coverageCapDecimal,
      deductibleBps: params.quote.deductibleBps,
      startAt: params.startAt,
      activeAt: params.activeAt,
      endAt: params.endAt,
      termsHash: keccak256(toUtf8Bytes(JSON.stringify(params.sanitizedParams))),
      params: params.sanitizedParams,
      pricingBreakdown: params.quote.pricingBreakdown,
      onchainCalldata: {
        signature: params.signature,
        deadline: params.deadline,
        nonce: params.nonce,
        mintParams: params.mintParams,
        typedData: params.typedData,
        distributorAddress: params.distributorAddress,
        extraData: params.extraData,
        premiumAtomic: params.premiumAtomic,
        coverageCapAtomic: params.mintParams.coverageCap
      },
      metadata: params.metadata
    };
  }

  private mapDraftRecordToResponse(
    draft: PolicyDraftRecord,
    quoteInfo: {
      quote: { premiumUSD: number; coverageCapUSD: number; deductibleBps: number; pricingBreakdown: Record<string, unknown> };
      mintParams: MintParamsShape;
      signature: string;
      deadline: number;
      nonce: string;
      distributorAddress: string;
      typedData: QuoteTypedData;
    }
  ): PolicyDraft {
    const insuredDisplay = draft.policyType === 'AAVE_DLP'
      ? Number(draft.insuredAmount ?? '0') / 1e6
      : Number(draft.insuredAmount ?? '0');

    return {
      product: draft.product as any,
      premiumUSD: quoteInfo.quote.premiumUSD,
      coverageCapUSD: quoteInfo.quote.coverageCapUSD,
      deductibleBps: quoteInfo.quote.deductibleBps,
      cliffHours: Math.round((draft.activeAt - draft.startAt) / 3600),
      pricingBreakdown: quoteInfo.quote.pricingBreakdown,
      draftId: draft.id,
      wallet: draft.wallet,
      params: draft.params,
      termDays: draft.termDays as TermDays,
      insuredAmount: insuredDisplay,
      createdAt: draft.createdAt.toISOString(),
      termsHash: draft.termsHash,
      riskId: draft.riskId,
      policyType: draft.policyType as PolicyType,
      startAt: draft.startAt,
      activeAt: draft.activeAt,
      endAt: draft.endAt,
      metadata: draft.metadata,
      onchainCalldata: draft.onchainCalldata ?? undefined,
      distributorAddress: quoteInfo.distributorAddress,
      quoteSignature: quoteInfo.signature,
      quoteDeadline: quoteInfo.deadline,
      quoteNonce: quoteInfo.nonce,
      quoteTypedData: quoteInfo.typedData,
      mintParams: quoteInfo.mintParams
    };
  }

  private mapPolicyRecord(record: RepoPolicyRecord): PolicyRecord {
    return {
      policyId: record.id,
      draftId: record.draftId ?? undefined,
      nftTokenId: record.nftTokenId,
      policyType: record.policyType as PolicyType,
      riskId: record.riskId,
      product: record.product as any,
      wallet: record.wallet,
      insuredAmount: record.insuredAmount,
      termDays: record.termDays as TermDays,
      startAt: record.startAt,
      activeAt: record.activeAt,
      endAt: record.endAt,
      claimedUpTo: record.claimedUpTo,
      nonce: record.nonce,
      status: record.status as any,
      coverageCapUSD: record.coverageCapUsd,
      deductibleBps: record.deductibleBps,
      metadata: record.metadata
    };
  }

  private computeStatus(startAt: number, endAt: number): string {
    const now = currentUnixTime();
    if (now < startAt) {
      return 'draft';
    }
    if (now < endAt) {
      return 'active';
    }
    return 'expired';
  }

  private toUSDC(value: number): string {
    return parseUnits(value.toFixed(6), 6).toString();
  }

  private toInsuredAmount(product: string, amount: number): string {
    if (product === 'DEPEG_LP') {
      return BigInt(Math.round(amount)).toString();
    }
    return parseUnits(amount.toFixed(6), 6).toString();
  }

  private fromUSDCAtomic(value: string | bigint): string {
    const atomic = typeof value === 'bigint' ? value : BigInt(value);
    const units = atomic / 1_000_000n;
    const fraction = atomic % 1_000_000n;
    return `${units.toString()}.${fraction.toString().padStart(6, '0')}`;
  }
}

export const policyService = new PolicyService();
