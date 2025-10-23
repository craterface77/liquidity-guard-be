import type {
  AnchorPayload,
  WhitelistRequest
} from '../domain/types.js';
import { getContractGateway } from '../integrations/contracts/contract-gateway.js';
import { badRequest } from '../core/errors.js';

export class AdminService {
  async publishAnchor(request: AnchorPayload): Promise<{ status: string }> {
    try {
      await getContractGateway().publishAnchor(request);
      return {
        status: `anchor-${request.type.toLowerCase()}-queued`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to publish anchor';
      throw badRequest('ANCHOR_PUBLISH_FAILED', message);
    }
  }

  async updateWhitelist(
    request: WhitelistRequest
  ): Promise<{ status: string }> {
    try {
      await getContractGateway().recordWhitelistChange(request);
      return {
        status: `whitelist-${request.action.toLowerCase()}-accepted`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update whitelist';
      throw badRequest('WHITELIST_UPDATE_FAILED', message);
    }
  }
}

export const adminService = new AdminService();
