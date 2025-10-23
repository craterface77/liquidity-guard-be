export const POLICY_DISTRIBUTOR_ABI = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'quoteSigner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'buyPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'policyType', type: 'uint8' },
          { name: 'riskId', type: 'bytes32' },
          { name: 'insuredAmount', type: 'uint256' },
          { name: 'coverageCap', type: 'uint256' },
          { name: 'deductibleBps', type: 'uint32' },
          { name: 'startAt', type: 'uint64' },
          { name: 'activeAt', type: 'uint64' },
          { name: 'endAt', type: 'uint64' },
          { name: 'extraData', type: 'bytes' }
        ]
      },
      { name: 'premium', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [{ name: 'policyId', type: 'uint256' }]
  }
] as const;
