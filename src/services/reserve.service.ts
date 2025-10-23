import type { ReserveOverview } from '../domain/types.js';
import { getContractGateway } from '../integrations/contracts/contract-gateway.js';

export class ReserveService {
  async getOverview(): Promise<ReserveOverview> {
    return getContractGateway().getReserveOverview();
  }
}

export const reserveService = new ReserveService();
