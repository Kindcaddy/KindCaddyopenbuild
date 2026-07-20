import { handlers } from '@/lib/auth-provider';

// Auth.js owns CSRF for its own routes; withGuard's origin check does not
// apply here by design (PRODUCTION-PLAN.md Phase 3.1).
export const { GET, POST } = handlers;
