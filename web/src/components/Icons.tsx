// One stroke family for every icon: 1.75px round strokes on a 20px grid.

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Svg>
  );
}

export function AxisIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7h13M13 4l3 3-3 3M17 13H4M7 10l-3 3 3 3" />
    </Svg>
  );
}

export function UpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12l5-5 5 5" />
    </Svg>
  );
}

export function DownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 8l5 5 5-5" />
    </Svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10h12M11 5l5 5-5 5" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17 17" />
    </Svg>
  );
}
