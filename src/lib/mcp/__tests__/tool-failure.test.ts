/**
 * A tool that throws answers with a fixed sentence and a code, never with the
 * exception's own text.
 *
 * Without the wrap the SDK hands the model `error.message`, which for a
 * database failure is Prisma's prose: the query, the columns, sometimes a value
 * from the record. The detail belongs in the operator's log.
 */
import { describe, expect, it, vi } from "vitest";

const event = vi.hoisted(() => ({
  setError: vi.fn(),
  getRequestId: () => "req-123",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    ecgRecording: {
      findMany: vi.fn(async () => {
        throw new Error(
          "Invalid `prisma.ecgRecording.findMany()` invocation: column ecg_recordings.waveform_encrypted does not exist (value: 4711)",
        );
      }),
    },
  },
}));
vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: () => event,
}));

process.env.APP_URL = "http://localhost";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server";
import { MCP_TOOL_FAILED } from "../tool-failure";
import type { McpAuthContext } from "../auth";

const ctx: McpAuthContext = {
  userId: "u-1",
  tokenId: "t-1",
  scopes: ["health:read"],
  binding: "u-1:t-1",
  canRead: true,
  canWrite: false,
};

describe("a failing tool", () => {
  it("tells the model a fixed sentence, a code and the request id, and logs the cause", async () => {
    const server = createMcpServer(ctx);
    const client = new Client({ name: "failure-test", version: "1.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const result = (await client.callTool({
      name: "get_ecg_recordings",
      arguments: {},
    })) as { isError?: boolean; content: Array<{ text: string }> };
    await client.close();
    await server.close();

    expect(result.isError).toBe(true);
    const text = result.content.map((c) => c.text).join("\n");
    expect(text).not.toMatch(/prisma|invocation|column|waveform|4711/i);
    const body = JSON.parse(text) as {
      error: { code: string; message: string; requestId?: string };
    };
    expect(body.error.code).toBe(MCP_TOOL_FAILED);
    expect(body.error.requestId).toBe("req-123");
    expect(body.error.message).toContain("get_ecg_recordings");

    // The cause went to the event, which redacts it on the way to the log.
    expect(event.setError).toHaveBeenCalledWith(expect.any(Error));
    expect((event.setError.mock.calls[0][0] as Error).message).toContain(
      "findMany",
    );
  });
});
