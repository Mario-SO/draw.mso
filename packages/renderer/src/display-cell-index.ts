export interface DisplayCell {
  x: number;
  y: number;
  ch: string;
}

/** Sparse row index used to visit only cells intersecting the viewport. */
export class DisplayCellIndex {
  private rows: ReadonlyMap<number, readonly DisplayCell[]> = new Map();

  update(cells: readonly DisplayCell[]): void {
    const rows = new Map<number, DisplayCell[]>();
    for (const cell of cells) {
      let row = rows.get(cell.y);
      if (!row) rows.set(cell.y, row = []);
      row.push(cell);
    }
    for (const row of rows.values()) row.sort((a, b) => a.x - b.x);
    this.rows = rows;
  }

  /** Rows are immutable snapshots already sorted by the Rust compositor. */
  updateRows(rows: ReadonlyMap<number, readonly DisplayCell[]>): void {
    this.rows = rows;
  }

  forEach(left: number, top: number, right: number, bottom: number, visit: (cell: DisplayCell) => void): void {
    for (let y = top; y <= bottom; y++) {
      const row = this.rows.get(y);
      if (!row) continue;
      let low = 0, high = row.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (row[middle]!.x < left) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < row.length && row[index]!.x <= right; index++) visit(row[index]!);
    }
  }
}
