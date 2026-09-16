import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { acFor, PillToggleGroup } from "./SpotFilterControls";

describe("acFor", () => {
  it("returns a distinct accent per spot source type", () => {
    expect(acFor("pota").pill).toContain("emerald");
    expect(acFor("wwff").pill).toContain("sky");
    expect(acFor("dx").pill).toContain("rose");
    expect(acFor("sota").pill).toContain("amber"); // SOTA falls through to the default (amber)
  });

  it("includes an activeTab class for tab-bar styling", () => {
    expect(acFor("pota").activeTab).toContain("emerald");
  });
});

const OPTIONS = [
  { value: "SSB", label: "SSB" },
  { value: "CW", label: "CW" },
  { value: "FT8", label: "FT8" },
];
const AC = acFor("pota");

describe("PillToggleGroup", () => {
  it("checks the All pill when every option is selected", () => {
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={["SSB", "CW", "FT8"]} onChange={() => {}} layout="wrap" />);
    expect(screen.getByRole("checkbox", { name: "All" })).toBeChecked();
  });

  it("unchecks the All pill (without indeterminate) when nothing is selected", () => {
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={[]} onChange={() => {}} layout="wrap" />);
    const allCheckbox = screen.getByRole("checkbox", { name: "All" }) as HTMLInputElement;
    expect(allCheckbox.checked).toBe(false);
    expect(allCheckbox.indeterminate).toBe(false);
  });

  it("marks the All pill indeterminate when some but not all options are selected", () => {
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={["SSB"]} onChange={() => {}} layout="wrap" />);
    const allCheckbox = screen.getByRole("checkbox", { name: "All" }) as HTMLInputElement;
    expect(allCheckbox.checked).toBe(false);
    expect(allCheckbox.indeterminate).toBe(true);
  });

  it("toggling an unselected option adds it to the selection", () => {
    const onChange = vi.fn();
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={["SSB"]} onChange={onChange} layout="wrap" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "CW" }));
    expect(onChange).toHaveBeenCalledWith(["SSB", "CW"]);
  });

  it("toggling a selected option removes it from the selection", () => {
    const onChange = vi.fn();
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={["SSB", "CW"]} onChange={onChange} layout="wrap" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "SSB" }));
    expect(onChange).toHaveBeenCalledWith(["CW"]);
  });

  it("clicking All selects everything when nothing is selected", () => {
    const onChange = vi.fn();
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={[]} onChange={onChange} layout="wrap" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith(["SSB", "CW", "FT8"]);
  });

  it("clicking All clears the selection when anything is selected (including partial/indeterminate)", () => {
    const onChange = vi.fn();
    render(<PillToggleGroup ac={AC} options={OPTIONS} selected={["SSB"]} onChange={onChange} layout="wrap" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
