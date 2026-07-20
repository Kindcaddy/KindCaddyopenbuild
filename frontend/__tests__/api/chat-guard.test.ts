import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';

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

const mockHostChat = jest.fn();

async function loadRoute() {
  jest.resetModules();
  mockHostChat.mockReset().mockResolvedValue({
    sessionId: 's_test',
    assistantMessageId: 'm_test',
    agent: 'hermes',
    reply: 'ok',
    trace: [],
  });

  jest.doMock('next/headers', () => ({ cookies: jest.fn(() => mockCookies) }));
  jest.doMock('@/lib/host/host', () => ({
    host: { chat: mockHostChat },
  }));

  return import('@/app/api/mcp/chat/route');
}

describe('/api/mcp/chat guardrails', () => {
  let userId: string;
  let tenantId: string;
  let departmentId: string;

  beforeAll(async () => {
    await db.auditEvent.deleteMany();
    await db.membership.deleteMany();
    await db.department.deleteMany();
    await db.user.deleteMany();
    await db.tenant.deleteMany();

    const tenant = await db.tenant.create({ data: { name: 'Chat Guard Tenant' } });
    tenantId = tenant.id;
    const dept = await db.department.create({
      data: { tenantId: tenant.id, name: 'Engineering' },
    });
    departmentId = dept.id;
    const user = await db.user.create({
      data: { email: 'chat-guard@example.com', name: 'Guard Tester' },
    });
    userId = user.id;
    await db.membership.create({
      data: {
        userId,
        tenantId,
        departmentId,
        role: 'admin',
      },
    });
  });

  afterAll(async () => {
    await db.auditEvent.deleteMany();
    await db.membership.deleteMany();
    await db.department.deleteMany();
    await db.user.deleteMany();
    await db.tenant.deleteMany();
    await db.$disconnect();
  });

  beforeEach(() => {
    mockCookies.get.mockReturnValue({ value: `${userId}:${tenantId}` });
    (cookies as jest.Mock).mockReturnValue(mockCookies);
  });

  it('rejects cross-origin POST requests with csrf_origin_mismatch', async () => {
    const { POST } = await loadRoute();
    const request = new NextRequest('http://localhost:3000/api/mcp/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ message: 'hello' }),
    });

    const response = await POST(request);
    const data = await response.json();
    expect(response.status).toBe(403);
    expect(data.error).toBe('csrf_origin_mismatch');
    expect(mockHostChat).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After after exhausting the chat-turn limiter', async () => {
    const { POST } = await loadRoute();
    const headers = {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    };

    for (let i = 0; i < 10; i += 1) {
      const request = new NextRequest('http://localhost:3000/api/mcp/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: `hello-${i}` }),
      });
      const response = await POST(request);
      expect(response.status).toBe(200);
    }

    const request = new NextRequest('http://localhost:3000/api/mcp/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello-11' }),
    });
    const response = await POST(request);
    const data = await response.json();
    expect(response.status).toBe(429);
    expect(data.error).toBe('rate_limited');
    expect(response.headers.get('retry-after')).toBeTruthy();
  });

  it('maps Hermes unreachable errors to a 503 assistant_unavailable', async () => {
    const { POST } = await loadRoute();
    const { HermesUnreachableError } = await import('@/lib/agents/hermes');
    mockHostChat.mockImplementationOnce(() => {
      throw new HermesUnreachableError('down');
    });

    const request = new NextRequest('http://localhost:3000/api/mcp/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    const response = await POST(request);
    const data = await response.json();
    expect(response.status).toBe(503);
    expect(data.error).toBe('assistant_unavailable');
  });
});
