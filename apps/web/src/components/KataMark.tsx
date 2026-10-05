import type { SVGProps } from "react";

export function KataMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 44 46" xmlns="http://www.w3.org/2000/svg">
      <g fill="currentColor">
        <rect width="44" height="7" rx="3.5" />
        <rect y="15" width="24" height="7" rx="3.5" />
        <rect x="18" y="7" width="7" height="15" rx="3.5" />
        <rect y="30" width="44" height="7" rx="3.5" />
        <rect x="18" y="37" width="7" height="9" rx="3.5" />
      </g>
    </svg>
  );
}
