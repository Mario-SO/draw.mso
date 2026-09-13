export interface DisplayCell {
  x: number;
  y: number;
  ch: string;
}

/** Sparse row index used to visit only cells intersecting the viewport. */
export class DisplayCellIndex {
  private rows = new Map<number, DisplayCell[]>();

  update(cells: readonly DisplayCell[]): void {
    this.rows.clear();
    for (const cell of cells) {
      let row = this.rows.get(cell.y);
      if (!row) this.rows.set(cell.y, row = []);
      row.push(cell);
    }
    for (const row of this.rows.values()) row.sort((a, b) => a.x - b.x);
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
