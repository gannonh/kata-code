export function AppMark({ className }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden
      className={className ?? "size-5 shrink-0 object-contain"}
      src="/apple-touch-icon.png"
    />
  );
}
