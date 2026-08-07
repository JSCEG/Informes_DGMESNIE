export function parseArgs(argv = process.argv.slice(2)) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    if (inlineValue !== undefined) {
      result[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[rawKey] = next;
      index += 1;
    } else {
      result[rawKey] = true;
    }
  }
  return result;
}

export function requireArg(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Falta el argumento obligatorio --${name}.`);
  }
  return value.trim();
}
