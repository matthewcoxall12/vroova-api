import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function runPrisma(args) {
  const command = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runPrisma(['generate']);

if (process.env.POSTGRES_PRISMA_URL && process.env.POSTGRES_URL_NON_POOLING) {
  runPrisma(['migrate', 'deploy']);
} else {
  console.log('Skipping prisma migrate deploy: POSTGRES_PRISMA_URL or POSTGRES_URL_NON_POOLING is not set.');
}
