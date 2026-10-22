import { useId, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AnalyticsSnapshot } from "../../types/analytics.types";
import {
  byModelPoints,
  costOverTime,
  formatCostUsd,
  formatCount,
  type CostPoint,
  type ModelPoint,
} from "./dashboardFormat";

const COLORS = { cost: "var(--chart-3)", input: "var(--chart-2)", output: "var(--chart-5)" } as const;

/** Legend made of real buttons: keyboard accessible, toggles one series. */
function SeriesToggle({
  items, hidden, onToggle,
}: {
  items: Array<{ key: string; label: string; color: string }>;
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div role="group" aria-label="Series" className="flex flex-wrap gap-2 text-xs">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          aria-pressed={!hidden.has(item.key)}
          onClick={() => onToggle(item.key)}
          className="inline-flex items-center gap-1.5 rounded border px-2 py-1 aria-[pressed=false]:opacity-50"
        >
          <span aria-hidden className="inline-block size-2.5" style={{ background: item.color }} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ChartPanel({
  title, legend, chart, table,
}: { title: string; legend: ReactNode; chart: ReactNode; table: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Button
          type="button" variant="outline" size="xs"
          aria-expanded={showTable} aria-controls={tableId}
          onClick={() => setShowTable(value => !value)}
        >
          {showTable ? "Hide data table" : "Show data table"}
        </Button>
      </div>
      {legend}
      <div className="h-64 w-full min-w-0">{chart}</div>
      <div id={tableId} hidden={!showTable}>{showTable && table}</div>
    </section>
  );
}

function DataTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: string[][] }) {
  // Scrollable and focusable, so keyboard users can reach every row.
  return (
    <div tabIndex={0} role="region" aria-label={caption} className="max-h-72 overflow-auto rounded border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>{headers.map(header => <TableHead key={header} scope="col">{header}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, column) => <TableCell key={column}>{cell}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const TOOLTIP_STYLE = {
  background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", fontSize: 12,
};

function useToggle() {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setHidden(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  return { hidden, toggle };
}

function CostOverTime({ points, bucket }: { points: CostPoint[]; bucket: string }) {
  const { hidden, toggle } = useToggle();
  const items = [{ key: "cost", label: "Estimated cost (USD)", color: COLORS.cost }];
  return (
    <ChartPanel
      title="Cost over time"
      legend={<SeriesToggle items={items} hidden={hidden} onToggle={toggle} />}
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" minTickGap={28} fontSize={11} />
            <YAxis width={56} fontSize={11} tickFormatter={(value: number) => "$" + value} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.bucketStart ?? "") + " UTC"}
              formatter={(_value, _name, item) => [formatCostUsd((item.payload as CostPoint).costText), "Estimated cost"]}
            />
            <Line type="monotone" dataKey="cost" stroke={COLORS.cost} strokeWidth={2} dot={false}
              hide={hidden.has("cost")} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption={"Estimated cost per " + bucket + " (UTC), exact values"}
          headers={["Bucket start (UTC)", "Estimated cost (USD)", "Traces"]}
          rows={points.map(point => [point.bucketStart, point.costText, String(point.traceCount)])}
        />
      }
    />
  );
}

function CostByModel({ points }: { points: ModelPoint[] }) {
  const { hidden, toggle } = useToggle();
  const items = [{ key: "cost", label: "Estimated cost (USD)", color: COLORS.cost }];
  return (
    <ChartPanel
      title="Cost by provider and model"
      legend={<SeriesToggle items={items} hidden={hidden} onToggle={toggle} />}
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
            <YAxis width={56} fontSize={11} tickFormatter={(value: number) => "$" + value} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(_value, _name, item) => [formatCostUsd((item.payload as ModelPoint).costText), "Estimated cost"]}
            />
            <Bar dataKey="cost" fill={COLORS.cost} hide={hidden.has("cost")} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption="Estimated cost by provider and model, exact values"
          headers={["Provider", "Model", "Estimated cost (USD)", "Traces"]}
          rows={points.map(point => [point.provider, point.model, point.costText, String(point.traceCount)])}
        />
      }
    />
  );
}

function TokenDistribution({ points }: { points: ModelPoint[] }) {
  const { hidden, toggle } = useToggle();
  const items = [
    { key: "input", label: "Input tokens", color: COLORS.input },
    { key: "output", label: "Output tokens", color: COLORS.output },
  ];
  return (
    <ChartPanel
      title="Input and output tokens"
      legend={<SeriesToggle items={items} hidden={hidden} onToggle={toggle} />}
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
            <YAxis width={56} fontSize={11} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(_value, name, item) => {
                const point = item.payload as ModelPoint;
                return [formatCount(name === "Input tokens" ? point.inputText : point.outputText), String(name)];
              }}
            />
            <Bar dataKey="inputTokens" name="Input tokens" fill={COLORS.input}
              hide={hidden.has("input")} isAnimationActive={false} />
            <Bar dataKey="outputTokens" name="Output tokens" fill={COLORS.output}
              hide={hidden.has("output")} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption="Input and output tokens by provider and model, exact values"
          headers={["Provider", "Model", "Input tokens", "Output tokens"]}
          rows={points.map(point => [point.provider, point.model, formatCount(point.inputText), formatCount(point.outputText)])}
        />
      }
    />
  );
}

/** The three charts of one confirmed snapshot, each with an exact-value table. */
export function DashboardCharts({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const costPoints = useMemo(() => costOverTime(snapshot), [snapshot]);
  const modelPoints = useMemo(() => byModelPoints(snapshot), [snapshot]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><CostOverTime points={costPoints} bucket={snapshot.window.bucket} /></div>
      <CostByModel points={modelPoints} />
      <TokenDistribution points={modelPoints} />
    </div>
  );
}
