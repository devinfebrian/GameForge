import { describe, expect, test } from "bun:test";
import {
  createGatewayClient,
  extractText,
  extractToolArguments,
  joinGatewayUrl,
  listModelIds,
  parseUsage,
} from "@/lib/llm/chat-completions";
import { GenerationError } from "@/lib/llm/errors";
import type { StructuredRequest, TextRequest } from "@/lib/llm/types";

const BASE_URL = "https://gateway.test/proj";

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown> | undefined;
}

function stubFetch(script: ReadonlyArray<{ status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const queue = [...script];

  const impl = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const next = queue.length > 1 ? queue.shift() : queue[0];

    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });

    return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 200 });
  };

  return { calls, impl: impl as unknown as typeof fetch };
}

function completion(toolArguments?: string, content: string | null = null) {
  return {
    choices: [
      {
        message: {
          content,
          tool_calls:
            toolArguments === undefined
              ? undefined
              : [{ id: "toolu_1", type: "function", function: { name: "submit_probe", arguments: toolArguments } }],
        },
        finish_reason: toolArguments === undefined ? "stop" : "tool_calls",
      },
    ],
    usage: { prompt_tokens: 606, completion_tokens: 60, input_tokens: 606, output_tokens: 60 },
  };
}

function structuredRequest(overrides: Partial<StructuredRequest<{ title: string }>> = {}) {
  const base: StructuredRequest<{ title: string }> = {
    model: "claude-sonnet-5",
    system: "sys",
    user: "usr",
    toolName: "submit_probe",
    toolDescription: "desc",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    maxTokens: 2048,
    temperature: 0.2,
    signal: new AbortController().signal,
    parse: (raw) => raw as { title: string },
  };

  return { ...base, ...overrides };
}

