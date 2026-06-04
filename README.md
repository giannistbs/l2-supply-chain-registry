# L2 Package Integrity Registry

[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity&logoColor=white)](https://soliditylang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

A minimal package integrity registry built on Ethereum Layer 2. Maintainers
register `(package_name, version) -> SHA-256 hash` bindings on-chain; clients
verify any downloaded artifact by hashing it locally and comparing against
the on-chain record.

## Architecture

Three layers, separated by responsibility:

| Layer       | Responsibility                                               | Implementation                              |
| ----------- | ------------------------------------------------------------ | ------------------------------------------- |
| Storage     | Hosts package binaries (publisher-managed)                   | Off-chain: CDN, GitHub Releases, S3, etc.   |
| Integrity   | Maps `(package, version)` to `(contentHash, owner, timestamp, revoked)` | `PackageRegistry.sol` on an L2          |
| Identity    | Authenticates maintainers                                    | `did:ethr` (`msg.sender` is the DID subject) |

The contract is **storage-agnostic**: it never stores artifacts, only their
SHA-256 digests. Anyone holding the artifact can independently verify its
integrity against the on-chain hash.

## Live Testing Deployment

A `PackageRegistry` instance is deployed on Base mainnet at
[`0x6ff7a812958fcf17d44069280ef4f21db1ef92ff`](https://basescan.org/address/0x6ff7a812958fcf17d44069280ef4f21db1ef92ff#code).
This deployment is for testing and evaluation purposes.

## Repository Layout

```
contracts/    Foundry project (Solidity 0.8.24)
  src/        PackageRegistry.sol, interfaces/
  test/       Foundry unit tests
  script/     Deployment script
cli/          TypeScript CLI (ethers v6, commander)
  src/        Commands: register, publish, verify, transfer, revoke
bench/        TypeScript benchmark harness for gas + latency measurements
docs/         Developer-facing notes (architecture, threat-model working doc)
```

## Build and Demo

### Requirements

- [Foundry](https://book.getfoundry.sh/) (`forge`, `anvil`, `cast`)
- Node.js 20+ and `npm`

### Compile and test the contracts

```bash
cd contracts
forge build
forge test
```

### Build the CLI

```bash
cd cli
npm install
npm run build
```

### End-to-end demo against local Anvil

In one terminal:

```bash
anvil
```

In another, deploy the registry to the local node:

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url anvil --broadcast
```

Then exercise the full flow with the CLI:

```bash
cd cli

# Register a package, publish a version, then verify it
node dist/index.js register   my-package                        --network anvil
node dist/index.js publish    my-package 1.0.0 ./artifact.tgz   --network anvil
node dist/index.js verify     my-package 1.0.0 ./artifact.tgz   --network anvil
```

`verify` exits with code `0` on hash match and `1` on mismatch, so it can be
wired into CI.

## Benchmarks

The `bench/` directory contains the harnesses used for empirical measurement:

- Registry gas and modeled USD cost across Base, Scroll, and Arbitrum One,
  measured against a local Anvil instance with live mainnet fee oracles
  supplying the L1 and L2 fee components.
- Latency comparisons against the public Sigstore/Rekor API and the npm
  registry API.

Run scripts and configuration live under `bench/`; the methodology and
results are described in the accompanying thesis.

## License

MIT. See SPDX headers in source files.
