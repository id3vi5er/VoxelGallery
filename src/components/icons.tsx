import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const IconBase = ({ children, ...props }: IconProps) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {children}
  </svg>
);

export const FolderPlusIcon = (props: IconProps) => <IconBase {...props}><path d="M3 19V6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5V19a1.5 1.5 0 0 1-1.5 1h-15A1.5 1.5 0 0 1 3 19Z"/><path d="M12 10v6m-3-3h6"/></IconBase>;
export const SearchIcon = (props: IconProps) => <IconBase {...props}><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></IconBase>;
export const RefreshIcon = (props: IconProps) => <IconBase {...props}><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .7-7.6L20 12"/></IconBase>;
export const CubeIcon = (props: IconProps) => <IconBase {...props}><path d="m12 2.8 8 4.5v9.4l-8 4.5-8-4.5V7.3Z"/><path d="m4 7.3 8 4.5 8-4.5M12 21.2v-9.4"/></IconBase>;
export const GridIcon = (props: IconProps) => <IconBase {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></IconBase>;
export const CloseIcon = (props: IconProps) => <IconBase {...props}><path d="m6 6 12 12M18 6 6 18"/></IconBase>;
export const TrashIcon = (props: IconProps) => <IconBase {...props}><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></IconBase>;
export const ExternalIcon = (props: IconProps) => <IconBase {...props}><path d="M14 4h6v6m0-6-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></IconBase>;
export const ResetIcon = (props: IconProps) => <IconBase {...props}><path d="M4 8V3m0 0h5M4 3l4 4a8 8 0 1 1-2.2 8"/></IconBase>;
export const SettingsIcon = (props: IconProps) => <IconBase {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></IconBase>;
export const TreeIcon = (props: IconProps) => <IconBase {...props}><path d="M12 21v-4"/><path d="M12 3 7.5 9.5h2.2L6 15h12l-3.7-5.5h2.2Z"/><path d="M9 17h6"/></IconBase>;
export const DiceIcon = (props: IconProps) => <IconBase {...props}><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/></IconBase>;
export const WandIcon = (props: IconProps) => <IconBase {...props}><path d="m4 20 11-11m-8 8 3 3M14 4l.6 1.7L16 7l-1.4.6L14 9l-.6-1.4L12 7l1.4-.6ZM19 10l.5 1.5L21 12l-1.5.5L19 14l-.5-1.5L17 12l1.5-.5Z"/></IconBase>;
