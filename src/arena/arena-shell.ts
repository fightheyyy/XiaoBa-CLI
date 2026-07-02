export interface BuildArenaShellCommandInput {
  cwd: string;
  command: string[];
  env: Record<string, string>;
  passThroughEnv: string[];
  sandboxProfilePath?: string;
}

export function buildArenaShellCommand(input: BuildArenaShellCommandInput): string {
  const env = input.sandboxProfilePath
    ? { ...input.env, XIAOBA_ARENA_SANDBOXED: '1' }
    : input.env;
  const envParts = Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${shellQuote(value)}`);
  for (const envName of input.passThroughEnv) {
    envParts.push(`${envName}="\${${envName}}"`);
  }
  const commandParts = input.command.map(shellQuote);
  const spawnCommand = ['env', '-i', ...envParts, ...commandParts].join(' ');
  const wrappedCommand = input.sandboxProfilePath
    ? ['sandbox-exec', '-f', shellQuote(input.sandboxProfilePath), spawnCommand].join(' ')
    : spawnCommand;
  return `cd ${shellQuote(input.cwd)} && ${wrappedCommand}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
