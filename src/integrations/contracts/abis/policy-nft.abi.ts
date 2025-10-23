export const POLICY_NFT_ABI = [
  {
    type: 'function',
    name: 'policyData',
    stateMutability: 'view',
    inputs: [{ name: 'policyId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'policyType', type: 'uint8' },
          { name: 'riskId', type: 'bytes32' },
          { name: 'insuredAmount', type: 'uint128' },
          { name: 'coverageCap', type: 'uint128' },
          { name: 'deductibleBps', type: 'uint32' },
          { name: 'startAt', type: 'uint64' },
          { name: 'activeAt', type: 'uint64' },
          { name: 'endAt', type: 'uint64' },
          { name: 'claimedUpTo', type: 'uint64' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'dlpPolicyData',
    stateMutability: 'view',
    inputs: [{ name: 'policyId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint32' },
          { name: 'aavePool', type: 'address' },
          { name: 'collateralAsset', type: 'address' },
          { name: 'coverageRatioBps', type: 'uint16' },
          { name: 'maxPayoutBps', type: 'uint16' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'event',
    name: 'PolicyMinted',
    inputs: [
      { name: 'policyId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'policyType', type: 'uint8', indexed: true },
      { name: 'riskId', type: 'bytes32', indexed: false }
    ],
    anonymous: false
  }
] as const;
