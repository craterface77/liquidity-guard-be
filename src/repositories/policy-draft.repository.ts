import { randomUUID } from 'crypto';

import { getPool } from '../core/database.js';

export interface PolicyDraftRecord {
  id: string;
  wallet: string;
  product: string;
  policyType: string;
  riskId: string;
  termDays: number;
  insuredAmount: string;
  premiumUsd: string;
  coverageCapUsd: string;
  deductibleBps: number;
  startAt: number;
  activeAt: number;
  endAt: number;
  termsHash: string;
  params: Record<string, unknown>;
  pricingBreakdown: Record<string, unknown>;
  onchainCalldata: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreatePolicyDraftInput {
  wallet: string;
  product: string;
  policyType: string;
  riskId: string;
  termDays: number;
  insuredAmount: string;
  premiumUsd: string;
  coverageCapUsd: string;
  deductibleBps: number;
  startAt: number;
  activeAt: number;
  endAt: number;
  termsHash: string;
  params: Record<string, unknown>;
  pricingBreakdown: Record<string, unknown>;
  onchainCalldata: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

const INSERT_SQL = `
INSERT INTO policy_drafts (
  id,
  wallet,
  product,
  risk_id,
  policy_type,
  term_days,
  insured_amount,
  premium_usd,
  coverage_cap_usd,
  deductible_bps,
  start_at,
  active_at,
  end_at,
  terms_hash,
  params,
  pricing_breakdown,
  onchain_calldata,
  metadata
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb
) RETURNING *
`;

const SELECT_SQL = 'SELECT * FROM policy_drafts WHERE id = $1';
const DELETE_SQL = 'DELETE FROM policy_drafts WHERE id = $1';

function mapRow(row: Record<string, any>): PolicyDraftRecord {
  return {
    id: row.id,
    wallet: row.wallet,
    product: row.product,
    policyType: row.policy_type,
    riskId: row.risk_id,
    termDays: Number(row.term_days),
    insuredAmount: row.insured_amount,
    premiumUsd: row.premium_usd,
    coverageCapUsd: row.coverage_cap_usd,
    deductibleBps: Number(row.deductible_bps),
    startAt: Number(row.start_at),
    activeAt: Number(row.active_at),
    endAt: Number(row.end_at),
    termsHash: row.terms_hash,
    params: row.params ?? {},
    pricingBreakdown: row.pricing_breakdown ?? {},
    onchainCalldata: row.onchain_calldata,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at)
  };
}

export async function createPolicyDraft(
  input: CreatePolicyDraftInput,
  id: string = randomUUID()
): Promise<PolicyDraftRecord> {
  const pool = getPool();
  const result = await pool.query(INSERT_SQL, [
    id,
    input.wallet,
    input.product,
    input.riskId,
    input.policyType,
    input.termDays,
    input.insuredAmount,
    input.premiumUsd,
    input.coverageCapUsd,
    input.deductibleBps,
    input.startAt,
    input.activeAt,
    input.endAt,
    input.termsHash,
    JSON.stringify(input.params ?? {}),
    JSON.stringify(input.pricingBreakdown ?? {}),
    JSON.stringify(input.onchainCalldata ?? null),
    JSON.stringify(input.metadata ?? {})
  ]);

  return mapRow(result.rows[0]);
}

export async function getPolicyDraftById(id: string): Promise<PolicyDraftRecord | null> {
  const pool = getPool();
  const result = await pool.query(SELECT_SQL, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function deletePolicyDraft(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(DELETE_SQL, [id]);
}
