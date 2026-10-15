import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCostUsd, formatUtcTime } from "../../api/trace-format";
import type { Trace, TraceListQuery, TraceSortField } from "../../types/trace.types";

const COLUMNS: { field: TraceSortField | null; label: string }[] = [
  { field: "occurredAt", label: "Time (UTC)" },
  { field: null, label: "Provider / model" },
  { field: null, label: "Workflow" },
  { field: "inputTokens", label: "Input tokens" },
  { field: "outputTokens", label: "Output tokens" },
  { field: "estimatedCostUsd", label: "Estimated cost" },
  { field: "latencyMs", label: "Latency" },
  { field: null, label: "Status" },
  { field: null, label: "Detail" },
];

interface Props {
  items: Trace[];
  query: TraceListQuery;
  detailBase: string;
  listSearch: string;
  onSort: (field: TraceSortField) => void;
}

export function TraceTable({ items, query, detailBase, listSearch, onSort }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS.map(({ field, label }) => (
            <TableHead key={label}
              aria-sort={field && field === query.sortBy ? (query.sortOrder === "asc" ? "ascending" : "descending") : undefined}>
              {field ? (
                <button type="button" className="font-medium" onClick={() => onSort(field)}>
                  {label}{field === query.sortBy ? (query.sortOrder === "asc" ? " ↑" : " ↓") : ""}
                </button>
              ) : label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(trace => (
          <TableRow key={trace.id}>
            <TableCell>{formatUtcTime(trace.occurredAt)}</TableCell>
            <TableCell>{trace.provider} / {trace.model}</TableCell>
            <TableCell>{trace.workflow}</TableCell>
            <TableCell>{trace.inputTokens}</TableCell>
            <TableCell>{trace.outputTokens}</TableCell>
            <TableCell>{formatCostUsd(trace.estimatedCostUsd)}</TableCell>
            <TableCell>{trace.latencyMs} ms</TableCell>
            <TableCell><Badge variant={trace.status === "ERROR" ? "destructive" : "secondary"}>{trace.status}</Badge></TableCell>
            <TableCell>
              <Link className="underline" to={detailBase + "/" + encodeURIComponent(trace.id)}
                state={{ listSearch }} aria-label={`View trace ${trace.externalId}`}>
                View
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
