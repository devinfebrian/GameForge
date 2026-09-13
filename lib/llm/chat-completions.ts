/**
 * OpenAI-compatible Chat Completions transport for a Claude-fronting gateway.
 *
 * Why not `@anthropic-ai/sdk`: the Elice gateway exposes `GET /v1/models` and
 * `POST /v1/chat/completions` but returns 404 for `/v1/messages`, which is the
 * only path the Anthropic SDK knows. Measured, not assumed.
 *
 * This module deliberately has no `server-only` import and takes `fetch` as an
 * injectable dependency, so the response-shape parsing below — the part that
 * silently returns empty strings when it is wrong — is unit-testable. The
 * credential is a parameter and never read from the environment here.
 */

import { GenerationError } from "@/lib/llm/errors";
import type {
  LlmClient,
  LlmUsage,
  StructuredRequest,
  StructuredResult,
  TextRequest,
  TextResult,
} from "@/lib/llm/types";

export interface GatewayOptions {
  readonly baseUrl: string;
  readonly credential: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  /**
   * Only consulted by `listModelIds`; the chat calls each carry the signal of the
   * request they belong to.
   */
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<{
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }>;
    };
    readonly finish_reason?: string;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly error?: { readonly message?: string; readonly type?: string };
}

/**
 * The gateway emits OpenAI and Anthropic usage names side by side. Preferring
 * the OpenAI pair keeps one reading order for the token budget in Phase 6.
 */
export function parseUsage(body: ChatCompletionResponse): LlmUsage {
  return {
    inputTokens: body.usage?.prompt_tokens ?? body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? body.usage?.output_tokens ?? 0,
  };
}

export function extractText(body: ChatCompletionResponse): string {
  const content = body.choices?.[0]?.message?.content;

  // `null` is the normal value on a tool-call turn, not an error.
  return typeof content === "string" ? content : "";
}

export function extractToolArguments(
  body: ChatCompletionResponse,
  toolName: string,
): string {
  const call = body.choices?.[0]?.message?.tool_calls?.find(
    (candidate) => candidate.function?.name === toolName,
  );
  const args = call?.function?.arguments;

  if (args === undefined) {
    throw new GenerationError(
      "provider_error",
      `Expected a call to ${toolName}; the model returned ${body.choices?.[0]?.finish_reason ?? "no finish reason"}.`,
    );
  }

  return args;
}

/** Strips or adds exactly one slash so `${base}/v1/...` is always well formed. */
export function joinGatewayUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}${path}`;
}

function gatewayError(status: number, detail: string): GenerationError {
  // A WAF or content-filter block answers 403 with an HTML page rather than the
  // gateway's JSON error shape. Calling that "credential rejected" sends whoever
  // is debugging toward the API key when the real problem is the prompt text.
  const isHtmlBlockPage = /^<(!doctype|html)/i.test(detail.trim());

  if (status === 403 && isHtmlBlockPage) {
    return new GenerationError(
      "provider_content_blocked",
      "The gateway's content filter rejected the request (HTTP 403 block page). The credential is fine; the prompt text is not.",
      { cause: detail },
    );
  }

  if (status === 401 || status === 403) {
    return new GenerationError(
      "provider_auth_failed",
      `The gateway rejected the credential (HTTP ${status}). Check ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL.`,
      { cause: detail },
    );
  }

  // The gateway's own response body stays in `cause`: it can echo the prompt
  // back, and every `GenerationError.message` is sent to the client.
  return new GenerationError(
    "provider_error",
    `The model gateway returned an unexpected error (HTTP ${status}).`,
    { cause: detail },
  );
}

function describeNetworkFailure(reason: string): GenerationError {
  return new GenerationError("provider_error", "The gateway request failed.", {
    cause: reason,
  });
}

function describeTimeout(failureHint: string, timeoutMs: number): GenerationError {
  return new GenerationError(
    "provider_error",
    `The ${failureHint} request timed out after ${timeoutMs}ms.`,
  );
}

/**
 * Re-throws a failure with the tokens the provider already billed for a response
 * we did receive, so a stage that fails after the model answered is still counted
 * against the run's budget. Transport failures have no response and keep null.
 */
function attachUsage(error: unknown, usage: LlmUsage): unknown {
  if (error instanceof GenerationError && error.usage === null) {
    return new GenerationError(error.code, error.message, {
      stage: error.stage,
      cause: error.cause,
      usage,
    });
  }

  return error;
}

/**
 * Abort on either the caller's cancellation or our own deadline, and report
 * which one fired. Without this a wedged gateway connection would sit until the
 * route's maxDuration killed the whole function.
 */
function linkAbort(
  outer: AbortSignal,
  timeoutMs: number,
): { readonly signal: AbortSignal; readonly release: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const onOuterAbort = (): void => controller.abort();

  // An AbortSignal fires its event once. A listener added after the signal has
  // already aborted never runs, so a caller that disconnects before we start must
  // be checked explicitly or the request would proceed regardless.
  if (outer.aborted) {
    controller.abort();
  } else {
    outer.addEventListener("abort", onOuterAbort);
  }

  return {
    signal: controller.signal,
    timedOut: () => expired,
    release: () => {
      clearTimeout(timer);
      outer.removeEventListener("abort", onOuterAbort);
    },
  };
}

async function requestJson(
  options: {
    readonly baseUrl: string;
    readonly credential: string;
    readonly timeoutMs: number;
    readonly retryDelayMs: number;
    readonly fetchImpl: typeof fetch;
  },
  url: string,
  init: { readonly method: string; readonly body?: string; readonly signal: AbortSignal },
  failureHint: string,
): Promise<unknown> {
  let lastError: GenerationError = describeNetworkFailure(failureHint);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const linked = linkAbort(init.signal, options.timeoutMs);

    try {
      const response = await options.fetchImpl(url, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.credential}`,
        },
        body: init.body,
        signal: linked.signal,
      });

      const text = await response.text();

      if (response.ok) {
        return JSON.parse(text) as unknown;
      }

      const detail = text.slice(0, 240).replace(/\s+/g, " ").trim() || failureHint;
      lastError = gatewayError(response.status, detail);

      // Only rate limits and server faults are worth a second attempt; a 401 or
      // a 400 will fail identically every time.
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(options.retryDelayMs);
        continue;
      }

      throw lastError;
    } catch (error) {
      if (error instanceof GenerationError) {
        throw error;
      }

      if (linked.timedOut()) {
        throw describeTimeout(failureHint, options.timeoutMs);
      }

      if (init.signal.aborted) {
        // Genuine caller cancellation: must stay classifiable as an abort so the
        // pipeline skips its database write.
        throw error instanceof Error ? error : describeNetworkFailure(String(error));
      }

      lastError = describeNetworkFailure(error instanceof Error ? error.message : String(error));

      if (attempt < MAX_ATTEMPTS) {
        await sleep(options.retryDelayMs);
        continue;
      }

      throw lastError;
    } finally {
      linked.release();
    }
  }

  throw lastError;
}

