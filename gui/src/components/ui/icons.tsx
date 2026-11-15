import type { SVGProps } from "react";

/**
 * Small hand-tuned stroke icon set for the Atölye primitives.
 * 16px grid, 2px stroke, round caps — matches the 2px ink rules.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>;
export const IconClose = (p: IconProps) => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="M3 8.5l3.2 3L13 4.5" /></Svg>;
export const IconChevronDown = (p: IconProps) => <Svg {...p}><path d="M4 6l4 4 4-4" /></Svg>;
export const IconChevronRight = (p: IconProps) => <Svg {...p}><path d="M6 4l4 4-4 4" /></Svg>;
export const IconSearch = (p: IconProps) => <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2L13.5 13.5" /></Svg>;
export const IconBolt = (p: IconProps) => <Svg {...p}><path d="M9 1.75L3.5 9h4l-1 5.25L12.5 7h-4z" /></Svg>;
export const IconPlay = (p: IconProps) => <Svg {...p}><path d="M5 3.5v9l7-4.5z" /></Svg>;
export const IconStop = (p: IconProps) => <Svg {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" /></Svg>;
export const IconRetry = (p: IconProps) => <Svg {...p}><path d="M13 8a5 5 0 1 1-1.6-3.7" /><path d="M13 2.5v3h-3" /></Svg>;
export const IconTrash = (p: IconProps) => <Svg {...p}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Svg>;
export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v2M8 12.25v2M14.25 8h-2M3.75 8h-2M12.4 3.6L11 5M5 11l-1.4 1.4M12.4 12.4L11 11M5 5L3.6 3.6" />
  </Svg>
);
export const IconBranch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-3 3-7 4" />
  </Svg>
);
export const IconPR = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="12.5" r="1.5" />
    <path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
  </Svg>
);
export const IconEye = (p: IconProps) => <Svg {...p}><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></Svg>;
export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </Svg>
);
export const IconMoon = (p: IconProps) => <Svg {...p}><path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z" /></Svg>;
export const IconAlert = (p: IconProps) => <Svg {...p}><path d="M8 2l6.25 11H1.75z" /><path d="M8 6.5v3M8 11.6v.01" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 7.25v4M8 4.9v.01" /></Svg>;
export const IconCoin = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M10 5.75H7.25a1.25 1.25 0 0 0 0 2.5h1.5a1.25 1.25 0 0 1 0 2.5H6M8 4.5v1.25M8 10.75V12" /></Svg>;
export const IconClock = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.75V8l2.25 1.5" /></Svg>;
export const IconBoard = (p: IconProps) => <Svg {...p}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11M10 2.5v7" /></Svg>;
export const IconList = (p: IconProps) => <Svg {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" /></Svg>;
export const IconFactory = (p: IconProps) => <Svg {...p}><path d="M1.75 14V7l4 2.5V7l4 2.5V3.5h4.5V14z" /><path d="M5 14v-2.5M8.5 14v-2.5" /></Svg>;
export const IconChart = (p: IconProps) => <Svg {...p}><path d="M2 14h12M4.5 11V8M8 11V4.5M11.5 11V6.5" /></Svg>;
export const IconBell = (p: IconProps) => <Svg {...p}><path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.25 1.25H2.75z" /><path d="M6.5 14.25h3" /></Svg>;
export const IconRobot = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="10" height="8" rx="2" />
    <path d="M8 5V2.75M6 9h.01M10 9h.01M6.25 11.25h3.5M1.5 8.5v2M14.5 8.5v2" />
  </Svg>
);
export const IconSpinner = ({ size = 16, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false" className="ui-spin" {...rest}>
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
