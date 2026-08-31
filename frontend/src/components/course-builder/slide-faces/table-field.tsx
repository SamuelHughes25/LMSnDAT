"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TableConfig } from "@/lib/course-types";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

const CHANGE_DEBOUNCE_MS = 500;

const MIN_COLS = 2;
const MAX_COLS = 6;
const MIN_ROWS = 1;
const MAX_ROWS = 10;

// A brand-new "title-table" slide has no config.table yet — this is what
// both the editor and the static/present render fall back to, so a fresh
// slide always shows a real, usable 2x2 grid to start from rather than an
// empty "click to add a table" state (a table needs at least its column
// structure to mean anything, unlike a blank text field). The editor
// persists this the moment the author changes anything; until then it's
// just a display fallback, same as multiple_choice always starting from two
// options rather than zero.
const DEFAULT_TABLE: TableConfig = {
  headers: ["Column 1", "Column 2"],
  rows: [
    ["", ""],
    ["", ""],
  ],
};

const FIELD_CLASSES =
  "w-full border-none bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:outline-none focus:ring-1 focus:ring-primary/40";

// Discrete font-size steps keyed off total cell count, not a continuous
// measure-and-shrink loop — the same "fit nicely automatically" approach
// already used for the two-column layout width fix and the interactive
// slide types' sizing, rather than a ResizeObserver-driven auto-shrink that
// would add real complexity for a case MAX_COLS/MAX_ROWS already bounds to
// a small range (at most 60 cells).
function tableFontSizeClass(cols: number, rows: number): string {
  const cells = cols * rows;
  if (cells <= 12) return "text-base";
  if (cells <= 30) return "text-sm";
  return "text-xs";
}

export function EditableTable({
  value,
  mode,
  onCommit,
}: {
  value: TableConfig | undefined;
  mode: SlideFaceProps["mode"];
  onCommit: (value: TableConfig) => void;
}) {
  const table = value ?? DEFAULT_TABLE;
  if (mode === "edit") {
    return <TableEditor table={table} onCommit={onCommit} />;
  }
  return <TableStatic table={table} />;
}

// On-canvas direct-manipulation editor — a CSS grid of plain inputs (not an
// HTML <table>, unlike TableStatic below) so the trailing per-row/per-column
// remove buttons are just extra grid cells rather than requiring an <thead>/
// row rework every time a column is added. Local state mirrors the incoming
// config, same pattern as match-pairs-slide-face.tsx's pairs list (this
// component remounts via key={slide.id} in slide-canvas.tsx on slide
// change, so there's no stale-state risk).
function TableEditor({
  table,
  onCommit,
}: {
  table: TableConfig;
  onCommit: (value: TableConfig) => void;
}) {
  const [local, setLocal] = useState(table);
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);

  // Discrete actions (add/remove row/column) commit immediately; text edits
  // (header/cell content) debounce — same split established in every other
  // slide-face editor this session.
  function commitNow(next: TableConfig) {
    setLocal(next);
    onCommit(next);
  }

  function handleHeaderChange(colIndex: number, text: string) {
    const next = { ...local, headers: local.headers.map((h, i) => (i === colIndex ? text : h)) };
    setLocal(next);
    debouncedCommit(next);
  }

  function handleCellChange(rowIndex: number, colIndex: number, text: string) {
    const next = {
      ...local,
      rows: local.rows.map((row, r) => (r === rowIndex ? row.map((c, ci) => (ci === colIndex ? text : c)) : row)),
    };
    setLocal(next);
    debouncedCommit(next);
  }

  function addColumn() {
    if (local.headers.length >= MAX_COLS) return;
    commitNow({
      headers: [...local.headers, `Column ${local.headers.length + 1}`],
      rows: local.rows.map((row) => [...row, ""]),
    });
  }

  function removeColumn(colIndex: number) {
    if (local.headers.length <= MIN_COLS) return;
    commitNow({
      headers: local.headers.filter((_, i) => i !== colIndex),
      rows: local.rows.map((row) => row.filter((_, i) => i !== colIndex)),
    });
  }

  function addRow() {
    if (local.rows.length >= MAX_ROWS) return;
    commitNow({ ...local, rows: [...local.rows, local.headers.map(() => "")] });
  }

  function removeRow(rowIndex: number) {
    if (local.rows.length <= MIN_ROWS) return;
    commitNow({ ...local, rows: local.rows.filter((_, i) => i !== rowIndex) });
  }

  const fontSizeClass = tableFontSizeClass(local.headers.length, local.rows.length);
  // One extra trailing column for the per-row remove button — the header
  // row's matching cell is just empty, keeping every row's grid alignment
  // consistent without needing a colspan.
  const gridTemplateColumns = `repeat(${local.headers.length}, minmax(0, 1fr)) auto`;

  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <div className="grid" style={{ gridTemplateColumns }}>
          {local.headers.map((header, colIndex) => (
            <div
              key={colIndex}
              className="flex items-center gap-1 border-b border-border bg-muted/50 px-2 py-1.5"
            >
              <input
                value={header}
                onChange={(e) => handleHeaderChange(colIndex, e.target.value)}
                placeholder={`Column ${colIndex + 1}`}
                className={cn(FIELD_CLASSES, fontSizeClass, "font-semibold")}
              />
              <button
                type="button"
                onClick={() => removeColumn(colIndex)}
                disabled={local.headers.length <= MIN_COLS}
                aria-label="Remove column"
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="border-b border-border bg-muted/50" />

          {local.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="contents">
              {row.map((cell, colIndex) => (
                <div key={colIndex} className="border-b border-border px-2 py-1.5 last:border-b-0">
                  <input
                    value={cell}
                    onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                    className={cn(FIELD_CLASSES, fontSizeClass)}
                  />
                </div>
              ))}
              <div className="flex items-center justify-center border-b border-border px-1 last:border-b-0">
                <button
                  type="button"
                  onClick={() => removeRow(rowIndex)}
                  disabled={local.rows.length <= MIN_ROWS}
                  aria-label="Remove row"
                  className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        {local.rows.length < MAX_ROWS && (
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add row
          </Button>
        )}
        {local.headers.length < MAX_COLS && (
          <Button variant="outline" size="sm" onClick={addColumn}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add column
          </Button>
        )}
      </div>
    </div>
  );
}

// Non-interactive render — a real <table> element (unlike TableEditor's
// grid-of-divs), since this is what a learner actually reads: a genuine
// data table is the semantically correct/accessible element for it, and
// there's no add/remove-column UI here to complicate the markup. Used for
// both "static" (thumbnail) and "present" (learner-facing) modes — a table
// has nothing interactive to do in presentation, same treatment as content
// slide bodies.
function TableStatic({ table }: { table: TableConfig }) {
  const fontSizeClass = tableFontSizeClass(table.headers.length, table.rows.length);

  return (
    <div className="h-full w-full overflow-auto">
      <table className={cn("w-full table-fixed border-collapse", fontSizeClass)}>
        <thead>
          <tr>
            {table.headers.map((header, i) => (
              <th key={i} className="border border-border bg-muted/50 px-2 py-1.5 text-left font-semibold">
                {header || <span className="text-muted-foreground/50">—</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td key={colIndex} className="border border-border px-2 py-1.5">
                  {cell || <span className="text-muted-foreground/50">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
