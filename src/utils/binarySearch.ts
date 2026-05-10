/** First index where arr[i][key] >= x (arr sorted ascending by key accessor). */
export function lowerBoundBy<T>(
  arr: readonly T[],
  x: number,
  key: (item: T) => number,
): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
