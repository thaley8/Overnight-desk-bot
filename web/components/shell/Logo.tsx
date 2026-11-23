import { cx } from "@/lib/format";

/** Overnight Desk mark: a crescent cut from the night, with a single candle standing in the cut. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={cx("shrink-0", className)} aria-hidden>
      <defs>
        <mask id="od-crescent">
          <rect width="28" height="28" fill="white" />
          <circle cx="17.2" cy="10.6" r="6.6" fill="black" />
        </mask>
      </defs>
      <rect x="0.5" y="0.5" width="27" height="27" rx="7.5" fill="#111E30" stroke="rgba(148,178,220,0.24)" />
      <circle cx="12.4" cy="14.4" r="7.6" fill="#398BFF" mask="url(#od-crescent)" />
      <line x1="19.6" y1="12.2" x2="19.6" y2="22.6" stroke="#35D5E8" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="18.1" y="14.6" width="3" height="4.8" rx="0.8" fill="#35D5E8" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("whitespace-nowrap text-[14px] tracking-[-0.01em]", className)}>
      <span className="font-semibold text-fg">Overnight</span>
      <span className="font-normal text-fg-3"> Desk</span>
    </span>
  );
}
