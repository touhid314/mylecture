import { createInterface } from 'node:readline';

export async function confirm(message: string, autoYes = false) {
  if (autoYes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
