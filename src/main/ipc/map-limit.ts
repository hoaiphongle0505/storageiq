/**
 * Maps `items` with `fn`, never running more than `limit` calls at once. Results keep the order
 * of `items`. The first rejection rejects the whole call (calls already started still finish).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index] as T, index)
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(lanes)
  return results
}
