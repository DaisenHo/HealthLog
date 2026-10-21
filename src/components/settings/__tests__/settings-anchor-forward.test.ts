import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/privacy",
  useRouter: () => ({ replace: vi.fn() }),
}));

import { watchAnchorForwards } from "../settings-anchor-forward";

function fakeWindow(hash: string) {
  const target = new EventTarget();
  return Object.assign(target, { location: { hash } });
}

describe("watchAnchorForwards", () => {
  it("forwards a moved anchor on arrival", () => {
    const replace = vi.fn();
    watchAnchorForwards("/settings/privacy", replace, fakeWindow("#sessions"));
    expect(replace).toHaveBeenCalledWith("/settings/security#sessions");
  });

  it("forwards when a same-page link changes only the hash", () => {
    const replace = vi.fn();
    const win = fakeWindow("#retention");
    const stop = watchAnchorForwards("/settings/privacy", replace, win);
    expect(replace).not.toHaveBeenCalled();

    win.location.hash = "#trusted-devices";
    win.dispatchEvent(new Event("hashchange"));
    expect(replace).toHaveBeenCalledWith("/settings/security#trusted-devices");

    stop();
    win.location.hash = "#sessions";
    win.dispatchEvent(new Event("hashchange"));
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
