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
   * Provider name (e.g. "gemini") to select the right API format. Auto-detected
   * from baseUrl when omitted.
   */
  readonly provider?: string;
  /**
   * Only consulted by `listModelIds`; the chat calls each carry the signal of the
   * request they belong to.
   */
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_DELAY_MS = 500;
// A transient connect failure to this gateway was observed to outlive a single
// 500ms retry, surfacing to the user as a bare transport error. Three attempts
// with a widening gap ride out a short blip; a real outage still fails after
// them, and every attempt stays bounded by the per-request timeout.
const MAX_ATTEMPTS = 3;

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

/**
 * A completion that stopped at `max_tokens` is not a finished answer.
 *
 * The gateway fronts a thinking model, and the ceiling covers hidden reasoning
 * as well as visible text, so the coder's scene can be cut off mid-statement and
 * still arrive as a normal 200 with non-empty `content`. Persisting that stores a
 * file that cannot parse. `generateStructured` already surfaces truncation via
 * its JSON parse; a text answer has no such backstop, so it is reported here as
 * a transport failure, like any other payload we received but cannot trust.
 */
function assertComplete(
  body: ChatCompletionResponse,
  usage: LlmUsage,
): void {
  if (body.choices?.[0]?.finish_reason === "length") {
    throw new GenerationError(
      "provider_error",
      "The model's answer was cut off at its output limit before it finished.",
      { usage },
    );
  }
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

/** Normalises a gateway base URL and appends the given path.
 * - Trims trailing slashes from the base.
 * - Strips a trailing "/v1" segment so that paths like "/v1/chat/completions"
 *   are never doubled (some providers store the base URL with /v1 included).
 */
export function joinGatewayUrl(baseUrl: string, path: string): string {
  let trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (trimmed.endsWith("/v1")) trimmed = trimmed.slice(0, -3); // avoid /v1/v1/...
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

/**
 * A transport failure, named for what it actually is. A 200 whose body will not
 * parse is not a network problem, and reporting both as one message (as this
 * once did) points whoever is debugging at the wrong layer. The provider's own
 * text stays in `cause`, out of the user-facing message.
 */
function describeNetworkFailure(error: unknown): GenerationError {
  const reason =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  const message =
    error instanceof SyntaxError
      ? "The model gateway returned a response that was not valid JSON."
      : "The model gateway could not be reached.";

  return new GenerationError("provider_error", message, { cause: reason });
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

      // Only rate limits, server faults, and payload-too-large are worth a
      // second attempt; a 401 or a generic 400 will fail identically every time.
      // 413/429 on free tiers (e.g. Groq) need aggressive exponential backoff:
      // the per-minute input token limit needs 10-30s+ to cool down between
      // large sequential requests (spec → assets → coder).
      if ((response.status === 429 || response.status === 413 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        const isRateLimited = response.status === 429 || response.status === 413;
        // Exponential backoff: 10s, 20s for rate limits; 0.5s, 1s for server errors (0 if retryDelayMs is 0 for tests)
        const delayMs = options.retryDelayMs === 0
          ? 0
          : isRateLimited
            ? 10_000 * Math.pow(2, attempt - 1)   // 10s, 20s
            : options.retryDelayMs * attempt;       // 0.5s, 1s
        await sleep(delayMs);
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

      lastError = describeNetworkFailure(error);

      if (attempt < MAX_ATTEMPTS) {
        await sleep(options.retryDelayMs * attempt);
        continue;
      }

      throw lastError;
    } finally {
      linked.release();
    }
  }

  throw lastError;
}

/**
 * The gateway's model reasons by default, and that hidden reasoning is billed
 * against the same output ceiling as the visible answer. Measured on the coder's
 * scene prompt, the default consumed the entire cap and returned 31 characters
 * of code, so a whole-file answer was impossible and the scene arrived
 * truncated. The gateway ignores `thinking: { type: "disabled" }` but honours
 * `reasoning_effort`; "low" still plans, yet leaves room for the answer.
 *
 * Applied to every call because the ceiling is shared on all of them, tool-call
 * turns included, and a starved agent fails the same way a truncated one does.
 */
const REASONING_EFFORT = "low";

/**
 * The non-streaming gateway proxy enforces a hard 6000-token ceiling and rejects
 * anything larger with HTTP 400. Defensive clamping ensures requests never exceed this.
 */
const GATEWAY_MAX_TOKENS_CEILING = 6000;

function chatPayload(request: {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly temperature: number;
}): Record<string, unknown> {
  return {
    model: request.model,
    max_tokens: Math.min(request.maxTokens, GATEWAY_MAX_TOKENS_CEILING),
    temperature: request.temperature,
    reasoning_effort: REASONING_EFFORT,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  };
}

// ─── Gemini API adapter ───────────────────────────────────────────────────────
// Gemini uses a different request/response format from OpenAI. These helpers
// convert OpenAI-format payloads to Gemini's "generateContent" format and convert
// the response back to OpenAI format so the rest of the pipeline is unchanged.

function isGeminiProvider(baseUrl: string): boolean {
  return baseUrl.includes("generativelanguage.googleapis.com");
}

/**
 * Converts an OpenAI-format chat completion payload to Gemini generateContent format.
 * Supports both text-only and function-calling prompts.
 */
function toGeminiPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const messages = payload.messages as Array<{ role: string; content: string }>;

  const contents = messages.map((msg) => {
    // Gemini role: "user" or "model". "system" is merged into the first user msg.
    const role = msg.role === "model" ? "model" : "user";
    return { role, parts: [{ text: msg.content }] };
  });

  const config: Record<string, unknown> = {
    temperature: payload.temperature ?? 0.7,
    maxOutputTokens: (payload.max_tokens as number) ?? 4096,
  };

  if (payload.stop && typeof payload.stop === "string") {
    config.stopSequences = [payload.stop];
  }

  const gemini: Record<string, unknown> = { contents, generationConfig: config };

  // Convert OpenAI tools to Gemini function_declarations
  const tools = payload.tools as Array<{
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }>;
  if (tools && tools.length > 0) {
    gemini.tools = {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    };
  }

  return gemini;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

/** Converts a Gemini generateContent response back to OpenAI chat completion format. */
function fromGeminiResponse(resp: GeminiResponse): ChatCompletionResponse {
  if (resp.error) {
    return { error: { message: resp.error.message, type: "provider_error" } };
  }

  const candidate = resp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  let textContent = "";
  const toolCalls: Array<{ function: { name: string; arguments: string } }> = [];

  for (const part of parts) {
    if (part.text !== undefined) {
      textContent += part.text;
    }
    if (part.functionCall) {
      toolCalls.push({
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      });
    }
  }

  return {
    choices: [
      {
        message: {
          content: textContent || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        finish_reason: candidate?.finishReason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: resp.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
      input_tokens: resp.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
    },
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

  // Detect Gemini provider from base URL
  const isGemini = isGeminiProvider(options.baseUrl);

  // Gemini base URL for generateContent
  const geminiBase = "https://generativelanguage.googleapis.com/v1beta";

  async function post(payload: Record<string, unknown>, signal: AbortSignal) {
    let responseBody: ChatCompletionResponse;

    if (isGemini) {
      // Extract model name from payload and build Gemini generateContent URL
      const modelName = String(payload.model ?? "gemini-2.5-flash");
      const url = `${geminiBase}/models/${modelName}:generateContent`;
      const geminiPayload = toGeminiPayload(payload);
      const raw = (await requestJson(resolved, url, {
        method: "POST",
        body: JSON.stringify(geminiPayload),
        signal,
      }, "gemini generateContent")) as GeminiResponse;
      responseBody = fromGeminiResponse(raw);
    } else {
      const url = joinGatewayUrl(resolved.baseUrl, "/v1/chat/completions");
      responseBody = (await requestJson(resolved, url, {
        method: "POST",
        body: JSON.stringify(payload),
        signal,
      }, "chat completion")) as ChatCompletionResponse;
    }

    return { body: responseBody, usage: parseUsage(responseBody) };
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

      assertComplete(body, usage);

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

  // Gemini uses /v1beta/models instead of /v1/models
  const isGemini = isGeminiProvider(options.baseUrl);
  const modelsPath = isGemini ? "/v1beta/models" : "/v1/models";

  const body = (await requestJson(
    resolved,
    joinGatewayUrl(resolved.baseUrl, modelsPath),
    { method: "GET", signal: options.signal ?? new AbortController().signal },
    "model list",
  )) as { models?: ReadonlyArray<{ name?: string }>; data?: ReadonlyArray<{ id?: string }> };

  if (isGemini) {
    // Gemini response: { models: [{ name: "models/gemini-2.5-flash" }] }
    return new Set(
      (body.models ?? [])
        .map((m) => m.name?.replace("models/", "") ?? "")
        .filter((id) => id.length > 0)
    );
  }
  // OpenAI-style response: { data: [{ id: "gpt-4" }] }
  return new Set((body.data ?? []).map((entry) => entry.id ?? "").filter((id) => id.length > 0));
}
