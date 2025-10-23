export const PAYOUT_MODULE_ABI = [
  {
    type: 'function',
    name: 'policyNonces',
    stateMutability: 'view',
    inputs: [{ name: 'policyId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;
