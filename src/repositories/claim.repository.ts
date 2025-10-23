import { randomUUID } from 'crypto';

import { getPool } from '../core/database.js';

export interface ClaimRecord {
  id: string;
  policyId: string;
  product: string;
  status: string;
  payout: string;
  payload: Record<string, unknown>;
  signature: string | null;
  expiresAt: Date | null;
  txHash: string | null;
  createdAt: Date;
}

export interface CreateClaimInput {
  id?: string;
  policyId: string;
  product: string;
  status: string;
  payout: string;
  payload: Record<string, unknown>;
  signature: string | null;
  expiresAt: Date | null;
  txHash: string | null;
}

const INSERT_SQL = `
INSERT INTO claims (
  id,
  policy_id,
  product,
  status,
  payout,
  payload,
  signature,
  expires_at,
  tx_hash
) VALUES (
  $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9
) RETURNING *
`;

const SELECT_BY_POLICY = 'SELECT * FROM claims WHERE policy_id = $1 ORDER BY created_at DESC';
const SELECT_BY_ID = 'SELECT * FROM claims WHERE id = $1';
const SELECT_QUEUED = `
SELECT c.*, p.wallet, p.risk_id
FROM claims c
JOIN policies p ON c.policy_id = p.id
WHERE c.status = 'queued'
ORDER BY c.created_at ASC
`;
const UPDATE_STATUS = `
UPDATE claims
SET status = $2,
    tx_hash = COALESCE($3, tx_hash)
WHERE id = $1
`;

function mapRow(row: Record<string, any>): ClaimRecord {
  return {
    id: row.id,
    policyId: row.policy_id,
    product: row.product,
    status: row.status,
    payout: row.payout,
    payload: row.payload ?? {},
    signature: row.signature,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    txHash: row.tx_hash,
    createdAt: new Date(row.created_at)
  };
}

export async function createClaim(input: CreateClaimInput): Promise<ClaimRecord> {
  const pool = getPool();
  const id = input.id ?? randomUUID();
  const result = await pool.query(INSERT_SQL, [
    id,
    input.policyId,
    input.product,
    input.status,
    input.payout,
    JSON.stringify(input.payload ?? {}),
    input.signature,
    input.expiresAt ? input.expiresAt.toISOString() : null,
    input.txHash
  ]);
  return mapRow(result.rows[0]);
}

export async function listClaimsByPolicy(policyId: string): Promise<ClaimRecord[]> {
  const pool = getPool();
  const result = await pool.query(SELECT_BY_POLICY, [policyId]);
  return result.rows.map(mapRow);
}

export async function getClaimById(id: string): Promise<ClaimRecord | null> {
  const pool = getPool();
  const result = await pool.query(SELECT_BY_ID, [id]);
  if (result.rowCount === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function updateClaimStatus(id: string, status: string, txHash?: string | null): Promise<void> {
  const pool = getPool();
  await pool.query(UPDATE_STATUS, [id, status, txHash ?? null]);
}

export interface QueuedClaimRecord extends ClaimRecord {
  wallet: string;
  riskId: string;
}

export async function listQueuedClaims(): Promise<QueuedClaimRecord[]> {
  const pool = getPool();
  const result = await pool.query(SELECT_QUEUED);
  return result.rows.map((row: any) => ({
    ...mapRow(row),
    wallet: row.wallet,
    riskId: row.risk_id
  }));
}
