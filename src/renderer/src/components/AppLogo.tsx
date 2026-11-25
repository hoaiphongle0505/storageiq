/**
 * The StorageIQ logo: the master artwork of build/icon.svg as inline SVG (no asset to load, so the
 * CSP stays as it is). AppLogo.test.tsx compares it with the file, so the two cannot drift.
 */
export function AppLogo({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.75"
        y="2.75"
        width="58.5"
        height="58.5"
        rx="13.25"
        fill="#1b1b1b"
        stroke="#4a4a4a"
        strokeWidth="1.5"
      />
      <path
        d="M44.92 18.4H25.2a6.8 6.8 0 0 0 0 13.6"
        fill="none"
        stroke="#ffffff"
        strokeWidth="8.16"
        strokeLinecap="round"
      />
      <path d="M27.58 32h8.84" stroke="#c8102e" strokeWidth="8.16" />
      <path
        d="M38.8 32a6.8 6.8 0 0 1 0 13.6H19.08"
        fill="none"
        stroke="#ffffff"
        strokeWidth="8.16"
        strokeLinecap="round"
      />
    </svg>
  )
}
