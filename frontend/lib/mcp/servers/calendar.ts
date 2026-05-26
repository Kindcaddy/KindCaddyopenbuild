import type { JsonValue, ToolDescriptor } from '../protocol';
import { BaseMCPServer, type ToolCallContext, type ToolImpl } from './base';
import { getGoogleCalendarClient } from '@/lib/integrations/google-calendar';

type Tool = ToolDescriptor & { impl: ToolImpl };

interface TimeSlot {
  start: string;
  end: string;
}

export class GoogleCalendarMCPServer extends BaseMCPServer {
  protected info = {
    name: 'calendar',
    version: '1.0.0',
    description:
      'Google Calendar adapter. Finds free slots and creates events for the current user.',
  };

  protected tools: Record<string, Tool> = {
    find_availability: {
      name: 'find_availability',
      description:
        'Find open time slots in Google Calendar within a time window.',
      capability: 'read',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'ISO timestamp for window start' },
          end: { type: 'string', description: 'ISO timestamp for window end' },
          durationMinutes: {
            type: 'number',
            description: 'Minimum slot duration in minutes (default: 30)',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of free slots to return (default: 10)',
          },
          timeZone: {
            type: 'string',
            description: 'IANA time zone, e.g. America/New_York',
          },
          calendarId: {
            type: 'string',
            description: 'Google calendar id. Defaults to connected calendar.',
          },
        },
        required: ['start', 'end'],
      },
      impl: this.findAvailability.bind(this),
    },
    create_event: {
      name: 'create_event',
      description: 'Create a Google Calendar event.',
      capability: 'write',
      dataScope: 'public',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'ISO start timestamp' },
          end: { type: 'string', description: 'ISO end timestamp' },
          description: { type: 'string' },
          location: { type: 'string' },
          timeZone: { type: 'string', description: 'IANA time zone' },
          calendarId: {
            type: 'string',
            description: 'Google calendar id. Defaults to connected calendar.',
          },
        },
        required: ['summary', 'start', 'end'],
      },
      impl: this.createEvent.bind(this),
    },
  };

  private async findAvailability(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const startDate = parseIso(args.start, 'start');
    const endDate = parseIso(args.end, 'end');
    if (endDate <= startDate) {
      throw new Error('end must be after start');
    }

    const durationMinutes = normalizePositiveInt(args.durationMinutes, 30);
    const maxResults = normalizePositiveInt(args.maxResults, 10);
    const timeZone = stringOrUndefined(args.timeZone);

    const { calendar, calendarId: defaultCalendarId } =
      await getGoogleCalendarClient({
        tenantId: ctx.tenantId,
        departmentId: ctx.departmentId,
        userId: ctx.userId,
      });
    const calendarId = stringOrUndefined(args.calendarId) ?? defaultCalendarId;

    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        timeZone,
        items: [{ id: calendarId }],
      },
    });

    const busyItems = freebusy.data.calendars?.[calendarId]?.busy ?? [];
    const busy = busyItems
      .map((b) => ({
        start: b.start ? new Date(b.start) : null,
        end: b.end ? new Date(b.end) : null,
      }))
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: b.start as Date, end: b.end as Date }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const slots = toFreeSlots(
      startDate,
      endDate,
      busy,
      durationMinutes,
      maxResults,
    );

    return {
      calendarId,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      durationMinutes,
      slots: slots as unknown as JsonValue,
    };
  }

  private async createEvent(
    args: Record<string, unknown>,
    ctx: ToolCallContext,
  ): Promise<JsonValue> {
    const summary = String(args.summary ?? '').trim();
    if (!summary) throw new Error('summary is required');

    const startDate = parseIso(args.start, 'start');
    const endDate = parseIso(args.end, 'end');
    if (endDate <= startDate) {
      throw new Error('end must be after start');
    }

    const { calendar, calendarId: defaultCalendarId } =
      await getGoogleCalendarClient({
        tenantId: ctx.tenantId,
        departmentId: ctx.departmentId,
        userId: ctx.userId,
      });
    const calendarId = stringOrUndefined(args.calendarId) ?? defaultCalendarId;
    const timeZone = stringOrUndefined(args.timeZone);

    const created = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        description: stringOrUndefined(args.description),
        location: stringOrUndefined(args.location),
        start: { dateTime: startDate.toISOString(), timeZone },
        end: { dateTime: endDate.toISOString(), timeZone },
      },
    });

    return {
      id: created.data.id ?? null,
      htmlLink: created.data.htmlLink ?? null,
      status: created.data.status ?? null,
      calendarId,
      start: created.data.start?.dateTime ?? startDate.toISOString(),
      end: created.data.end?.dateTime ?? endDate.toISOString(),
      summary: created.data.summary ?? summary,
    };
  }
}

function parseIso(value: unknown, field: string): Date {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error(`${field} is required`);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return d;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function stringOrUndefined(value: unknown): string | undefined {
  const s = String(value ?? '').trim();
  return s || undefined;
}

function toFreeSlots(
  start: Date,
  end: Date,
  busy: Array<{ start: Date; end: Date }>,
  minMinutes: number,
  maxResults: number,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const minMs = minMinutes * 60 * 1000;
  let cursor = start.getTime();
  const endMs = end.getTime();

  for (const block of busy) {
    if (slots.length >= maxResults) break;
    const blockStart = Math.max(block.start.getTime(), start.getTime());
    const blockEnd = Math.min(block.end.getTime(), endMs);
    if (blockEnd <= start.getTime() || blockStart >= endMs) continue;

    if (blockStart - cursor >= minMs) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(blockStart).toISOString(),
      });
      if (slots.length >= maxResults) break;
    }
    cursor = Math.max(cursor, blockEnd);
  }

  if (slots.length < maxResults && endMs - cursor >= minMs) {
    slots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(endMs).toISOString(),
    });
  }

  return slots;
}
