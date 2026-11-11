// Pages of the "Your lessons" list on the Study home page.
export const LESSONS_PER_PAGE = 15;

// Page buttons to show (0-based), with null for a gap: the first and last
// pages, and the ones around the current page.
export function pageNumbers(page, pages) {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages));
  if (page <= 2) [1, 2, 3].forEach((p) => p < pages && keep.add(p));
  if (page >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach((p) => p >= 0 && keep.add(p));
  const out = [];
  [...keep].sort((a, b) => a - b).forEach((p, i, a) => {
    if (i && p - a[i - 1] > 1) out.push(p - a[i - 1] === 2 ? p - 1 : null);
    out.push(p);
  });
  return out;
}
