/**
 * What a model is told when a tool fails, and what the operator is told.
 *
 * A tool that threw was answered by the MCP SDK with the exception's own
 * message as the result text, so a database failure reached the model, and
 * through it the person's chat, as Prisma's prose: the query shape, the
 * column names, sometimes a value from the record. That text is for the
 * operator. The model gets a fixed sentence it can relay, a stable code to
 * branch on, and the request id that finds the event in the log; the
 * exception goes to the wide event, through the same redaction every other
 * error takes.
 */
import { annotate, getEvent } from "@/lib/logging/context";

/** The code a failed tool call carries in its MCP result (not an HTTP `meta.errorCode`). */
export const MCP_TOOL_FAILED = "mcp.tool.failed";

export function toolFailure(
  toolName: string,
  error: unknown,
): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const evt = getEvent();
  const requestId = evt?.getRequestId() ?? null;
  if (evt) {
    evt.setError(error);
    annotate({
      action: { name: "mcp.tool.failed" },
      meta: { tool: toolName },
    });
  } else {
    // The stdio entrypoint runs outside a request, and stderr is its log.
    console.error(`HealthLog MCP: tool ${toolName} failed`, error);
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code: MCP_TOOL_FAILED,
            message: `The ${toolName} tool could not complete this request. Try again later; if it keeps failing, the operator can find the failure by its request id.`,
            ...(requestId ? { requestId } : {}),
          },
        }),
      },
    ],
  };
}
