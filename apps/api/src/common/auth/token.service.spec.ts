import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

const config = {
  get: (k: string) =>
    ({ JWT_ACCESS_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64) })[k],
} as unknown as ConfigService<never, true>;

describe('TokenService', () => {
  const tokens = new TokenService(new JwtService({}), config);
  const access = { sub: 'u1', sid: 's1', role: 'DOCTOR' as const, hid: 'h1' };

  it('round-trips access and refresh tokens', async () => {
    expect(await tokens.verifyAccess(await tokens.signAccess(access))).toMatchObject({
      ...access,
      typ: 'access',
    });
    const r = await tokens.verifyRefresh(
      await tokens.signRefresh({ sub: 'u1', sid: 's1', jti: 'j1' }),
    );
    expect(r).toMatchObject({ sub: 'u1', sid: 's1', jti: 'j1', typ: 'refresh' });
  });

  it('never accepts a refresh token as an access token or the reverse', async () => {
    const refresh = await tokens.signRefresh({ sub: 'u1', sid: 's1', jti: 'j1' });
    expect(await tokens.verifyAccess(refresh)).toBeNull();
    expect(await tokens.verifyRefresh(await tokens.signAccess(access))).toBeNull();
  });

  it('rejects tampered, foreign-secret and unsigned tokens', async () => {
    const t = await tokens.signAccess(access);
    const [h, p] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...access, role: 'SUPER_ADMIN', typ: 'access' }),
    ).toString('base64url');
    expect(await tokens.verifyAccess(`${h}.${forged}.${t.split('.')[2]}`)).toBeNull();
    const other = await new JwtService({}).signAsync(
      { ...access, typ: 'access' },
      { secret: 'c'.repeat(64) },
    );
    expect(await tokens.verifyAccess(other)).toBeNull();
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    expect(await tokens.verifyAccess(none)).toBeNull();
  });
});