function chatPayload(request: {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly temperature: number;
}): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    temperature: request.temperature,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  };
}

export function createGatewayClient(options: GatewayOptions): LlmClient {
  const resolved = {
    baseUrl: options.baseUrl,
    credential: options.credential,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    fetchImpl: options.fetchImpl ?? fetch,
  };
  const url = joinGatewayUrl(resolved.baseUrl, "/v1/chat/completions");

  async function post(payload: Record<string, unknown>, signal: AbortSignal) {
    const body = (await requestJson(resolved, url, { method: "POST", body: JSON.stringify(payload), signal }, "chat completion")) as ChatCompletionResponse;
    return { body, usage: parseUsage(body) };
  }

  return {
    async generateStructured<T>(
      request: StructuredRequest<T>,
    ): Promise<StructuredResult<T>> {
      const payload = {
        ...chatPayload(request),
        tools: [
          {
            type: "function",
            function: {
              name: request.toolName,
              description: request.toolDescription,
              parameters: request.inputSchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: request.toolName } },
      };

      const { body, usage } = await post(payload, request.signal);

      try {
        const args = extractToolArguments(body, request.toolName);

        let raw: unknown;

        try {
          raw = JSON.parse(args) as unknown;
        } catch {
          // A truncated arguments string is a transport-level failure, not a
          // schema disagreement: reporting it as spec_failed would blame the prompt.
          throw new GenerationError(
            "provider_error",
            `${request.toolName} returned arguments that are not valid JSON.`,
          );
        }

        return { data: request.parse(raw), usage };
      } catch (error) {
        // Everything past `post` has a billable response in hand, so a failure
        // here still carries the tokens it cost.
        throw attachUsage(error, usage);
      }
    },

    async generateText(request: TextRequest): Promise<TextResult> {
      const { body, usage } = await post(chatPayload(request), request.signal);

      return { text: extractText(body), usage };
    },
  };
}

/**
 * Backs `assertModelAvailable`. The gateway answers in Anthropic's list shape,
 * so one reader handles both.
 */
export async function listModelIds(options: GatewayOptions): Promise<ReadonlySet<string>> {
  const resolved = {
    baseUrl: options.baseUrl,
    credential: options.credential,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    fetchImpl: options.fetchImpl ?? fetch,
  };

  const body = (await requestJson(
    resolved,
    joinGatewayUrl(resolved.baseUrl, "/v1/models"),
    { method: "GET", signal: options.signal ?? new AbortController().signal },
    "model list",
  )) as { data?: ReadonlyArray<{ id?: string }> };

  return new Set((body.data ?? []).map((entry) => entry.id ?? "").filter((id) => id.length > 0));
}
