/** The Fewer mark (docs/assets/logo.svg): ink tile, two soft rings, the paper circle with a check. Decorative next to the wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden focusable="false" className={className}>
      <rect width="256" height="256" rx="56" fill="#1b1f23" />
      <g fill="none" stroke="#f6f4ef" strokeWidth="9" opacity="0.5">
        <circle cx="58" cy="128" r="24" />
        <circle cx="198" cy="128" r="24" />
      </g>
      <circle cx="128" cy="128" r="31" fill="#f6f4ef" />
      <path d="M114 128.5l9.5 9.5 18-20" fill="none" stroke="#1b1f23" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
