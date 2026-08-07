import path from 'node:path';
import { parseArgs, requireArg } from './lib/args.mjs';
import { assertValidContract, contentHash, loadContract, loadPolicy, releaseId } from './lib/contract.mjs';

try {
  const args = parseArgs();
  const input = path.resolve(requireArg(args, 'input'));
  const { contract, raw } = await loadContract(input);
  const policy = await loadPolicy();
  assertValidContract(contract, policy, { mode: 'publish', raw });
  console.log(JSON.stringify({ status: 'valid', release_id: releaseId(contract), content_sha256: contentHash(contract) }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
