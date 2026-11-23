import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Column encryption for clinical text (SEC-014, EMR-012, DEC-024). Values are encrypted by
 * PostgreSQL's pgcrypto (`pgp_sym_encrypt`, AES-256) with a key that lives only in the API's
 * environment. The two helpers below are the only raw SQL in the codebase besides the health
 * probe: both are tagged templates (bound parameters), never string-built, and they touch no
 * table, so tenant scoping does not apply. Batches keep a request to one round trip.
 */
export interface FieldCrypto {
  encrypt(values: readonly string[]): Promise<Uint8Array<ArrayBuffer>[]>;
  decrypt(values: readonly Uint8Array[]): Promise<string[]>;
}
export const FIELD_CRYPTO = Symbol('FIELD_CRYPTO');

@Injectable()
export class PgcryptoFieldCrypto implements FieldCrypto {
  private readonly key: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.key = config.get('EMR_ENCRYPTION_KEY', { infer: true });
  }

  async encrypt(values: readonly string[]): Promise<Uint8Array<ArrayBuffer>[]> {
    if (values.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ i: bigint; v: Uint8Array }[]>`
      SELECT o.i, pgp_sym_encrypt(o.t, ${this.key}, 'cipher-algo=aes256') AS v
      FROM unnest(${[...values]}::text[]) WITH ORDINALITY AS o(t, i)
      ORDER BY o.i`;
    return rows.map((r) => new Uint8Array(r.v));
  }

  async decrypt(values: readonly Uint8Array[]): Promise<string[]> {
    if (values.length === 0) return [];
    const hex = values.map((v) => Buffer.from(v).toString('hex'));
    const rows = await this.prisma.$queryRaw<{ i: bigint; t: string }[]>`
      SELECT o.i, pgp_sym_decrypt(decode(o.h, 'hex'), ${this.key}) AS t
      FROM unnest(${hex}::text[]) WITH ORDINALITY AS o(h, i)
      ORDER BY o.i`;
    return rows.map((r) => r.t);
  }
}

@Global()
@Module({
  providers: [{ provide: FIELD_CRYPTO, useClass: PgcryptoFieldCrypto }],
  exports: [FIELD_CRYPTO],
})
export class FieldCryptoModule {}
