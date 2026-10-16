import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(() => "toast-id") } }));

import { toast } from "sonner";
import { ApiError } from "@/lib/api/api-fetch";
import { showErrorToast } from "../error-toast";

const ID = "3f9a2c1b-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("showErrorToast", () => {
  it("is exactly toast.error without a cause", () => {
    showErrorToast("Could not save");
    expect(toast.error).toHaveBeenCalledWith("Could not save");
    showErrorToast("Could not save", { id: "x" });
    expect(toast.error).toHaveBeenLastCalledWith("Could not save", { id: "x" });
  });

  it("is exactly toast.error for a cause with no id worth showing", () => {
    showErrorToast("Not allowed", {
      cause: new ApiError("no", 403, { requestId: ID }),
    });
    expect(toast.error).toHaveBeenCalledWith("Not allowed");
  });

  it("adds the error id to a server failure and keeps the toast up longer", () => {
    showErrorToast("Could not save", {
      cause: new ApiError("boom", 500, { requestId: ID }),
      description: "Try again.",
    });
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [
      string,
      { description: unknown; duration: number },
    ];
    expect(message).toBe("Could not save");
    expect(options.duration).toBe(10_000);
    expect(isValidElement(options.description)).toBe(true);
    const props = (options.description as { props: Record<string, unknown> })
      .props;
    expect(props.id).toBe(ID);
    expect(props.description).toBe("Try again.");
  });
});
