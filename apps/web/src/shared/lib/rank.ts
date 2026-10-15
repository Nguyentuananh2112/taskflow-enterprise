// Thứ tự task trong cột (frontend.md §4.3, data-and-api §4.4-5): so sánh theo code unit, khớp
// collation "C" của Postgres với chuỗi ASCII của fractional-indexing. CẤM `localeCompare`
// (xếp "a" trước "B" — lệch với server).

export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Sắp theo `rank`, hòa thì theo `id` — giống `ORDER BY rank, id` của API. */
export function compareByRank(
  a: Readonly<{ rank: string; id: string }>,
  b: Readonly<{ rank: string; id: string }>,
): number {
  return compareCodeUnits(a.rank, b.rank) || compareCodeUnits(a.id, b.id);
}
