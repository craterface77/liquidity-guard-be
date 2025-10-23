import { Contract, JsonRpcProvider, Wallet, Interface, LogDescription } from 'ethers';

import { appConfig } from '../../core/env.js';
import { POLICY_NFT_ABI } from './abis/policy-nft.abi.js';
import { POLICY_DISTRIBUTOR_ABI } from './abis/policy-distributor.abi.js';
import { RESERVE_POOL_ABI } from './abis/reserve-pool.abi.js';
import { PAYOUT_MODULE_ABI } from './abis/payout-module.abi.js';
import { ORACLE_ANCHORS_ABI } from './oracle-anchors.abi.js';

const policyNftInterface = new Interface(POLICY_NFT_ABI);

export function getProvider(): JsonRpcProvider {
  if (!appConfig.RPC_URL) {
    throw new Error('RPC_URL is not configured.');
  }
  return new JsonRpcProvider(appConfig.RPC_URL);
}

export function getPolicyNftContract(): Contract {
  if (!appConfig.POLICY_NFT_ADDRESS) {
    throw new Error('POLICY_NFT_ADDRESS is not configured.');
  }
  return new Contract(appConfig.POLICY_NFT_ADDRESS, POLICY_NFT_ABI, getProvider());
}

export function getPolicyDistributorContract(signer?: Wallet): Contract {
  if (!appConfig.POLICY_DISTRIBUTOR_ADDRESS) {
    throw new Error('POLICY_DISTRIBUTOR_ADDRESS is not configured.');
  }
  const runner = signer ?? getProvider();
  return new Contract(appConfig.POLICY_DISTRIBUTOR_ADDRESS, POLICY_DISTRIBUTOR_ABI, runner);
}

export function getReservePoolContract(): Contract {
  if (!appConfig.RESERVE_POOL_ADDRESS) {
    throw new Error('RESERVE_POOL_ADDRESS is not configured.');
  }
  return new Contract(appConfig.RESERVE_POOL_ADDRESS, RESERVE_POOL_ABI, getProvider());
}

export function getPayoutModuleContract(): Contract {
  if (!appConfig.PAYOUT_MODULE_ADDRESS) {
    throw new Error('PAYOUT_MODULE_ADDRESS is not configured.');
  }
  return new Contract(appConfig.PAYOUT_MODULE_ADDRESS, PAYOUT_MODULE_ABI, getProvider());
}

export function getOracleAnchorsContract(signer?: Wallet): Contract {
  if (!appConfig.ORACLE_ANCHORS_ADDRESS) {
    throw new Error('ORACLE_ANCHORS_ADDRESS is not configured.');
  }
  const runner = signer ?? getProvider();
  return new Contract(appConfig.ORACLE_ANCHORS_ADDRESS, ORACLE_ANCHORS_ABI, runner);
}

export function createQuoteSigner(): Wallet {
  if (!appConfig.QUOTE_SIGNER_KEY) {
    throw new Error('QUOTE_SIGNER_KEY is not configured.');
  }
  return new Wallet(appConfig.QUOTE_SIGNER_KEY, getProvider());
}

export function createOracleSigner(): Wallet {
  if (!appConfig.ORACLE_SIGNER_KEY) {
    throw new Error('ORACLE_SIGNER_KEY is not configured.');
  }
  return new Wallet(appConfig.ORACLE_SIGNER_KEY, getProvider());
}

export async function extractPolicyMintedFromTx(txHash: string): Promise<{
  policyId: bigint;
  owner: string;
  policyType: number;
  riskId: string;
}> {
  const provider = getProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Transaction ${txHash} not found`);
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== appConfig.POLICY_NFT_ADDRESS?.toLowerCase()) {
      continue;
    }

    let parsed: LogDescription | null = null;
    try {
      parsed = policyNftInterface.parseLog(log);
    } catch {
      parsed = null;
    }

    if (parsed && parsed.name === 'PolicyMinted') {
      const { policyId, owner, policyType, riskId } = parsed.args as unknown as {
        policyId: bigint;
        owner: string;
        policyType: number;
        riskId: string;
      };

      return {
        policyId,
        owner,
        policyType,
        riskId
      };
    }
  }

  throw new Error('PolicyMinted event not found in transaction logs');
}
