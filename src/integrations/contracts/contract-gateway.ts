import { Buffer } from 'node:buffer';

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  hexlify,
  isHexString,
  zeroPadValue,
  keccak256,
  toUtf8Bytes
} from 'ethers';

import { appConfig } from '../../core/env.js';
import type {
  AnchorPayload,
  AnchorPoint,
  AnchoredWindow,
  LiquidationEvidence,
  PoolListParams,
  PoolSummary,
  ReserveOverview,
  WhitelistRequest
} from '../../domain/types.js';
import { currentUnixTime } from '../../utils/datetime.js';
import { ORACLE_ANCHORS_ABI } from './oracle-anchors.abi.js';
import { getPool } from '../../core/database.js';
import { mergePolicyMetadataByRiskAndOwner } from '../../repositories/policy.repository.js';
import { RESERVE_POOL_ABI } from './abis/reserve-pool.abi.js';

function getJsonRpcProvider(): JsonRpcProvider {
  if (!appConfig.RPC_URL) {
    throw new Error('RPC_URL is not configured.');
  }
  return new JsonRpcProvider(appConfig.RPC_URL);
}

const poolCatalogue: PoolSummary[] = [
  {
    poolId: 'curve-pyusd-usdc',
    chainId: appConfig.CHAIN_ID ?? 1,
    name: 'Curve PYUSD/USDC',
    address: '0xPoolPYUSDUSDC',
    riskId: keccak256(toUtf8Bytes('curve-pyusd-usdc')),
    state: 'Green',
    metrics: {
      twap: 1.0,
      reserveRatio: 0.62,
      updatedAt: new Date().toISOString()
    }
  },
  {
    poolId: 'curve-usdt-usdc',
    chainId: appConfig.CHAIN_ID ?? 1,
    name: 'Curve USDT/USDC',
    address: '0xPoolUSDTUSDC',
    riskId: keccak256(toUtf8Bytes('curve-usdt-usdc')),
    state: 'Yellow',
    metrics: {
      twap: 0.998,
      reserveRatio: 0.38,
      updatedAt: new Date().toISOString()
    }
  }
];

export class ContractGateway {
  private readonly oracleContract: Contract | null;
  private readonly pool: any;
  private readonly bootstrapPromise: Promise<void>;
  private readonly anchors = new Map<string, { start: AnchorPoint | null; end: AnchorPoint | null }>();
  private readonly liquidations = new Map<string, Map<string, LiquidationEvidence>>();

  constructor() {
    this.pool = appConfig.DATABASE_URL || appConfig.DB_HOST ? getPool() : null;
    this.oracleContract = this.createOracleContract();
    this.bootstrapPromise = this.bootstrapFromDatabase();
  }

  async listPools(params: PoolListParams): Promise<PoolSummary[]> {
    return poolCatalogue.filter((pool) => {
      const matchesState = params.state ? pool.state === params.state : true;
      const matchesChain = params.chainId ? pool.chainId === params.chainId : true;
      return matchesState && matchesChain;
    });
  }

  async getPoolById(poolId: string): Promise<PoolSummary | undefined> {
    return poolCatalogue.find((pool) => pool.poolId === poolId);
  }