describe("parseUsage", () => {
  test("prefers the OpenAI names", () => {
    expect(parseUsage(completion(undefined, "x"))).toEqual({ inputTokens: 606, outputTokens: 60 });
  });

  test("falls back to the Anthropic names", () => {
    expect(parseUsage({ usage: { input_tokens: 5, output_tokens: 6 } })).toEqual({
      inputTokens: 5,
      outputTokens: 6,
    });
  });

  test("defaults to zero when no usage block is present", () => {
    expect(parseUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("extractText", () => {
  test("reads assistant text", () => {
    expect(extractText(completion(undefined, "hello"))).toBe("hello");
  });

  // A tool-call turn legitimately carries content: null, which must not become
  // the string "null" in a persisted scene.
  test("treats a tool-call turn's null content as empty", () => {
    expect(extractText(completion('{"title":"t"}', null))).toBe("");
  });

  test("treats a missing choice as empty", () => {
    expect(extractText({})).toBe("");
  });
});

describe("extractToolArguments", () => {
  test("finds the call for the forced tool", () => {
    expect(extractToolArguments(completion('{"title":"t"}'), "submit_probe")).toBe('{"title":"t"}');
  });

  test("rejects when the model ignored the forced tool", () => {
    expect(() => extractToolArguments(completion(undefined, "prose"), "submit_probe")).toThrow(
      GenerationError,
    );
  });
});

describe("joinGatewayUrl", () => {
  test("normalises the trailing slash exactly once", () => {
    expect(joinGatewayUrl(BASE_URL, "/v1/models")).toBe("https://gateway.test/proj/v1/models");
    expect(joinGatewayUrl(`${BASE_URL}/`, "/v1/models")).toBe("https://gateway.test/proj/v1/models");
  });
});

describe("createGatewayClient — structured", () => {
  test("sends a bearer credential and no x-api-key header", async () => {
    const { calls, impl } = stubFetch([{ status: 200, body: completion('{"title":"Pixel Hopper"}') }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt-token", fetchImpl: impl });

    await client.generateStructured(structuredRequest());

    expect(calls[0].headers.Authorization).toBe("Bearer jwt-token");
    expect(calls[0].headers["x-api-key"]).toBeUndefined();
    expect(calls[0].url).toBe("https://gateway.test/proj/v1/chat/completions");
  });

  test("builds an OpenAI-shaped forced tool call", async () => {
    const { calls, impl } = stubFetch([{ status: 200, body: completion('{"title":"Pixel Hopper"}') }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    await client.generateStructured(structuredRequest());

    const payload = calls[0].body;
    expect(payload?.model).toBe("claude-sonnet-5");
    expect(payload?.max_tokens).toBe(2048);
    expect(payload?.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);

    const tools = payload?.tools as Array<{ type: string; function: Record<string, unknown> }>;
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("submit_probe");
    expect(tools[0].function.parameters).toMatchObject({ type: "object" });

    expect(payload?.tool_choice).toEqual({ type: "function", function: { name: "submit_probe" } });

    // The gateway's default reasoning consumes the shared output ceiling and
    // starves the answer; every call must ask for less of it.
    expect(payload?.reasoning_effort).toBe("low");
  });

  test("parses the arguments string and reports usage", async () => {
    const { impl } = stubFetch([{ status: 200, body: completion('{"title":"Pixel Hopper"}') }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    const result = await client.generateStructured<{ title: string }>(structuredRequest());

    expect(result.data).toEqual({ title: "Pixel Hopper" });
    expect(result.usage).toEqual({ inputTokens: 606, outputTokens: 60 });
  });

  // A truncated arguments payload is a transport fault; calling it spec_failed
  // would send whoever is debugging toward the prompt instead of the gateway.
  test("reports malformed arguments JSON as a provider error", async () => {
    const { impl } = stubFetch([{ status: 200, body: completion('{"title":"unfinished') }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).code).toBe("provider_error");
    }
  });
});

describe("createGatewayClient — failures", () => {
  test("a rejected credential is reported as auth, not a generic failure", async () => {
    const { calls, impl } = stubFetch([{ status: 401, body: { error: { message: "invalid token" } } }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).code).toBe("provider_auth_failed");
    }

    expect(calls).toHaveLength(1);
  });

  test("a 403 WAF block page is reported as a content block, not an auth failure", async () => {
    // This is exactly what the Elice gateway returns for a prompt its filter
    // dislikes; labelling it provider_auth_failed sends debugging toward the
    // credential when the real problem is our own prompt text.
    const blockPage = (async () =>
      new Response("<!DOCTYPE html><html><body>Request blocked</body></html>", { status: 403 })) as unknown as typeof fetch;

    const client = createGatewayClient({
      baseUrl: BASE_URL,
      credential: "jwt",
      fetchImpl: blockPage,
      retryDelayMs: 0,
    });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).code).toBe("provider_content_blocked");
    }
  });

  test("a 403 carrying a JSON error remains an auth failure", async () => {
    const { impl } = stubFetch([{ status: 403, body: { error: { message: "forbidden" } } }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect((error as GenerationError).code).toBe("provider_auth_failed");
    }
  });

  test("a rate limit is retried once and then succeeds", async () => {
    const { calls, impl } = stubFetch([
      { status: 429, body: { error: { message: "slow down" } } },
      { status: 200, body: completion('{"title":"Pixel Hopper"}') },
    ]);
    const client = createGatewayClient({
      baseUrl: BASE_URL,
      credential: "jwt",
      fetchImpl: impl,
      retryDelayMs: 0,
    });

    const result = await client.generateStructured(structuredRequest());

    expect(calls).toHaveLength(2);
    expect(result.data).toEqual({ title: "Pixel Hopper" });
  });

  test("a gateway timeout surfaces as a provider error", async () => {
    const hanging = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    const client = createGatewayClient({
      baseUrl: BASE_URL,
      credential: "jwt",
      fetchImpl: hanging,
      timeoutMs: 5,
      retryDelayMs: 0,
    });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).code).toBe("provider_error");
      expect((error as GenerationError).message).toContain("timed out");
    }
  });

  // A connect blip to this gateway was observed to outlive a single 500ms retry,
  // so a second attempt is not enough on its own.
  test("rides out a transient connection failure", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("Unable to connect. Is the computer able to access the url?");
      }

      return new Response(JSON.stringify(completion('{"title":"Pixel Hopper"}')), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createGatewayClient({
      baseUrl: BASE_URL,
      credential: "jwt",
      fetchImpl: flaky,
      retryDelayMs: 0,
    });

    const result = await client.generateStructured<{ title: string }>(structuredRequest());

    expect(result.data).toEqual({ title: "Pixel Hopper" });
    expect(calls).toBe(2);
  });

  test("reports an unreachable gateway rather than a generic failure", async () => {
    const down = (async () => {
      throw new Error("Unable to connect. Is the computer able to access the url?");
    }) as unknown as typeof fetch;
    const client = createGatewayClient({
      baseUrl: BASE_URL,
      credential: "jwt",
      fetchImpl: down,
      retryDelayMs: 0,
    });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).message).toContain("could not be reached");
    }
  });

  // A 200 whose body will not parse is a different failure from an unreachable
  // host, and the message must not send debugging toward the network.
  test("names an unparseable gateway response distinctly", async () => {
    const htmlPage = (async () =>
      new Response("<!doctype html><html><body>nope</body></html>", {
        status: 200,
      })) as unknown as typeof fetch;
    const client = createGatewayClient({
      baseUrl: BASE_URL,
      credential: "jwt",
      fetchImpl: htmlPage,
      retryDelayMs: 0,
    });

    try {
      await client.generateStructured(structuredRequest());
      throw new Error("expected generateStructured to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).message).toContain("not valid JSON");
    }
  });
});

describe("createGatewayClient — text", () => {
  function textRequest(overrides: Partial<TextRequest> = {}): TextRequest {
    return {
      model: "claude-sonnet-5",
      system: "sys",
      user: "usr",
      maxTokens: 16_000,
      temperature: 0.4,
      signal: new AbortController().signal,
      ...overrides,
    };
  }

  test("returns the assistant text for the coder", async () => {
    const { calls, impl } = stubFetch([{ status: 200, body: completion(undefined, "class MainScene {}") }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    const result = await client.generateText(textRequest());

    expect(result.text).toBe("class MainScene {}");
    expect(calls[0].body?.tools).toBeUndefined();
  });

  // The gateway runs a thinking model, so max_tokens covers hidden reasoning as
  // well as the answer. A truncated scene still arrives as a 200 with non-empty
  // content, and persisting it stores a file that cannot parse. Truncation must
  // be a transport failure, not a silently accepted answer.
  test("reports a length-truncated answer as a provider error", async () => {
    const truncated = {
      choices: [
        { message: { content: "class MainScene { constructor() {" }, finish_reason: "length" },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 16_000, output_tokens: 16_000 },
    };
    const { impl } = stubFetch([{ status: 200, body: truncated }]);
    const client = createGatewayClient({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    try {
      await client.generateText(textRequest());
      throw new Error("expected generateText to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).code).toBe("provider_error");
      // The provider billed for the truncated answer, so the run must still
      // charge it.
      expect((error as GenerationError).usage).toEqual({
        inputTokens: 100,
        outputTokens: 16_000,
      });
    }
  });
});

describe("listModelIds", () => {
  test("reads the gateway's model list", async () => {
    const { calls, impl } = stubFetch([
      {
        status: 200,
        body: {
          object: "list",
          data: [{ id: "claude-sonnet-5" }, { id: "anthropic/claude-sonnet-5" }],
        },
      },
    ]);

    const ids = await listModelIds({ baseUrl: BASE_URL, credential: "jwt", fetchImpl: impl });

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://gateway.test/proj/v1/models");
    expect(ids.has("claude-sonnet-5")).toBe(true);
    expect(ids.size).toBe(2);
  });
});
