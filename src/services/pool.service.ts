import type {
  PoolListParams,
  PoolSummary,
  PoolState
} from '../domain/types.js';
import { appConfig } from '../core/env.js';
import { validatorApi } from '../integrations/validator-api.js';

const stateMap: Record<string, PoolState> = {
  GREEN: 'Green',
  YELLOW: 'Yellow',
  RED: 'Red'
};

export class PoolService {
  async listPools(params: PoolListParams): Promise<PoolSummary[]> {
    try {
      const risks = await validatorApi.listRisks();

      const items = risks
      .filter((risk) =>
        params.state ? stateMap[risk.state?.toUpperCase() ?? ''] === params.state : true
      )
      .map<PoolSummary>((risk) => {
        const metrics = risk.metrics ?? {};
        return {
          poolId: risk.poolId ?? risk.riskId,
          chainId:  appConfig.CHAIN_ID ?? 1,
          name: risk.poolId ?? risk.riskId,
          address: risk.poolId ?? risk.riskId,
          riskId: risk.riskId,
          state: stateMap[risk.state?.toUpperCase() ?? 'GREEN'] ?? 'Green',
          metrics: {
            twap: metrics.twap1h ? Number(metrics.twap1h) : null,
            reserveRatio: null,
            updatedAt: risk.updatedAt ? new Date(risk.updatedAt * 1000).toISOString() : null
          }
        };
      });

      return items;
    } catch (error) {
      // If validator is not available, return empty array instead of throwing error
      // This allows the frontend to work even if validator is down
      console.warn('Failed to fetch pools from validator:', error instanceof Error ? error.message : error);
      return [];
    }
  }

}

export const poolService = new PoolService();
