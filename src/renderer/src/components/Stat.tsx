/** One label/value pair inside a `<dl>`. `title` carries the exact value (e.g. bytes). */
export function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  )
}
