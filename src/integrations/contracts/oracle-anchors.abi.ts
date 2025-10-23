export const ORACLE_ANCHORS_ABI = [
  {
    type: 'function',
    name: 'anchorDepegStart',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'twapE18', type: 'uint192' },
      { name: 'snapshotCid', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'anchorDepegEnd',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'twapE18', type: 'uint192' },
      { name: 'snapshotCid', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'anchorDepegLiquidation',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'riskId', type: 'bytes32' },
      { name: 'liquidationId', type: 'bytes32' },
      { name: 'user', type: 'address' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'twapE18', type: 'uint192' },
      { name: 'hfBeforeE4', type: 'uint64' },
      { name: 'hfAfterE4', type: 'uint64' },
      { name: 'snapshotCid', type: 'bytes32' }
    ],
    outputs: []
  }
] as const;
