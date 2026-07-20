/**
 * Phase 0 acceptance tests (PRODUCTION-PLAN.md):
 *  - an unexpected error inside a guarded route returns an opaque 500 with a
 *    requestId, and a matching ErrorReport row is persisted;
 *  - an expected AppError maps to its status with NO ErrorReport;
 *  - resolving a report requires a note and writes an AuditEvent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { withGuard } from '@/lib/guard';
import { AppError, reportError } from '@/lib/errors';
import { db } from '@/lib/db';
import { PATCH } from '@/app/api/admin/errors/[id]/route';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

const mockCookies = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
  getAll: jest.fn(),
  toString: jest.fn(),
};

describe('Phase 0 error handling seam', () => {
  let userId: string;
  let tenantId: string;

  beforeAll(async () => {
    const tenant = await db.tenant.create({ data: { name: 'Err Test Tenant' } });
    const user = await db.user.create({
      data: { email: 'err-admin@example.com', name: 'Err Admin' },
    });
    const dept = await db.department.create({
      data: { tenantId: tenant.id, name: 'Executive' },
    });
    await db.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        departmentId: dept.id,
        role: 'admin',
      },
    });
    userId = user.id;
    tenantId = tenant.id;
  });

  beforeEach(() => {
    mockCookies.get.mockReturnValue({ value: `${userId}:${tenantId}` });
    (cookies as jest.Mock).mockReturnValue(mockCookies);
  });

  afterAll(async () => {
    await db.errorReport.deleteMany({ where: { tenantId } });
    await db.auditEvent.deleteMany({ where: { tenantId } });
    await db.membership.deleteMany({ where: { tenantId } });
    await db.department.deleteMany({ where: { tenantId } });
    await db.tenant.delete({ where: { id: tenantId } });
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });

  it('unexpected error -> opaque 500 + persisted ErrorReport with matching requestId', async () => {
    const handler = withGuard(async () => {
      throw new Error('secret stack detail that must not leak');
    });
    const res = await handler(
      new NextRequest('http://localhost:3000/api/test-boom', { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('internal');
    expect(body.message).toBeUndefined();
    expect(typeof body.requestId).toBe('string');
    expect(res.headers.get('x-request-id')).toBe(body.requestId);

    const report = await db.errorReport.findFirst({
      where: { requestId: body.requestId },
    });
    expect(report).not.toBeNull();
    expect(report!.status).toBe('open');
    expect(report!.route).toBe('POST /api/test-boom');
    expect(report!.userId).toBe(userId);
    expect(report!.tenantId).toBe(tenantId);
    expect(report!.message).toContain('secret stack detail');
  });

  it('AppError -> mapped status, no ErrorReport row', async () => {
    const before = await db.errorReport.count();
    const handler = withGuard(async () => {
      throw new AppError('teapot', 'short and stout', 418);
    });
    const res = await handler(
      new NextRequest('http://localhost:3000/api/test-teapot', { method: 'GET' }),
    );
    const body = await res.json();

    expect(res.status).toBe(418);
    expect(body.error).toBe('teapot');
    expect(body.message).toBe('short and stout');
    expect(res.headers.get('x-request-id')).toBe(body.requestId);
    expect(await db.errorReport.count()).toBe(before);
  });

  it('successful responses also carry x-request-id', async () => {
    const handler = withGuard(async () => NextResponse.json({ ok: true }));
    const res = await handler(
      new NextRequest('http://localhost:3000/api/test-ok', { method: 'GET' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('resolve requires a note; resolving writes an AuditEvent', async () => {
    const { id } = (await reportError(new Error('flaky tool'), {
      requestId: 'req-test-resolve',
      route: 'mcp.invoke',
      code: 'mcp_tool_error',
      userId,
      tenantId,
    })) as { id: string };
    expect(id).toBeTruthy();

    const noNote = await PATCH(
      new NextRequest(`http://localhost:3000/api/admin/errors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'resolve' }),
      }),
      { params: { id } },
    );
    expect(noNote.status).toBe(400);

    const resolved = await PATCH(
      new NextRequest(`http://localhost:3000/api/admin/errors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'resolve', resolution: 'fixed the flake' }),
      }),
      { params: { id } },
    );
    const body = await resolved.json();
    expect(resolved.status).toBe(200);
    expect(body.status).toBe('resolved');
    expect(body.resolvedBy).toBe(userId);
    expect(body.resolution).toBe('fixed the flake');

    const audit = await db.auditEvent.findFirst({
      where: { action: 'error.resolved', resourceId: id },
    });
    expect(audit).not.toBeNull();
  });
});