  async publishAnchor(payload: AnchorPayload): Promise<void> {
    await this.ensureReady();
    switch (payload.type) {
      case 'DEPEG_START': {
        const anchor = this.parseAnchor(payload);
        await this.submitDepegStart(anchor.riskId, anchor.anchor);
        this.anchors.set(anchor.riskId, {
          start: anchor.anchor,
          end: this.anchors.get(anchor.riskId)?.end ?? null
        });
        break;
      }
      case 'DEPEG_END': {
        const anchor = this.parseAnchor(payload);
        await this.submitDepegEnd(anchor.riskId, anchor.anchor);
        const existing = this.anchors.get(anchor.riskId) ?? { start: null, end: null };
        this.anchors.set(anchor.riskId, {
          start: existing.start,
          end: anchor.anchor
        });
        break;
      }
      case 'DEPEG_LIQ':
      case 'LIQUIDATION': {
        const liquidation = this.parseLiquidation(payload);
        await this.submitLiquidation(liquidation);
        const map = this.liquidations.get(liquidation.riskId) ?? new Map<string, LiquidationEvidence>();
        map.set(liquidation.liquidationId, liquidation);
        this.liquidations.set(liquidation.riskId, map);
        break;
      }
      default:
        break;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async recordWhitelistChange(_request: WhitelistRequest): Promise<void> {
    // Placeholder - whitelist updates can be persisted in DB or config service
  }

  async getDepegWindow(riskId: string): Promise<AnchoredWindow> {
    await this.ensureReady();
    const entry = this.anchors.get(riskId) ?? { start: null, end: null };
    return {
      riskId,
      start: entry.start,
      end: entry.end
    };
  }

  async getLiquidationEvidence(riskId: string, liquidationId: string): Promise<LiquidationEvidence | null> {
    await this.ensureReady();
    const records = this.liquidations.get(riskId);
    if (!records) return null;
    return records.get(liquidationId) ?? null;
  }

  async getReserveOverview(): Promise<ReserveOverview> {
    const fallback: ReserveOverview = {
      navUSD: 0,
      cashRatio: 0,
      pendingClaimsUSD: 0,
      pendingRedemptionsUSD: 0,
      lgusdPricePerShare: 1,
      updatedAt: new Date().toISOString()
    };

    if (!appConfig.RESERVE_POOL_ADDRESS || !appConfig.RPC_URL) {
      return fallback;
    }

    try {
      const provider = getJsonRpcProvider();
      const reservePool = new Contract(appConfig.RESERVE_POOL_ADDRESS, RESERVE_POOL_ABI, provider);
      const [totalManagedAssets, pendingClaims, pendingRedemptions] = await Promise.all([
        reservePool.totalManagedAssets(),
        reservePool.pendingClaims(),
        reservePool.pendingRedemptions()
      ]);

      const nav = Number(totalManagedAssets) / 1e6;
      const pendingClaimsUSD = Number(pendingClaims) / 1e6;
      const pendingRedemptionsUSD = Number(pendingRedemptions) / 1e6;
      const cashRatio = nav > 0 ? Math.max(0, 1 - (pendingClaimsUSD + pendingRedemptionsUSD) / nav) : 0;

      return {
        navUSD: nav,
        cashRatio,
        pendingClaimsUSD,
        pendingRedemptionsUSD,
        lgusdPricePerShare: 1,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      return fallback;
    }
  }

  private async ensureReady(): Promise<void> {
    await this.bootstrapPromise;
  }

  private async bootstrapFromDatabase(): Promise<void> {
    if (!this.pool) {
      return;
    }

    const anchorRows = await this.pool.query(
      'SELECT risk_id, anchor_type, timestamp, twap_e18, snapshot_cid FROM anchors ORDER BY created_at'
    );
    for (const row of anchorRows.rows) {
      const record: AnchorPoint = {
        timestamp: Number(row.timestamp),
        twapE18: typeof row.twap_e18 === 'string' ? row.twap_e18 : String(row.twap_e18 ?? '0'),
        snapshotCid: row.snapshot_cid
      };

      if (row.anchor_type === 'DEPEG_START') {
        this.anchors.set(row.risk_id, {
          start: record,
          end: this.anchors.get(row.risk_id)?.end ?? null
        });
      } else if (row.anchor_type === 'DEPEG_END') {
        const existing = this.anchors.get(row.risk_id) ?? { start: null, end: null };
        this.anchors.set(row.risk_id, {
          start: existing.start,
          end: record
        });
      }
    }

    const liquidationRows = await this.pool.query(
      'SELECT risk_id, liquidation_id, user_address, timestamp, twap_e18, hf_before_e4, hf_after_e4, snapshot_cid FROM liquidations'
    );
    for (const row of liquidationRows.rows) {
      const entry: LiquidationEvidence = {
        riskId: row.risk_id,
        liquidationId: row.liquidation_id,
        user: row.user_address,
        timestamp: Number(row.timestamp),
        twapE18: typeof row.twap_e18 === 'string' ? row.twap_e18 : String(row.twap_e18 ?? '0'),
        hfBeforeE4: Number(row.hf_before_e4),
        hfAfterE4: Number(row.hf_after_e4),
        snapshotCid: row.snapshot_cid
      };

      const map = this.liquidations.get(entry.riskId) ?? new Map<string, LiquidationEvidence>();
      map.set(entry.liquidationId, entry);
      this.liquidations.set(entry.riskId, map);
    }
  }

  private createOracleContract(): Contract | null {
    if (
      !appConfig.RPC_URL ||
      !appConfig.ORACLE_SIGNER_KEY ||
      !appConfig.ORACLE_ANCHORS_ADDRESS
    ) {
      return null;
    }

    try {
      const provider = getJsonRpcProvider();
      const wallet = new Wallet(appConfig.ORACLE_SIGNER_KEY, provider);
      return new Contract(appConfig.ORACLE_ANCHORS_ADDRESS, ORACLE_ANCHORS_ABI, wallet);
    } catch (error) {
      console.error('Failed to initialize OracleAnchors contract', error);
      return null;
    }
  }

  private parseAnchor(payload: AnchorPayload): { riskId: string; anchor: AnchorPoint } {
    const riskIdSource =
      typeof payload.payload.riskId === 'string'
        ? payload.payload.riskId
        : typeof payload.payload.poolId === 'string'
          ? payload.payload.poolId
          : null;
    const timestampSource = payload.payload.timestamp ?? payload.payload.S ?? 0;
    const twapSource = payload.payload.twapE18 ?? payload.payload.twap ?? '0';

    if (!riskIdSource) {
      throw new Error('Invalid anchor payload: missing riskId');
    }

    const timestamp = Number(this.normalizeUint(timestampSource, 'timestamp'));
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error('Invalid anchor payload: timestamp must be positive');
    }

    const twap = this.normalizeUint(twapSource, 'twapE18').toString();
    const snapshotCid = this.normalizeBytes32(payload.ipfsCID, 'snapshotCid');
    const riskId = this.normalizeBytes32(riskIdSource, 'riskId');

    return {
      riskId,
      anchor: {
        timestamp,
        twapE18: twap,
        snapshotCid
      }
    };
  }

  private parseLiquidation(payload: AnchorPayload): LiquidationEvidence {
    const riskIdSource = typeof payload.payload.riskId === 'string' ? payload.payload.riskId : null;
    const liquidationIdSource = typeof payload.payload.liquidationId === 'string' ? payload.payload.liquidationId : null;
    const userSource = typeof payload.payload.user === 'string' ? payload.payload.user : null;
    const timestampSource = payload.payload.timestamp ?? payload.payload.S ?? 0;
    const twapE18Source = payload.payload.twapE18 ?? '0';
    const hfBeforeE4Source = payload.payload.hfBeforeE4 ?? 0;
    const hfAfterE4Source = payload.payload.hfAfterE4 ?? 0;

    if (!riskIdSource || !liquidationIdSource || !userSource) {
      throw new Error('Invalid liquidation payload: missing identifiers');
    }

    const timestamp = Number(this.normalizeUint(timestampSource, 'timestamp'));
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error('Invalid liquidation payload: timestamp must be positive');
    }

    return {
      riskId: this.normalizeBytes32(riskIdSource, 'riskId'),
      liquidationId: this.normalizeBytes32(liquidationIdSource, 'liquidationId'),
      user: this.normalizeAddress(userSource),
      timestamp,
      twapE18: this.normalizeUint(twapE18Source, 'twapE18').toString(),
      hfBeforeE4: Number(this.normalizeUint(hfBeforeE4Source, 'hfBeforeE4')),
      hfAfterE4: Number(this.normalizeUint(hfAfterE4Source, 'hfAfterE4')),
      snapshotCid: this.normalizeBytes32(payload.ipfsCID, 'snapshotCid')
    };
  }

  private async submitDepegStart(riskId: string, anchor: AnchorPoint): Promise<void> {
    if (!this.oracleContract) {
      return;
    }

    const tx = await this.oracleContract.anchorDepegStart(
      this.normalizeBytes32(riskId, 'riskId'),
      this.normalizeUint(anchor.timestamp, 'timestamp'),
      this.normalizeUint(anchor.twapE18, 'twapE18'),
      this.normalizeBytes32(anchor.snapshotCid, 'snapshotCid')
    );
    const receipt = await tx.wait();
    await this.persistAnchor(riskId, 'DEPEG_START', anchor, receipt?.hash);
  }

  private async submitDepegEnd(riskId: string, anchor: AnchorPoint): Promise<void> {
    if (!this.oracleContract) {
      return;
    }

    const tx = await this.oracleContract.anchorDepegEnd(
      this.normalizeBytes32(riskId, 'riskId'),
      this.normalizeUint(anchor.timestamp, 'timestamp'),
      this.normalizeUint(anchor.twapE18, 'twapE18'),
      this.normalizeBytes32(anchor.snapshotCid, 'snapshotCid')
    );
    const receipt = await tx.wait();
    await this.persistAnchor(riskId, 'DEPEG_END', anchor, receipt?.hash);
  }

  private async submitLiquidation(evidence: LiquidationEvidence): Promise<void> {
    if (!this.oracleContract) {
      return;
    }

    const tx = await this.oracleContract.anchorDepegLiquidation(
      this.normalizeBytes32(evidence.riskId, 'riskId'),
      this.normalizeBytes32(evidence.liquidationId, 'liquidationId'),
      this.normalizeAddress(evidence.user),
      this.normalizeUint(evidence.timestamp, 'timestamp'),
      this.normalizeUint(evidence.twapE18, 'twapE18'),
      this.normalizeUint(evidence.hfBeforeE4, 'hfBeforeE4'),
      this.normalizeUint(evidence.hfAfterE4, 'hfAfterE4'),
      this.normalizeBytes32(evidence.snapshotCid, 'snapshotCid')
    );
    const receipt = await tx.wait();
    await this.persistLiquidation(evidence, receipt?.hash);
  }

  private async persistAnchor(
    riskId: string,
    type: 'DEPEG_START' | 'DEPEG_END',
    anchor: AnchorPoint,
    txHash?: string
  ): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.query(
      `INSERT INTO anchors (risk_id, anchor_type, timestamp, twap_e18, snapshot_cid, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (risk_id, anchor_type)
       DO UPDATE SET timestamp = EXCLUDED.timestamp,
                     twap_e18 = EXCLUDED.twap_e18,
                     snapshot_cid = EXCLUDED.snapshot_cid,
                     tx_hash = EXCLUDED.tx_hash,
                     created_at = anchors.created_at`,
      [
        riskId,
        type,
        String(anchor.timestamp),
        anchor.twapE18,
        anchor.snapshotCid,
        txHash ?? null
      ]
    );
  }

