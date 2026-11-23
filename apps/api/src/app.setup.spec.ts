import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail } from 'class-validator';
import request from 'supertest';
import { configureApp } from './app.setup';
import { HealthController } from './modules/health/health.controller';
import { HealthService } from './modules/health/health.service';
import { PaginatedResult } from './common/http/paginated-result';

class EchoDto {
  @IsEmail()
  email!: string;
}

@Controller('probe')
class ProbeController {
  @Get('list')
  list() {
    return PaginatedResult.of([{ id: 1 }, { id: 2 }], 2, 1, 20);
  }
  @Post('echo')
  echo(@Body() body: EchoDto) {
    return body;
  }
  @Get('boom')
  boom() {
    throw new Error('secret internal detail');
  }
}

describe('HTTP stack (no external services)', () => {
  let app: INestApplication;
  const healthy = {
    status: 'ok',
    db: 'up',
    redis: 'up',
    queue: 'up',
    uptimeSeconds: 1,
    timestamp: 't',
  };
  const check = jest.fn();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [HealthController, ProbeController],
      providers: [{ provide: HealthService, useValue: { check } }],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app, { corsOrigins: ['http://localhost:3000'] });
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /api/health returns the success envelope when healthy', async () => {
    check.mockResolvedValueOnce(healthy);
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ success: true, data: healthy, message: 'OK' });
  });

  it('GET /api/health returns 503 with the error envelope when degraded', async () => {
    check.mockResolvedValueOnce({ ...healthy, status: 'degraded', db: 'down' });
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.details.db).toBe('down');
  });

  it('returns the paginated envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe/list').expect(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
  });

  it('returns VALIDATION_ERROR for an invalid body and for malformed JSON', async () => {
    const bad = await request(app.getHttpServer())
      .post('/api/probe/echo')
      .send({ email: 'x' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(bad.body.error.details[0].field).toBe('email');
    const malformed = await request(app.getHttpServer())
      .post('/api/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(malformed.body.success).toBe(false);
  });

  it('returns NOT_FOUND envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('hides internal error details', async () => {
    const res = await request(app.getHttpServer()).get('/api/probe/boom').expect(500);
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it('sets Helmet security headers and no x-powered-by', async () => {
    check.mockResolvedValueOnce(healthy);
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows listed CORS origins only', async () => {
    check.mockResolvedValue(healthy);
    const ok = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const blocked = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.info.title).toBe('MedCore HMS API');
    expect(res.body.paths['/api/health']).toBeDefined();
  });
});
