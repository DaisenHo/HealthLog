import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api-handler", () => ({
  apiHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  requireAuth: vi.fn(async () => ({ user: { id: "u1" } })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    whoopConnection: { findUnique: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("@/lib/auth/audit", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/integrations/status", () => ({ markDisconnected: vi.fn() }));

vi.mock("@/lib/api-response", () => ({
  apiSuccess: (data: unknown) => ({ data, error: null, status: 200 }),
  apiError: (error: string, status: number) => ({ data: null, error, status }),
}));

import { POST } from "../route";
import { prisma } from "@/lib/db";
import { markDisconnected } from "@/lib/integrations/status";

const connFind = prisma.whoopConnection.findUnique as ReturnType<typeof vi.fn>;
const connDelete = prisma.whoopConnection.delete as ReturnType<typeof vi.fn>;

describe("POST /api/whoop/disconnect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s when there is no connection", async () => {
    connFind.mockResolvedValue(null);
    const res = (await (
      POST as unknown as () => Promise<{ status: number }>
    )()) as { status: number };
    expect(res.status).toBe(404);
    expect(connDelete).not.toHaveBeenCalled();
  });

  it("deletes the connection and parks the integration on success", async () => {
    connFind.mockResolvedValue({ id: "c1", userId: "u1" });
    connDelete.mockResolvedValue({});
    const res = (await (POST as unknown as () => Promise<{ data: unknown }>)())
      .data as { disconnected: boolean };
    expect(res.disconnected).toBe(true);
    expect(connDelete).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(markDisconnected).toHaveBeenCalledWith("u1", "whoop");
  });
});
