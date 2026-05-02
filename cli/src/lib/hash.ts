import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Compute the SHA-256 hash of a file as a 0x-prefixed 32-byte hex string
 * suitable for submission as bytes32 to the PackageRegistry contract.
 */
export async function computeSHA256(filepath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filepath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve("0x" + hash.digest("hex")));
    stream.on("error", reject);
  });
}
