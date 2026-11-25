/** Line icons, drawn on a 24px grid and coloured by the surrounding text. */

import type { ReactNode } from "react";

function Icon({ children, className = "size-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

type Props = { className?: string };

export const HomeIcon = (p: Props) => (
  <Icon {...p}><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /></Icon>
);
export const PhoneOutIcon = (p: Props) => (
  <Icon {...p}><path d="M6 4h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.500-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-2Z" /><path d="M15 4h5v5M20 4l-5 5" /></Icon>
);
export const ListIcon = (p: Props) => (
  <Icon {...p}><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></Icon>
);
export const HashIcon = (p: Props) => (
  <Icon {...p}><path d="M9 4 7 20M17 4l-2 16M5 9h15M4 15h15" /></Icon>
);
export const SoundIcon = (p: Props) => (
  <Icon {...p}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></Icon>
);
export const WalletIcon = (p: Props) => (
  <Icon {...p}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M16 14.500h2" /></Icon>
);
export const SettingsIcon = (p: Props) => (
  <Icon {...p}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Icon>
);
export const LogOutIcon = (p: Props) => (
  <Icon {...p}><path d="M14 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8M10 12h10M17 9l3 3-3 3" /></Icon>
);
export const MenuIcon = (p: Props) => (
  <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
);
export const ChevronIcon = (p: Props) => (
  <Icon {...p}><path d="m7 10 5 5 5-5" /></Icon>
);
export const PlusIcon = (p: Props) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const PlayIcon = (p: Props) => (
  <Icon {...p}><path d="M8 5.5v13l10-6.500-10-6.500Z" /></Icon>
);
export const PauseIcon = (p: Props) => (
  <Icon {...p}><path d="M9 6v12M15 6v12" /></Icon>
);
export const StopIcon = (p: Props) => (
  <Icon {...p}><rect x="7" y="7" width="10" height="10" rx="1.500" /></Icon>
);
export const TrashIcon = (p: Props) => (
  <Icon {...p}><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></Icon>
);
export const EditIcon = (p: Props) => (
  <Icon {...p}><path d="M5 19h4L19 9l-4-4L5 15v4ZM13.500 6.500l4 4" /></Icon>
);
