// k6 load script — verifies the chat-turn rate limiter degrades to 429s, not 500s.
//
// Why this script exists
// ----------------------
// `lib/mcp/policy.ts` enforces a per-(tenantId, userId) token-bucket rate limit
// (30 burst, 1 rps). Two failure modes worth pinning down at load:
//
//   1. The limiter is wired but doesn't actually limit — every request returns 200
//      regardless of rate. This script will fail the `'rate of 429s > 10%'` threshold
//      under the configured burst.
//   2. The limiter throws an unhandled error and the route returns 500 instead of 429.
//      This script will fail the `'no 500s'` threshold.
//
// Either failure means the production deployment is one accidental traffic spike away
// from cascading. The whole point of having a rate limiter is to fail predictably; this
// script proves it does.
//
// Usage:
//   k6 run \
//     -e BASE_URL=http://localhost:3000 \
//     -e TEST_COOKIE='userId:tenantId' \
//     tests/load/chat-turn-ratelimit.js
//
// Notes:
//   - TEST_COOKIE is a seeded auth_session value (see prisma/seed.ts). Production should
//     never accept this shape; this script is staging/local only.
//   - 20 RPS sustained for 2 minutes overwhelms the 30-token bucket within ~2 seconds,
//     after which the 1-rps refill paces all subsequent requests.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const COOKIE = __ENV.TEST_COOKIE || 'demo-user:demo-tenant';

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    // Most requests should be 200 or 429. Anything else is a bug.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
    // No 500s. The rate limiter must degrade gracefully, not catastrophically.
    'checks{type:no_5xx}': ['rate==1'],
    // After the initial burst, we expect to see 429s — proving the limiter is active.
    'checks{type:saw_429}': ['rate>0.5'],
    // Successful responses should be fast (no LLM call on a denied turn).
    'http_req_duration{status:200}': ['p(95)<3000'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/mcp/chat`,
    JSON.stringify({ message: 'ping (load test)' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth_session=${COOKIE}`,
      },
      tags: { name: 'chat-turn' },
    },
  );

  check(
    res,
    {
      'no 5xx': (r) => r.status < 500,
    },
    { type: 'no_5xx' },
  );

  check(
    res,
    {
      'saw 429': (r) => r.status === 429,
    },
    { type: 'saw_429' },
  );
}
