/**
 * A process-wide double for the service-role Supabase client.
 *
 * Bun registers `mock.module` mocks process-wide, and a mocked path is bound the
 * first time it is imported — so two test files that mock the same path are not
 * independent: whichever loads first wins for the rest of the run. Every test
 * therefore installs this one factory and configures behaviour by writing to the
 * shared `adminDouble` state, which makes the suite order-independent.
 *
 * Only test files import this module; it is never part of the application graph.
 * The chain exposes just the methods the tested code paths call.
 */

/** What a `from(...).select(...).eq(...).maybeSingle()` chain resolves to. */
interface AdminQueryResult {
  readonly data?: unknown;
  readonly count?: number | null;
  readonly error: { readonly message: string; readonly code?: string } | null;
}

/** What an `rpc(...)` call resolves to. */
interface AdminRpcResponse {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code: string } | null;
}

interface AdminRpcCall {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

interface QueryChain {
  select: () => QueryChain;
  eq: () => QueryChain;
  maybeSingle: () => Promise<AdminQueryResult>;
  then: (onFulfilled: (value: AdminQueryResult) => unknown) => Promise<unknown>;
}

const EMPTY_QUERY: AdminQueryResult = { data: null, error: null };
const EMPTY_RPC: AdminRpcResponse = { data: null, error: null };

export const adminDouble = {
  rpcCalls: [] as AdminRpcCall[],
  /** Consumed FIFO, one per `rpc` call; empty means a null result. */
  rpcQueue: [] as AdminRpcResponse[],
  /** Consumed FIFO, one per terminal query; empty means a null row. */
  queryQueue: [] as AdminQueryResult[],

  reset(): void {
    this.rpcCalls = [];
    this.rpcQueue = [];
    this.queryQueue = [];
  },

  shiftQuery(): AdminQueryResult {
    return this.queryQueue.shift() ?? EMPTY_QUERY;
  },

  shiftRpc(): AdminRpcResponse {
    return this.rpcQueue.shift() ?? EMPTY_RPC;
  },
};

export function createAdminClientDouble(): {
  from: () => QueryChain;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<AdminRpcResponse>;
} {
  const chain: QueryChain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => adminDouble.shiftQuery(),
    then: (onFulfilled) => Promise.resolve(adminDouble.shiftQuery()).then(onFulfilled),
  };

  return {
    from: () => chain,
    rpc: async (fn, args) => {
      adminDouble.rpcCalls.push({ fn, args });

      return adminDouble.shiftRpc();
    },
  };
}
