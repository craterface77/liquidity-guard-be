const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS policy_drafts (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL,
    product TEXT NOT NULL,
    risk_id TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    term_days INTEGER NOT NULL,
    insured_amount NUMERIC(78, 0) NOT NULL,
    premium_usd NUMERIC(78, 6) NOT NULL,
    coverage_cap_usd NUMERIC(78, 6) NOT NULL,
    deductible_bps INTEGER NOT NULL,
    start_at BIGINT NOT NULL,
    active_at BIGINT NOT NULL,
    end_at BIGINT NOT NULL,
    terms_hash TEXT NOT NULL,
    params JSONB NOT NULL,
    pricing_breakdown JSONB NOT NULL,
    onchain_calldata JSONB,
    metadata JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    draft_id TEXT,
    wallet TEXT NOT NULL,
    product TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    risk_id TEXT NOT NULL,
    insured_amount NUMERIC(78, 0) NOT NULL,
    coverage_cap_usd NUMERIC(78, 6) NOT NULL,
    deductible_bps INTEGER NOT NULL,
    term_days INTEGER NOT NULL,
    start_at BIGINT NOT NULL,
    active_at BIGINT NOT NULL,
    end_at BIGINT NOT NULL,
    claimed_up_to BIGINT DEFAULT 0,
    nonce INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    metadata JSONB NOT NULL,
    nft_token_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS anchors (
    id BIGSERIAL PRIMARY KEY,
    risk_id TEXT NOT NULL,
    anchor_type TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    twap_e18 NUMERIC(78, 0) NOT NULL,
    snapshot_cid TEXT NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (risk_id, anchor_type)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS liquidations (
    id BIGSERIAL PRIMARY KEY,
    risk_id TEXT NOT NULL,
    liquidation_id TEXT NOT NULL,
    user_address TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    twap_e18 NUMERIC(78, 0) NOT NULL,
    hf_before_e4 INTEGER NOT NULL,
    hf_after_e4 INTEGER NOT NULL,
    snapshot_cid TEXT NOT NULL,
    tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (risk_id, liquidation_id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    product TEXT NOT NULL,
    status TEXT NOT NULL,
    payout NUMERIC(78, 6) NOT NULL,
    payload JSONB NOT NULL,
    signature TEXT,
    expires_at TIMESTAMPTZ,
    tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  );
  `
];

export async function runMigrations(pool: any): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )`
  );

  for (let i = 0; i < MIGRATIONS.length; i += 1) {
    const name = `migration_${i + 1}`;

    const { rows } = await pool.query('SELECT 1 FROM migrations WHERE name = $1', [name]);
    if (rows.length > 0) {
      continue;
    }

    const migration = MIGRATIONS[i];
    await pool.query('BEGIN');
    try {
      await pool.query(migration);
      await pool.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}
