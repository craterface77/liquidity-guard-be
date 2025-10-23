import { getPool } from '../core/database.js';

export interface PolicyRecord {
  id: string;
  draftId: string | null;
  wallet: string;
  product: string;
  policyType: string;
  riskId: string;
  insuredAmount: string;
  coverageCapUsd: string;
  deductibleBps: number;
  termDays: number;
  startAt: number;
  activeAt: number;
  endAt: number;
  claimedUpTo: number;
  nonce: number;
  status: string;
  metadata: Record<string, unknown>;
  nftTokenId: string;
  createdAt: Date;
}

export interface CreatePolicyInput {
  id: string;
  draftId: string | null;
  wallet: string;
  product: string;
  policyType: string;
  riskId: string;
  insuredAmount: string;
  coverageCapUsd: string;
  deductibleBps: number;
  termDays: number;
  startAt: number;
  activeAt: number;
  endAt: number;
  claimedUpTo: number;
  nonce: number;
  status: string;
  metadata: Record<string, unknown>;
  nftTokenId: string;
}

const INSERT_SQL = `
INSERT INTO policies (
  id,
  draft_id,
  wallet,
  product,
  policy_type,
  risk_id,
  insured_amount,
  coverage_cap_usd,
  deductible_bps,
  term_days,
  start_at,
  active_at,
  end_at,
  claimed_up_to,
  nonce,
  status,
  metadata,
  nft_token_id
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18
) ON CONFLICT (id)
DO UPDATE SET
  wallet = EXCLUDED.wallet,
  product = EXCLUDED.product,
  policy_type = EXCLUDED.policy_type,
  risk_id = EXCLUDED.risk_id,
  insured_amount = EXCLUDED.insured_amount,
  coverage_cap_usd = EXCLUDED.coverage_cap_usd,
  deductible_bps = EXCLUDED.deductible_bps,
  term_days = EXCLUDED.term_days,
  start_at = EXCLUDED.start_at,
  active_at = EXCLUDED.active_at,
  end_at = EXCLUDED.end_at,
  claimed_up_to = EXCLUDED.claimed_up_to,
  nonce = EXCLUDED.nonce,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata
RETURNING *
`;

const SELECT_BY_ID = 'SELECT * FROM policies WHERE id = $1';
const SELECT_BY_WALLET = 'SELECT * FROM policies WHERE wallet = $1 ORDER BY created_at DESC';
const UPDATE_STATUS = 'UPDATE policies SET status = $2, claimed_up_to = $3, nonce = $4, metadata = metadata || $5::jsonb WHERE id = $1';

function mapRow(row: Record<string, any>): PolicyRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    wallet: row.wallet,
    product: row.product,
    policyType: row.policy_type,
    riskId: row.risk_id,
    insuredAmount: row.insured_amount,
    coverageCapUsd: row.coverage_cap_usd,
    deductibleBps: Number(row.deductible_bps),
    termDays: Number(row.term_days),
    startAt: Number(row.start_at),
    activeAt: Number(row.active_at),
    endAt: Number(row.end_at),
    claimedUpTo: Number(row.claimed_up_to),
    nonce: Number(row.nonce),
    status: row.status,
    metadata: row.metadata ?? {},
    nftTokenId: row.nft_token_id,
    createdAt: new Date(row.created_at)
  };
}

export async function upsertPolicy(input: CreatePolicyInput): Promise<PolicyRecord> {
  const pool = getPool();
  const result = await pool.query(INSERT_SQL, [
    input.id,
    input.draftId,
    input.wallet,
    input.product,
    input.policyType,
    input.riskId,
    input.insuredAmount,
    input.coverageCapUsd,
    input.deductibleBps,
    input.termDays,
    input.startAt,
    input.activeAt,
    input.endAt,
    input.claimedUpTo,
    input.nonce,
    input.status,
    JSON.stringify(input.metadata ?? {}),
    input.nftTokenId
  ]);
  return mapRow(result.rows[0]);
}

export async function getPolicyById(id: string): Promise<PolicyRecord | null> {
  const pool = getPool();
  const result = await pool.query(SELECT_BY_ID, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function listPoliciesByWallet(wallet: string): Promise<PolicyRecord[]> {
  const pool = getPool();
  const result = await pool.query(SELECT_BY_WALLET, [wallet]);
  return result.rows.map(mapRow);
}

export async function updatePolicyStatus(
  id: string,
  status: string,
  claimedUpTo: number,
  nonce: number,
  metadataPatch: Record<string, unknown> = {}
): Promise<void> {
  const pool = getPool();
  await pool.query(UPDATE_STATUS, [
    id,
    status,
    claimedUpTo,
    nonce,
    JSON.stringify(metadataPatch ?? {})
  ]);
}

export async function mergePolicyMetadataByRiskAndOwner(
  riskId: string,
  owner: string,
  patch: Record<string, unknown>
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE policies
       SET metadata = metadata || $3::jsonb
     WHERE risk_id = $1 AND LOWER(wallet) = LOWER($2)`,
    [riskId, owner, JSON.stringify(patch ?? {})]
  );
}

/**
 * Atomically create policy and delete draft in a transaction
 */
export async function upsertPolicyAndDeleteDraft(
  policyInput: CreatePolicyInput,
  draftId: string
): Promise<PolicyRecord> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert/update policy
    const policyResult = await client.query(INSERT_SQL, [
      policyInput.id,
      policyInput.draftId,
      policyInput.wallet,
      policyInput.product,
      policyInput.policyType,
      policyInput.riskId,
      policyInput.insuredAmount,
      policyInput.coverageCapUsd,
      policyInput.deductibleBps,
      policyInput.termDays,
      policyInput.startAt,
      policyInput.activeAt,
      policyInput.endAt,
      policyInput.claimedUpTo,
      policyInput.nonce,
      policyInput.status,
      JSON.stringify(policyInput.metadata ?? {}),
      policyInput.nftTokenId
    ]);

    // Delete draft
    await client.query('DELETE FROM policy_drafts WHERE id = $1', [draftId]);

    await client.query('COMMIT');
    return mapRow(policyResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