  private async persistLiquidation(evidence: LiquidationEvidence, txHash?: string): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.query(
      `INSERT INTO liquidations
         (risk_id, liquidation_id, user_address, timestamp, twap_e18, hf_before_e4, hf_after_e4, snapshot_cid, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (risk_id, liquidation_id)
       DO UPDATE SET user_address = EXCLUDED.user_address,
                     timestamp = EXCLUDED.timestamp,
                     twap_e18 = EXCLUDED.twap_e18,
                     hf_before_e4 = EXCLUDED.hf_before_e4,
                     hf_after_e4 = EXCLUDED.hf_after_e4,
                     snapshot_cid = EXCLUDED.snapshot_cid,
                     tx_hash = EXCLUDED.tx_hash,
                     created_at = liquidations.created_at`,
      [
        evidence.riskId,
        evidence.liquidationId,
        evidence.user,
        String(evidence.timestamp),
        evidence.twapE18,
        evidence.hfBeforeE4,
        evidence.hfAfterE4,
        evidence.snapshotCid,
        txHash ?? null
      ]
    );

    await mergePolicyMetadataByRiskAndOwner(evidence.riskId, evidence.user, {
      lastLiquidationId: evidence.liquidationId
    });
  }

  private normalizeUint(value: unknown, label: string): bigint {
    if (typeof value === 'bigint') {
      if (value < 0n) {
        throw new Error(`${label} must be non-negative`);
      }
      return value;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative number`);
      }
      return BigInt(Math.floor(value));
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error(`${label} is required`);
      }
      if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
        return BigInt(trimmed);
      }
      if (!/^[0-9]+$/.test(trimmed)) {
        throw new Error(`${label} must be a decimal or hex integer string`);
      }
      return BigInt(trimmed);
    }

    throw new Error(`${label} is not a valid integer value`);
  }

  private normalizeBytes32(value: string, label: string): `0x${string}` {
    const raw = value?.toString().trim();
    if (!raw) {
      throw new Error(`${label} is required`);
    }

    if (isHexString(raw)) {
      const hex = hexlify(raw);
      return (hex.length === 66
        ? hex
        : hexlify(zeroPadValue(hex, 32))) as `0x${string}`;
    }

    const utf8 = Buffer.from(raw, 'utf8');
    if (utf8.length > 32) {
      return keccak256(utf8) as `0x${string}`;
    }

    const padded = Buffer.concat([utf8, Buffer.alloc(32 - utf8.length)]);
    return hexlify(padded) as `0x${string}`;
  }

  private normalizeAddress(value: string): string {
    return getAddress(value);
  }
}

let singleton: ContractGateway | null = null;

export function getContractGateway(): ContractGateway {
  if (!singleton) {
    singleton = new ContractGateway();
  }
  return singleton;
}
