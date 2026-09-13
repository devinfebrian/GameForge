import { describe, expect, test } from "bun:test";
import { createSseResponse } from "@/lib/pipeline/sse-stream";

describe("createSseResponse", () => {
  test("streams every emitted frame and closes the body", async () => {
    const response = createSseResponse({
      run: async (emit) => {
        emit({ event: "run.started", data: { gameId: null } });
        emit({
          event: "run.completed",
          data: { gameId: "g", versionId: "v", versionNumber: 1 },
        });
      },
    });

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(body).toContain('event: run.started\ndata: {"gameId":null}\n\n');
    expect(body).toContain(
      'event: run.completed\ndata: {"gameId":"g","versionId":"v","versionNumber":1}\n\n',
    );
  });

  // The pipeline converts its own failures into outcome values, so a rejection
  // here is a bug in the transport half — the client must still be told, and the
  // detail must not reach the body.
  test("turns a rejection that escaped the pipeline into an in-band error frame", async () => {
    const reported: unknown[] = [];

    const response = createSseResponse({
      run: async (emit) => {
        emit({ event: "run.started", data: { gameId: null } });
        throw new Error("secret provider detail");
      },
      onUnexpectedError: (error) => reported.push(error),
    });

    const body = await response.text();

    expect(reported).toHaveLength(1);
    expect(body).toContain('event: run.started\ndata: {"gameId":null}\n\n');
    expect(body).toContain("event: error\n");
    expect(body).toContain('"code":"internal"');
    expect(body).not.toContain("secret provider detail");
  });
});
