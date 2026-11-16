import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

/** bcrypt cost factor 12 (AUTH-011, SEC-001). */
export const BCRYPT_COST = 12;

@Injectable()
export class PasswordService {
  /** Hash of a random value, compared against when the email is unknown so timing does not reveal accounts. */
  private dummy?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, BCRYPT_COST);
  }

  verify(password: string, passwordHash: string | null | undefined): Promise<boolean> {
    if (!passwordHash) {
      this.dummy ??= hash('medcore-timing-equaliser', BCRYPT_COST);
      return this.dummy.then((h) => compare(password, h)).then(() => false);
    }
    return compare(password, passwordHash);
  }
}
