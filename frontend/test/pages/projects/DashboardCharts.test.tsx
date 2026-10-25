import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DashboardCharts } from "@/pages/projects/DashboardCharts";
import { readEvaluationFixture } from "../../api/helpers/evaluation-fixtures";
vi.mock("recharts", async original => ({
  ...await original<typeof import("recharts")>(),
  // jsdom has no layout: real charts receive deterministic dimensions.
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div style={{ width: 800, height: 300 }}>{children}</div>,
}));
it("exposes exact values and keyboard-operable legend buttons for every chart", () => {
  const snapshot = JSON.parse(readEvaluationFixture("responses/analytics-golden.json"));
  render(<DashboardCharts snapshot={snapshot} />);
  for (const title of ["Cost over time", "Cost by provider and model", "Input and output tokens"]) {
    const panel = within(screen.getByRole("region", { name: title }));
    const toggle = panel.getByRole("button", { name: "Show data table" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel.getByRole("table")).toBeInTheDocument();
    const legend = within(panel.getByRole("group", { name: "Series" })).getAllByRole("button")[0];
    fireEvent.click(legend);
    expect(legend).toHaveAttribute("aria-pressed", "false");
  }
  expect(screen.getByText("0.008200000000")).toBeInTheDocument();
});
