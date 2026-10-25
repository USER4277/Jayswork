interface Props {
  lines: string[]
}

/**
 * ASCII 图形（一笔画那题）。
 * 必须用等宽字体渲染，否则竖线会错位。
 */
export default function AsciiFigure({ lines }: Props) {
  if (!lines?.length) return null
  return (
    <pre className="inline-block rounded-lg border border-[var(--color-line)] bg-white px-4 py-3 font-mono text-[15px] leading-tight text-[var(--color-ink)]">
      {lines.join('\n')}
    </pre>
  )
}
