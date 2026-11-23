"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";
import { useDesk } from "@/lib/store";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting. Omit to make the column unsortable. */
  sort?: (row: T) => number | string | null;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
  /** Hide below a breakpoint */
  hideBelow?: "sm" | "md" | "lg" | "xl" | "2xl";
}

const hideCls = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden", xl: "max-xl:hidden", "2xl": "max-2xl:hidden" };

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  onRowClick,
  expand,
  pageSize,
  empty,
  className,
  flashKey,
  rowClassName,
  stickyHeader = true,
  defaultOpen,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (row: T) => void;
  expand?: (row: T) => ReactNode;
  pageSize?: number;
  empty?: ReactNode;
  className?: string;
  /** Rows whose key appears here get a brief highlight (new data). */
  flashKey?: Set<string>;
  rowClassName?: (row: T) => string | undefined;
  stickyHeader?: boolean;
  /** Row keys expanded on first render */
  defaultOpen?: string[];
}) {
  const { snap } = useDesk();
  const compact = snap?.settings.display.compactTables;
  const [sort, setSort] = useState(initialSort ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen ?? []));
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Missing values always sort last, whatever the direction.
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, sort, columns]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, pages - 1);
  const visible = pageSize ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" }));
    setPage(0);
  };

  const toggleOpen = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const cellPad = compact ? "py-1.5" : "py-2.5";

  return (
    <div className={cx("min-w-0", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead className={cx(stickyHeader && "sticky top-0 z-[1]")}>
            <tr>
              {expand && <th className="w-8 border-b border-line bg-bg-2/60" aria-label="Expand" />}
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ width: c.width }}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cx(
                      "h-9 whitespace-nowrap border-b border-line bg-bg-2/60 px-3 text-2xs font-medium uppercase tracking-[0.07em] text-fg-3 backdrop-blur first:pl-5 last:pr-5",
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                      c.hideBelow && hideCls[c.hideBelow],
                    )}
                  >
                    {c.sort ? (
                      <button type="button" onClick={() => toggleSort(c.key)} className={cx("inline-flex items-center gap-1 uppercase transition-colors hover:text-fg-2", active && "text-fg-2", c.align === "right" && "flex-row-reverse")}>
                        {c.header}
                        <Icon className={cx("size-3", active ? "text-accent-2" : "opacity-50")} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const k = rowKey(row);
              const isOpen = open.has(k);
              const clickable = !!onRowClick || !!expand;
              return (
                <Fragment key={k}>
                  <tr
                    onClick={clickable ? () => (onRowClick ? onRowClick(row) : toggleOpen(k)) : undefined}
                    className={cx("group transition-colors", clickable && "cursor-pointer", isOpen ? "bg-elevated/60" : "hover:bg-elevated/45", flashKey?.has(k) && "animate-flash", rowClassName?.(row))}
                  >
                    {expand && (
                      <td className={cx("border-b border-line pl-3", cellPad)}>
                        <button
                          type="button"
                          aria-label={isOpen ? "Collapse row" : "Expand row"}
                          aria-expanded={isOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOpen(k);
                          }}
                          className="flex size-5 items-center justify-center rounded text-fg-3 hover:bg-hover hover:text-fg"
                        >
                          <ChevronRight className={cx("size-3.5 transition-transform", isOpen && "rotate-90")} />
                        </button>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cx(
                          "whitespace-nowrap border-b border-line px-3 text-fg first:pl-5 last:pr-5",
                          cellPad,
                          c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                          c.hideBelow && hideCls[c.hideBelow],
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {expand && isOpen && (
                    <tr>
                      <td colSpan={columns.length + 1} className="border-b border-line bg-bg-2/50 p-0">
                        <div className="animate-fade-in">{expand(row)}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (empty ?? <div className="px-5 py-12 text-center text-xs text-fg-3">No rows match the current filters.</div>)}
      {pageSize && sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-4 px-5 py-3 text-xs text-fg-3">
          <span className="num">
            {safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} of {sorted.length.toLocaleString("en-US")}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="flex size-7 items-center justify-center rounded-md border border-line text-fg-2 hover:bg-elevated disabled:opacity-35">
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="num px-2">
              {safePage + 1} / {pages}
            </span>
            <button type="button" aria-label="Next page" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="flex size-7 items-center justify-center rounded-md border border-line text-fg-2 hover:bg-elevated disabled:opacity-35">
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
