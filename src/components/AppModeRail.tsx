import type { ReactNode } from 'react';

import { APP_BRAND } from '@/shared/brand';
import { useUIStore } from '@/store';

type RailButtonProps = {
  label: string;
  title: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
};

type RailItem = RailButtonProps & {
  id: 'chat' | 'workflow';
};

const RAIL_ITEMS: RailItem[] = [
  {
    id: 'chat',
    label: 'Chat',
    title: 'Open chat workspace',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M7 17H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4v-4z" />
      </svg>
    ),
  },
  {
    id: 'workflow',
    label: 'Flow',
    title: 'Open workflow canvas',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M17 7h.01M7 17h.01M9 7h6M7 9v6M17 9v2a4 4 0 01-4 4H9" />
        <rect x="4" y="4" width="6" height="6" rx="2" />
        <rect x="14" y="4" width="6" height="6" rx="2" />
        <rect x="4" y="14" width="6" height="6" rx="2" />
      </svg>
    ),
  },
];

function RailBrandMark({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={APP_BRAND.name}
      aria-label={APP_BRAND.name}
      className="group relative mt-10 flex h-12 w-12 items-center justify-center rounded-[18px] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.045)] ring-1 ring-[#e9e9e7] transition-[transform,box-shadow,background-color] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:shadow-[0_12px_26px_rgba(15,23,42,0.08)]"
    >
      <span className="absolute inset-[4px] overflow-hidden rounded-[14px] ring-1 ring-white/55">
        <img src={APP_BRAND.railIconSrc} alt="" className="h-full w-full object-cover" />
      </span>
      <span className="absolute bottom-[5px] right-[5px] h-2.5 w-2.5 rounded-full bg-[#ff8a76] ring-2 ring-white" />
      <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-xl bg-[#2f251a] px-3 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_16px_40px_rgba(47,37,26,0.2)] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
        {APP_BRAND.shortName}
      </span>
    </button>
  );
}

function RailButton({
  label,
  title,
  icon,
  active = false,
  onClick,
}: RailButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`group relative flex w-full flex-col items-center gap-1 rounded-[18px] px-2 py-3 transition-[background-color,color,box-shadow,transform] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] ${
        active
          ? 'bg-white text-[#2f251a] shadow-[0_12px_28px_rgba(15,23,42,0.065)] ring-1 ring-[#ece7df]'
          : 'text-[#8f7e67] hover:-translate-y-px hover:bg-white/78 hover:text-[#3b2f1f]'
      }`}
    >
      <span className={`transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${active ? 'text-[#2f251a]' : 'text-current group-hover:scale-[1.03]'}`}>
        {icon}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">{label}</span>
      {active && <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-[#d85b59]" />}
      <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-xl bg-[#2f251a] px-3 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-[0_16px_40px_rgba(47,37,26,0.2)] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
        {title}
      </span>
    </button>
  );
}

export function AppModeRail() {
  const currentView = useUIStore((state) => state.currentView);
  const setCurrentView = useUIStore((state) => state.setCurrentView);
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);
  const settingsOpen = useUIStore((state) => state.settingsOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const toggleSettings = useUIStore((state) => state.toggleSettings);

  const utilityItems: RailButtonProps[] = [
    {
      label: 'Nav',
      title: sidebarVisible ? 'Hide sidebar panel' : 'Show sidebar panel',
      active: sidebarVisible,
      onClick: toggleSidebar,
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h5M4 18h16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3-3 3" />
        </svg>
      ),
    },
    {
      label: 'Prefs',
      title: settingsOpen ? 'Close settings' : 'Open settings',
      active: settingsOpen,
      onClick: toggleSettings,
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a1 1 0 011.35-.936l.888.355a1 1 0 00.95-.07l.82-.548a1 1 0 011.36.24l.734.98a1 1 0 00.86.39l1.224-.06a1 1 0 011.04.91l.112 1.22a1 1 0 00.57.81l1.09.56a1 1 0 01.49 1.29l-.43 1.15a1 1 0 00.11.99l.69 1.01a1 1 0 01-.18 1.37l-.95.76a1 1 0 00-.36.93l.18 1.22a1 1 0 01-.84 1.11l-1.21.19a1 1 0 00-.75.65l-.46 1.14a1 1 0 01-1.3.47l-1.14-.46a1 1 0 00-.97.09l-1 .68a1 1 0 01-1.37-.2l-.75-.96a1 1 0 00-.92-.37l-1.23.17a1 1 0 01-1.1-.85l-.18-1.21a1 1 0 00-.66-.75l-1.13-.45a1 1 0 01-.48-1.31l.45-1.13a1 1 0 00-.09-.97l-.69-1a1 1 0 01.2-1.37l.95-.75a1 1 0 00.37-.92l-.17-1.23a1 1 0 01.85-1.1l1.2-.18a1 1 0 00.76-.66l.45-1.13z" />
          <circle cx="12" cy="12" r="3.25" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex h-full w-[68px] flex-col items-center bg-[#fbfbfa] px-2 py-3">
      <RailBrandMark onClick={() => setCurrentView('chat')} />

      <div className="mt-5 flex w-full flex-1 flex-col items-center gap-2">
        {RAIL_ITEMS.map((item) => {
          const active = currentView === item.id;

          return (
            <RailButton
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              active={active}
              label={item.label}
              title={item.title}
              icon={item.icon}
            />
          );
        })}
      </div>

      <div className="mb-2 mt-4 h-px w-9 bg-[#e9e9e7]" />

      <div className="flex w-full flex-col items-center gap-2">
        {utilityItems.map((item) => (
          <RailButton
            key={item.label}
            active={item.active}
            label={item.label}
            title={item.title}
            icon={item.icon}
            onClick={item.onClick}
          />
        ))}
      </div>
    </div>
  );
}

export default AppModeRail;