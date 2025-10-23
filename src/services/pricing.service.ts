import type {
  AaveDlpQuoteRequest,
  DepegLpQuoteRequest,
  QuoteRequest,
  QuoteResponse,
  TermDays
} from '../domain/types.js';
import { getContractGateway } from '../integrations/contracts/contract-gateway.js';

const TERM_BASE_RATE: Record<TermDays, number> = {
  10: 0.01,
  20: 0.015,
  30: 0.02
};

const CLIFF_HOURS = 24;

function computeCliffHours(): number {
  return CLIFF_HOURS;
}

export class PricingService {
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    if (request.product === 'DEPEG_LP') {
      return this.quoteDepegLp(request);
    }

    return this.quoteAaveDlp(request);
  }

  private async quoteDepegLp(
    request: DepegLpQuoteRequest
  ): Promise<QuoteResponse> {
    const pool = await getContractGateway().getPoolById(request.poolId);

    const twap = pool?.metrics.twap ?? 1;
    const baseValueUSD = request.insuredLP * twap;
    const baseRate = TERM_BASE_RATE[request.termDays];

    const stressMultiplier = (() => {
      if (!pool) {
        return 1.1;
      }

      if (pool.state === 'Yellow') {
        return 1.25;
      }

      if (pool.state === 'Red') {
        return 1.4;
      }

      const reserveRatio = pool.metrics.reserveRatio ?? 1;
      return reserveRatio < 0.3 ? 1.35 : reserveRatio < 0.5 ? 1.2 : 1.0;
    })();

    const premiumUSD = Number(
      (baseValueUSD * baseRate * stressMultiplier).toFixed(2)
    );

    const coverageCapUSD = Number((baseValueUSD * 0.9).toFixed(2));

    return {
      product: request.product,
      premiumUSD,
      coverageCapUSD,
      deductibleBps: 500,
      cliffHours: computeCliffHours(),
      pricingBreakdown: {
        termRate: baseRate,
        stressMultiplier,
        baseValueUSD
      }
    };
  }

  private async quoteAaveDlp(
    request: AaveDlpQuoteRequest
  ): Promise<QuoteResponse> {
    const { params } = request;
    const baseRate = TERM_BASE_RATE[request.termDays];

    const riskMultiplier = (() => {
      const ltv = params.ltv ?? 0.7;
      const healthFactor = params.healthFactor ?? 1.2;

      const ltvStress = ltv > 0.7 ? 1 + (ltv - 0.7) * 1.5 : 1;
      const hfStress = healthFactor < 1.3 ? 1.2 : 1;
      return Number((ltvStress * hfStress).toFixed(3));
    })();

    const premiumUSD = Number(
      (params.insuredAmountUSD * baseRate * riskMultiplier).toFixed(2)
    );

    const coverageCapUSD = Number(
      (params.insuredAmountUSD * 0.1).toFixed(2)
    );

    return {
      product: request.product,
      premiumUSD,
      coverageCapUSD,
      deductibleBps: 500,
      cliffHours: computeCliffHours(),
      pricingBreakdown: {
        termRate: baseRate,
        riskMultiplier,
        insuredAmountUSD: params.insuredAmountUSD
      }
    };
  }
}

export const pricingService = new PricingService();
