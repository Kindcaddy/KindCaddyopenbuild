import { NextRequest, NextResponse } from 'next/server';
import { withGuard } from '@/lib/guard';
import { AppError } from '@/lib/errors';
import { db } from '@/lib/db';
import { Permission } from '@/lib/rbac';

// GET /api/resources - List resources scoped to tenant + department
export const GET = withGuard(
  async (req: NextRequest, context) => {
    const resources = await db.resource.findMany({
      where: {
        tenantId: context.tenant.id,
        departmentId: context.department.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      resources: resources.map((r) => ({
        id: r.id,
        name: r.name,
        data: JSON.parse(r.data),
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  },
  { permission: 'resources:read' as Permission }
);

// POST /api/resources - Create resource scoped to tenant + department
export const POST = withGuard(
  async (req: NextRequest, context) => {
    // Unexpected failures (e.g. DB errors) propagate to withGuard's
    // catch-all, which persists an ErrorReport and returns an opaque 500.
    const body = await req.json().catch(() => {
      throw new AppError('invalid_request', 'Request body must be valid JSON', 400);
    });
    const { name, data } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required and must be a string' },
        { status: 400 }
      );
    }

    const resource = await db.resource.create({
      data: {
        name,
        data: JSON.stringify(data || {}),
        tenantId: context.tenant.id,
        departmentId: context.department.id,
        createdBy: context.user.id,
      },
    });

    return NextResponse.json(
      {
        id: resource.id,
        name: resource.name,
        data: JSON.parse(resource.data),
        createdBy: resource.createdBy,
        tenantId: resource.tenantId,
        departmentId: resource.departmentId,
        createdAt: resource.createdAt,
        updatedAt: resource.updatedAt,
      },
      { status: 201 }
    );
  },
  { permission: 'resources:write' as Permission }
);
