# Architecture

## Overview

The system is a three-layer package integrity registry:

| Layer       | Responsibility                                               | Implementation                     |
| ----------- | ------------------------------------------------------------ | ---------------------------------- |
| Storage     | Hosts package binaries (publisher-managed)                   | CDN, GitHub Releases, S3, etc. (off-chain) |
| Integrity   | Maps `(package, version)` → `(contentHash, owner, timestamp, revoked)` | `PackageRegistry.sol` on an L2     |
| Identity    | Authenticates maintainers                                    | `DIDAuth.sol` (did:ethr opt-in)    |

The contract is **storage-agnostic**: it never stores artifacts, only their
SHA-256 digests. Anyone holding the artifact can independently verify its
integrity against the on-chain hash.

## Smart Contracts

### `PackageRegistry.sol`

Core data:

```solidity
struct Version { bytes32 contentHash; uint256 timestamp; bool revoked; }
struct Package {
    address owner;
    bool exists;
    mapping(string => Version) versions;
    string[] versionList;
}
mapping(string => Package) internal _packages;
```

Functions:

| Function                                          | Caller constraint                   | State changes                                               |
| ------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `registerPackage(name)`                           | Must be registered maintainer       | Creates package, sets `msg.sender` as owner                 |
| `publishVersion(name, version, contentHash)`      | Registered maintainer AND owner     | Stores hash + timestamp, appends to version list            |
| `verifyVersion(name, version)` (view)             | Anyone                              | Returns hash, owner, timestamp, revoked                     |
| `transferOwnership(name, newOwner)`               | Current owner                       | Changes `owner`                                              |
| `revokeVersion(name, version)`                    | Current owner                       | Sets `revoked = true`                                       |

Every state change emits an event; clients can index events instead of
repeatedly reading storage.


- Package names and versions are `string` for realism, not `bytes32`. Higher
  gas cost is accepted in exchange for readable identifiers matching npm
  conventions.
- Hashes are computed off-chain and submitted as `bytes32`. No on-chain hashing.
- Names are not validated (typosquatting prevention is out of scope).
- No upgradeability. If the contract needs changes, a new deployment is made.

### `DIDAuth.sol`

did:ethr identities are Ethereum addresses, so `msg.sender` is the DID subject.
`DIDAuth` adds a lightweight opt-in layer: maintainers self-register via
`registerMaintainer()`, and the `onlyRegisteredMaintainer` modifier gates
`registerPackage` and `publishVersion`. This provides a clear, inspectable
list of who has asserted they are a maintainer.

A stretch goal is delegate support via the deployed `EthereumDIDRegistry` at
`0xdCa7EF03e98e0DC2B855bE647C39ABe984fcF21B`, letting a maintainer authorize
secondary signing keys without transferring ownership.

## CLI

The TypeScript CLI (`cli/`) wraps all contract interactions:

```
registry register  <name>                       --network <n>
registry publish   <name> <version> <filepath>  --network <n>
registry verify    <name> <version> <filepath>  --network <n>
registry transfer  <name> <new-owner>           --network <n>
registry revoke    <name> <version>             --network <n>
```

`verify` computes the local SHA-256, fetches the on-chain hash, and prints
`MATCH` or `MISMATCH`. Exit code is 0 on match, 1 on mismatch.

## Benchmarking

Three harnesses under `bench/src/`:

| Harness              | Target                                          | Metric                                      |
| -------------------- | ----------------------------------------------- | ------------------------------------------- |
| `bench-registry.ts`  | Local Anvil execution + L2 mainnet fee oracles  | gas, L1/L2 fee components, modeled USD cost |
| `bench-sigstore.ts`  | `https://rekor.sigstore.dev` public API         | latency for log info, index lookup, entry   |
| `bench-npm.ts`       | `https://registry.npmjs.org`                    | latency for metadata, version, tarball+hash |

`analysis.ts` aggregates all JSON outputs into `summary-ops.csv` (with
mean/median/p95/p99 per metric) and `projections.csv` (USD cost at ecosystem
scales). `run-all.ts` orchestrates them with separate sample counts for
registry cost modeling and external latency benchmarks.

## Networks

Cost-model target L2s:

| Network             | Architecture        | Chain ID |
| ------------------- | ------------------- | -------- |
| Base Mainnet        | Optimistic (OP)     | 8453     |
| Scroll Mainnet      | ZK-rollup           | 534352   |
| Arbitrum One        | Optimistic (Nitro)  | 42161    |

The registry contract is deployed only to local Anvil for measurement. Anvil
provides deterministic `gasUsed`; live mainnet RPCs provide `eth_gasPrice` and
L1 data fee estimates via each L2's oracle or estimator. The testnet deployment
script remains optional tooling for demonstrations, but it is not part of the
thesis cost-measurement methodology.

## Repository Layout

```
contracts/    Foundry project (Solidity 0.8.24)
cli/          TypeScript CLI (ethers v6, commander)
bench/        TypeScript benchmark harness + results/
docs/         Thesis-reference docs (this file, THREAT_MODEL.md)
```
