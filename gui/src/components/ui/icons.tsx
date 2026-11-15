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
export const IconChevronLeft = (p: IconProps) => <Svg {...p}><path d="M10 4L6 8l4 4" /></Svg>;
export const IconChevronUp = (p: IconProps) => <Svg {...p}><path d="M4 10l4-4 4 4" /></Svg>;
export const IconRail = (p: IconProps) => <Svg {...p}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6.25 2.5v11" /></Svg>;
export const IconFolder = (p: IconProps) => <Svg {...p}><path d="M2 4.5a1.5 1.5 0 0 1 1.5-1.5h2.75l1.5 1.75h4.75A1.5 1.5 0 0 1 14 6.25v5.25a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></Svg>;
export const IconHome = (p: IconProps) => <Svg {...p}><path d="M2.5 7.5L8 3l5.5 4.5" /><path d="M4 6.5v6.75h3V10h2v3.25h3V6.5" /></Svg>;
export const IconSubtask = (p: IconProps) => <Svg {...p}><path d="M3.5 2.5v6.5a2 2 0 0 0 2 2h4" /><path d="M8 8.75L10.25 11 8 13.25" /><rect x="10.5" y="9" width="3.5" height="4" rx="1" /></Svg>;
export const IconTag = (p: IconProps) => <Svg {...p}><path d="M2.25 2.25h5.5l6 6-5.5 5.5-6-6z" /><path d="M5.25 5.25h.01" /></Svg>;
export const IconFilter = (p: IconProps) => <Svg {...p}><path d="M2 3h12l-4.5 5.5v4.25L6.5 14V8.5z" /></Svg>;
export const IconDots = (p: IconProps) => <Svg {...p}><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.6} /></Svg>;
export const IconDownload = (p: IconProps) => <Svg {...p}><path d="M8 2.5v7.5M4.75 7l3.25 3.25L11.25 7M2.75 13.25h10.5" /></Svg>;
export const IconArrowUpRight = (p: IconProps) => <Svg {...p}><path d="M5 11l6-6M6 5h5v5" /></Svg>;
export const IconSort = (p: IconProps) => <Svg {...p}><path d="M5 3v10M2.75 10.75L5 13l2.25-2.25M11 13V3M8.75 5.25L11 3l2.25 2.25" /></Svg>;
export const IconLock = (p: IconProps) => <Svg {...p}><rect x="3" y="7" width="10" height="7" rx="1.75" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></Svg>;
export const IconGithub = ({ size = 16, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false" {...rest}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);
export const IconTerminal = (p: IconProps) => <Svg {...p}><rect x="1.75" y="2.5" width="12.5" height="11" rx="2" /><path d="M4.75 6.25L7 8.25l-2.25 2M8.5 10.5h3" /></Svg>;
export const IconChat = (p: IconProps) => <Svg {...p}><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M5.5 6.25h5M5.5 8.25h3" /></Svg>;
export const IconCopy = (p: IconProps) => <Svg {...p}><rect x="5.25" y="5.25" width="8.25" height="8.25" rx="1.75" /><path d="M10.75 5.25V3.75A1.25 1.25 0 0 0 9.5 2.5H3.75A1.25 1.25 0 0 0 2.5 3.75V9.5a1.25 1.25 0 0 0 1.25 1.25h1.5" /></Svg>;
export const IconFlow = (p: IconProps) => <Svg {...p}><rect x="1.75" y="2.5" width="4.5" height="3.5" rx="1" /><rect x="9.75" y="2.5" width="4.5" height="3.5" rx="1" /><rect x="5.75" y="10" width="4.5" height="3.5" rx="1" /><path d="M4 6v1.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6M8 8.5V10" /></Svg>;
export const IconFile = (p: IconProps) => <Svg {...p}><path d="M4 1.75h5l3.25 3.25v9.25H4z" /><path d="M9 1.75V5h3.25" /></Svg>;
export const IconPencil = (p: IconProps) => <Svg {...p}><path d="M10.5 2.5l3 3-8 8H2.5v-3z" /><path d="M9 4l3 3" /></Svg>;
/* Team roles (Ekipler) */
export const IconBriefcase = (p: IconProps) => <Svg {...p}><rect x="2" y="5" width="12" height="8.5" rx="1.5" /><path d="M5.75 5V3.5a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1V5M2 9h12" /></Svg>;
export const IconClipboard = (p: IconProps) => <Svg {...p}><rect x="3" y="3" width="10" height="11" rx="1.5" /><path d="M6 1.75h4v2.5H6zM5.75 7.5h4.5M5.75 10.5h3" /></Svg>;
export const IconCode = (p: IconProps) => <Svg {...p}><path d="M5.25 4.5L1.75 8l3.5 3.5M10.75 4.5L14.25 8l-3.5 3.5" /></Svg>;
export const IconShieldCheck = (p: IconProps) => <Svg {...p}><path d="M8 1.75l5 2v4c0 3-2.2 5.3-5 6.5-2.8-1.2-5-3.5-5-6.5v-4z" /><path d="M5.75 8.25l1.6 1.5 3-3" /></Svg>;
export const IconTeam = (p: IconProps) => <Svg {...p}><circle cx="6" cy="5.5" r="2.25" /><path d="M2 13.25c0-2.2 1.8-3.75 4-3.75s4 1.55 4 3.75" /><path d="M10.5 3.4a2.25 2.25 0 0 1 0 4.2M11.75 9.8c1.4.45 2.25 1.7 2.25 3.45" /></Svg>;
// Team editor: "make default" and "save as template"
export const IconStar = (p: IconProps) => <Svg {...p}><path d="M8 2.25l1.7 3.6 3.9.5-2.85 2.7.7 3.9L8 11.1l-3.45 1.85.7-3.9L2.4 6.35l3.9-.5z" /></Svg>;
export const IconUpload = (p: IconProps) => <Svg {...p}><path d="M8 10.5V3M4.75 6.25L8 3l3.25 3.25M2.75 13.25h10.5" /></Svg>;
