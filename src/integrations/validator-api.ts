import crypto from 'node:crypto';

import { appConfig } from '../core/env.js';

interface ValidatorRisk {
  riskId: string;
  product: string;
  poolId: string;
  state: string;
  updatedAt: number;
  latestWindow: { S: number; E: number | null } | null;
  metrics: {
    twap1h?: string | null;
    twap4h?: string | null;
    liquidityUSD?: string | null;
  };
  samplesCount?: number;
}

interface ListRisksResponse {
  items: ValidatorRisk[];
}

interface ClaimPreviewRequestBody {
  policy: Record<string, unknown>;
  claimMode: string;
  timestamp?: number;
}

interface ClaimPreviewResponse {
  riskId: string;
  policyId: string;
  S: number;
  E: number;
  Lstar: string | number;
  refValue: string;
  curValue: string;
  payout: string;
  twapStart?: string | null;
  twapEnd?: string | null;
  snapshots?: unknown;
  inputs?: Record<string, unknown>;
}

interface ClaimSignRequestBody extends ClaimPreviewRequestBody {
  deadline?: number;
}

interface ClaimSignResponse {
  policyId: string;
  riskId: string;
  typedData: Record<string, unknown>;
  signature: string;
  expiresAt: number;
  calc?: Record<string, unknown>;
}

class ValidatorApiClient {
  private readonly baseUrl?: string;
  private readonly secret?: string;

  constructor() {
    this.baseUrl = appConfig.VALIDATOR_API_BASE_URL;
    this.secret = appConfig.VALIDATOR_API_SECRET;
  }

  private ensureConfigured() {
    if (!this.baseUrl) {
      throw new Error('VALIDATOR_API_BASE_URL is not configured');
    }
  }

  private createHeaders(method: string, body?: string): HeadersInit {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (this.secret && method.toUpperCase() === 'POST') {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payload = `${timestamp}.${body ?? ''}`;
      const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');
      headers['x-lg-timestamp'] = timestamp;
      headers['x-lg-signature'] = signature;
    }

    return headers;
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    this.ensureConfigured();
    const method = options.method ?? 'GET';
    const bodyString = options.body ? JSON.stringify(options.body) : undefined;

    const response = await fetch(new URL(path, this.baseUrl).toString(), {
      method,
      headers: this.createHeaders(method, bodyString),
      body: bodyString
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Validator API error ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async listRisks(): Promise<ValidatorRisk[]> {
    const data = await this.request<ListRisksResponse>('/validator/api/v1/risk');
    return data.items ?? [];
  }

  async previewClaim(body: ClaimPreviewRequestBody): Promise<ClaimPreviewResponse> {
    return this.request<ClaimPreviewResponse>('/validator/api/v1/claims/preview', {
      method: 'POST',
      body
    });
  }

  async signClaim(body: ClaimSignRequestBody): Promise<ClaimSignResponse> {
    return this.request<ClaimSignResponse>('/validator/api/v1/claims/sign', {
      method: 'POST',
      body
    });
  }
}

export const validatorApi = new ValidatorApiClient();
