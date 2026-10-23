import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { renderWithApp } from "../../../../tests/browser/render";
import { Segmented } from "../segmented";

const OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

describe("<Segmented> smoke", () => {
  it("moves with the arrow key", async () => {
    const onChange = vi.fn();
    const { screen } = await renderWithApp(
      <Segmented
        options={OPTIONS}
        value="day"
        onChange={onChange}
        label="Zoom"
      />,
    );
    await screen.getByRole("radio", { name: "Day" }).click();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("week");
    await expect
      .element(screen.getByRole("radio", { name: "Week" }))
      .toHaveFocus();
  });
});
