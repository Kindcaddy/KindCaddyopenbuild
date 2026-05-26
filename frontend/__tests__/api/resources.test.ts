import { GET, POST } from '@/app/api/resources/route';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

// Mock next/headers
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

// Mock the cookies module
const mockCookies = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  has: jest.fn(),
  getAll: jest.fn(),
  toString: jest.fn(),
};

describe('/api/resources', () => {
  let tenant1Id: string;
  let tenant2Id: string;
  let user1Id: string; // Alice - admin in tenant1 and tenant2
  let user2Id: string; // Bob - employee in tenant1 and tenant2
  let user3Id: string; // Charlie - employee in tenant1
  let dept1Id: string;
  let dept2Id: string;

  beforeAll(async () => {
    // Seed test data
    await db.auditEvent.deleteMany();
    await db.resource.deleteMany();
    await db.membership.deleteMany();
    await db.department.deleteMany();
    await db.user.deleteMany();
    await db.tenant.deleteMany();

    // Create tenants
    const tenant1 = await db.tenant.create({ data: { name: 'Test Tenant 1' } });
    const tenant2 = await db.tenant.create({ data: { name: 'Test Tenant 2' } });
    tenant1Id = tenant1.id;
    tenant2Id = tenant2.id;

    // Create users
    const user1 = await db.user.create({
      data: { email: 'test-alice@example.com', name: 'Alice Test' },
    });
    const user2 = await db.user.create({
      data: { email: 'test-bob@example.com', name: 'Bob Test' },
    });
    const user3 = await db.user.create({
      data: { email: 'test-charlie@example.com', name: 'Charlie Test' },
    });
    user1Id = user1.id;
    user2Id = user2.id;
    user3Id = user3.id;

    // Create departments
    const dept1 = await db.department.create({
      data: { tenantId: tenant1Id, name: 'Engineering' },
    });
    const dept2 = await db.department.create({
      data: { tenantId: tenant2Id, name: 'Engineering' },
    });
    dept1Id = dept1.id;
    dept2Id = dept2.id;

    // Create memberships
    await db.membership.create({
      data: {
        userId: user1Id,
        tenantId: tenant1Id,
        departmentId: dept1Id,
        role: 'admin',
      },
    });
    await db.membership.create({
      data: {
        userId: user1Id,
        tenantId: tenant2Id,
        departmentId: dept2Id,
        role: 'admin',
      },
    });
    await db.membership.create({
      data: {
        userId: user2Id,
        tenantId: tenant1Id,
        departmentId: dept1Id,
        role: 'employee',
      },
    });
    await db.membership.create({
      data: {
        userId: user2Id,
        tenantId: tenant2Id,
        departmentId: dept2Id,
        role: 'employee',
      },
    });
    await db.membership.create({
      data: {
        userId: user3Id,
        tenantId: tenant1Id,
        departmentId: dept1Id,
        role: 'employee',
      },
    });

    // Create test resources
    await db.resource.create({
      data: {
        name: 'Tenant 1 Resource',
        data: JSON.stringify({ test: 'data1' }),
        tenantId: tenant1Id,
        departmentId: dept1Id,
        createdBy: user1Id,
      },
    });
    await db.resource.create({
      data: {
        name: 'Tenant 2 Resource',
        data: JSON.stringify({ test: 'data2' }),
        tenantId: tenant2Id,
        departmentId: dept2Id,
        createdBy: user1Id,
      },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('Cross-tenant isolation', () => {
    it('should not allow user from Tenant 1 to see Tenant 2 resources', async () => {
      // Mock cookies to simulate user1 logged into tenant1
      mockCookies.get.mockReturnValue({ value: `${user1Id}:${tenant1Id}` });
      (cookies as jest.Mock).mockReturnValue(mockCookies);

      const request = new NextRequest('http://localhost:3000/api/resources', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resources).toHaveLength(1);
      expect(data.resources[0].name).toBe('Tenant 1 Resource');
      expect(data.resources[0].data.test).toBe('data1');
    });

    it('should allow user from Tenant 2 to see only Tenant 2 resources', async () => {
      // Mock cookies to simulate user1 logged into tenant2
      mockCookies.get.mockReturnValue({ value: `${user1Id}:${tenant2Id}` });
      (cookies as jest.Mock).mockReturnValue(mockCookies);

      const request = new NextRequest('http://localhost:3000/api/resources', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resources).toHaveLength(1);
      expect(data.resources[0].name).toBe('Tenant 2 Resource');
      expect(data.resources[0].data.test).toBe('data2');
    });
  });

  describe('Employee forbidden from writes', () => {
    it('should return 403 when employee tries to create a resource', async () => {
      // Mock cookies to simulate user3 (employee) logged into tenant1
      mockCookies.get.mockReturnValue({ value: `${user3Id}:${tenant1Id}` });
      (cookies as jest.Mock).mockReturnValue(mockCookies);

      const request = new NextRequest('http://localhost:3000/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Resource',
          data: { test: 'value' },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('Forbidden');
    });

    it('should allow employee to read resources', async () => {
      // Mock cookies to simulate user3 (employee) logged into tenant1
      mockCookies.get.mockReturnValue({ value: `${user3Id}:${tenant1Id}` });
      (cookies as jest.Mock).mockReturnValue(mockCookies);

      const request = new NextRequest('http://localhost:3000/api/resources', {
        method: 'GET',
      });

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resources).toBeDefined();
    });
  });
});
