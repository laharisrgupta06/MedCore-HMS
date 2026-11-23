/**
 * Creates the first Super Admin (DEC-013). There is no public endpoint for this.
 *   pnpm --filter @medcore/api create-super-admin
 * Prompts for email, name and password (hidden). The password is never accepted as an argument.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { checkPassword } from '@medcore/types';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { BCRYPT_COST } from '../modules/auth/password.service';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SuperAdminInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

/** Validates input; returns an error message or null. Exported for tests. */
export function validateSuperAdmin(i: SuperAdminInput): string | null {
  if (!EMAIL.test(i.email)) return 'Enter a valid email address.';
  if (!i.firstName.trim() || !i.lastName.trim()) return 'First and last name are required.';
  return checkPassword(i.password, i.email);
}

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function main(): Promise<void> {
  const email = (await ask('Super Admin email: ')).trim().toLowerCase();
  const firstName = (await ask('First name: ')).trim();
  const lastName = (await ask('Last name: ')).trim();
  const password = await ask('Password (hidden): ', true);
  const confirm = await ask('Confirm password (hidden): ', true);
  if (password !== confirm) throw new Error('Passwords do not match.');
  const problem = validateSuperAdmin({ email, firstName, lastName, password });
  if (problem) throw new Error(problem);

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new Error('A user with this email already exists.');
    }
    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        role: 'SUPER_ADMIN',
        hospitalId: null,
        passwordHash: await hash(password, BCRYPT_COST),
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'auth.super_admin_created',
        entityType: 'User',
        entityId: user.id,
        actorId: user.id,
      },
    });
    process.stdout.write(`Super Admin created: ${user.email}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
  });
}
