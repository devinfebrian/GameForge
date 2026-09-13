/**
 * A process-wide double for the parsed server env.
 *
 * Same reasoning as `lib/supabase/admin.double.ts`: Bun binds a mocked module
 * path once per process, so two test files that mock `@/lib/env/server` with
 * different values are not independent — whichever loads first wins. Every test
 * installs this one accessor and configures the value it needs, which keeps the
 * suite order-independent.
 *
 * Only test files import this module; it is never part of the application graph.
 */
export const serverEnvDouble = {
  value: {} as Record<string, unknown>,

  reset(overrides: Record<string, unknown> = {}): void {
    this.value = overrides;
  },

  getServerEnv(): unknown {
    return serverEnvDouble.value;
  },
};
