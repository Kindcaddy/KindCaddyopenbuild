import { classifyQboError } from '@/lib/mcp/servers/quickbooks';
import { QboApiError } from '@/lib/integrations/quickbooks';

/**
 * Version-change resilience: expected QBO failures map to graceful,
 * user-facing tool payloads; anything unexpected returns null so the throw
 * path (ErrorReport triage) is preserved for genuine bugs.
 */
describe('classifyQboError (QBO version-change resilience)', () => {
  it('maps 400 "not supported" faults to feature_unavailable', () => {
    const err = new QboApiError(
      400,
      'query',
      '{"Fault":[{"error":[{"Message":"Operation not supported","Detail":"Entity Bill is not supported for this company"}]}]}',
      'QBO API call failed (400 GET query): ...',
    );
    const classified = classifyQboError(err);
    expect(classified).not.toBeNull();
    expect(classified?.ok).toBe(false);
    expect(classified?.code).toBe('feature_unavailable');
    expect(classified?.suggested_alternative).toBeTruthy();
    expect(String(classified?.error)).toMatch(/QuickBooks Online version/);
  });

  it('maps 403 "not entitled" faults to feature_unavailable', () => {
    const err = new QboApiError(
      403,
      'query',
      'The application is not entitled to access this feature.',
      'QBO API call failed (403 GET query): ...',
    );
    expect(classifyQboError(err)?.code).toBe('feature_unavailable');
  });

  it('truncates long fault bodies in detail', () => {
    const err = new QboApiError(400, 'query', `unsupported ${'x'.repeat(400)}`, 'msg');
    const classified = classifyQboError(err);
    expect(String(classified?.detail).length).toBeLessThanOrEqual(200);
  });

  it('returns null for ordinary 400 validation errors (still a bug path)', () => {
    const err = new QboApiError(
      400,
      'invoice',
      '{"Fault":[{"error":[{"Message":"Required parameter missing","Detail":"CustomerRef is required"}]}]}',
      'QBO API call failed (400 POST invoice): ...',
    );
    expect(classifyQboError(err)).toBeNull();
  });

  it('maps 401 to reconnect_required', () => {
    const err = new QboApiError(401, 'query', 'Unauthorized', 'QBO API call failed (401 GET query): ...');
    const classified = classifyQboError(err);
    expect(classified?.ok).toBe(false);
    expect(classified?.code).toBe('reconnect_required');
    expect(String(classified?.error)).toMatch(/[Rr]econnect/);
  });

  it('returns null for non-QBO errors', () => {
    expect(classifyQboError(new Error('boom'))).toBeNull();
    expect(classifyQboError('string error')).toBeNull();
    expect(classifyQboError(null)).toBeNull();
  });
});
