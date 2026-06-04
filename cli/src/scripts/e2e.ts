/**
 * End-to-end integration test against a local Anvil node.
 *
 * Scenario:
 *  1. Expects PackageRegistry already deployed (address via env or --contract)
 *  2. Register package
 *  3. Create a ~50KB dummy tarball, publish version 1.0.0, verify MATCH
 *  4. Tamper with the tarball, verify MISMATCH
 *  5. Transfer ownership to a second account, old owner cannot publish
 *  6. New owner revokes 1.0.0, CLI verify rejects the revoked version
 *
 * Run with:  REGISTRY_PRIVATE_KEY=... ANVIL_REGISTRY_ADDRESS=... npm run e2e
 * Or pass key1 / key2 via env: ANVIL_KEY_0, ANVIL_KEY_1
 */
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from "ethers";
import { computeSHA256 } from "../lib/hash.js";
import { REGISTRY_ABI } from "../lib/contract.js";
import { verifyCommand } from "../commands/verify.js";

const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const ADDR = process.env.ANVIL_REGISTRY_ADDRESS;
if (!ADDR) {
  console.error("Set ANVIL_REGISTRY_ADDRESS to the deployed contract.");
  process.exit(2);
}

const KEY0 =
  process.env.ANVIL_KEY_0 ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY1 =
  process.env.ANVIL_KEY_1 ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exit(1);
  }
}

async function main() {
  const provider = new JsonRpcProvider(ANVIL_RPC);
  const alice = new Wallet(KEY0, provider);
  const bob = new Wallet(KEY1, provider);
  const abi = REGISTRY_ABI as InterfaceAbi;
  const registryAlice = new Contract(ADDR!, abi, alice);
  const registryBob = new Contract(ADDR!, abi, bob);

  const NAME = `test-pkg-${Date.now()}`;
  const V1 = "1.0.0";
  process.env.REGISTRY_PRIVATE_KEY ??= KEY0;

  console.log(`[e2e] Using registry ${ADDR}`);
  console.log(`[e2e] Alice: ${await alice.getAddress()}`);
  console.log(`[e2e] Bob:   ${await bob.getAddress()}`);

  async function send(
    signer: Wallet,
    fn: (nonce: number) => Promise<{ hash: string; wait: () => Promise<unknown> }>,
  ) {
    await new Promise((r) => setTimeout(r, 50));
    const nonce = await provider.send("eth_getTransactionCount", [await signer.getAddress(), "latest"]).then((n: string) => parseInt(n, 16));
    const tx = await fn(nonce);
    await tx.wait();
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`[e2e] 1) registerPackage(${NAME})`);
  await send(alice, (nonce) => registryAlice.registerPackage(NAME, { nonce }));

  console.log("[e2e] 2) creating 50KB dummy tarball");
  const dir = mkdtempSync(join(tmpdir(), "reg-e2e-"));
  const tarballPath = join(dir, "artifact.tgz");
  const content = Buffer.alloc(50 * 1024);
  for (let i = 0; i < content.length; i++) content[i] = i & 0xff;
  writeFileSync(tarballPath, content);
  const hash = await computeSHA256(tarballPath);
  console.log(`    sha256 = ${hash}`);

  console.log(`[e2e] 3) publishVersion(${NAME}, ${V1})`);
  await send(alice, (nonce) => registryAlice.publishVersion(NAME, V1, hash, { nonce }));

  console.log("[e2e] 4) verify MATCH");
  const [h1, , , revoked1] = await registryAlice.verifyVersion(NAME, V1);
  assert(h1.toLowerCase() === hash.toLowerCase(), "on-chain hash should match local");
  assert(!revoked1, "should not yet be revoked");
  const matchExit = await verifyCommand(NAME, V1, tarballPath, {
    network: "anvil",
    contract: ADDR,
    rpcUrl: ANVIL_RPC,
  });
  assert(matchExit === 0, "CLI verify should exit 0 for a matching active record");

  console.log("[e2e] 5) tamper + verify MISMATCH");
  const tampered = Buffer.from(readFileSync(tarballPath));
  tampered[0] ^= 0xff;
  const tamperedPath = join(dir, "tampered.tgz");
  writeFileSync(tamperedPath, tampered);
  const tHash = await computeSHA256(tamperedPath);
  assert(tHash !== hash, "tampered hash should differ");
  const [h2] = await registryAlice.verifyVersion(NAME, V1);
  assert(h2.toLowerCase() !== tHash.toLowerCase(), "tampered file should not match on-chain");
  const mismatchExit = await verifyCommand(NAME, V1, tamperedPath, {
    network: "anvil",
    contract: ADDR,
    rpcUrl: ANVIL_RPC,
  });
  assert(mismatchExit === 1, "CLI verify should exit 1 for a mismatching record");
  console.log(`    tampered = ${tHash}`);
  console.log(`    on-chain = ${h2}`);

  console.log("[e2e] 6) transferOwnership(Alice -> Bob)");
  await send(alice, (nonce) =>
    registryAlice.transferOwnership(NAME, bob.address, { nonce }),
  );

  console.log("[e2e] 7) Alice can no longer publish (expect revert)");
  let reverted = false;
  try {
    const nonce = await provider.getTransactionCount(alice.address, "latest");
    const tx = await registryAlice.publishVersion(NAME, "1.0.1", hash, { nonce });
    await tx.wait();
  } catch {
    reverted = true;
  }
  assert(reverted, "old owner should not be able to publish");

  console.log("[e2e] 8) revokeVersion by new owner");
  await send(bob, (nonce) => registryBob.revokeVersion(NAME, V1, { nonce }));

  console.log("[e2e] 9) verify shows revoked=true");
  const [, , , revoked2] = await registryBob.verifyVersion(NAME, V1);
  assert(revoked2, "should be revoked");
  const revokedExit = await verifyCommand(NAME, V1, tarballPath, {
    network: "anvil",
    contract: ADDR,
    rpcUrl: ANVIL_RPC,
  });
  assert(revokedExit === 1, "CLI verify should exit 1 for a revoked record even when hashes match");

  console.log("[e2e] PASS");
}

main().catch((err) => {
  console.error("[e2e] FAIL:", err);
  process.exit(1);
});
