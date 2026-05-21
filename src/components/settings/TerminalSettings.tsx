import type { WindowsShellProfile } from '@/types/settings';
import { t } from '@/i18n';
import { isWindowsPlatform } from '@/utils/windowsShellProfile';

type TerminalSettingsProps = {
  windowsShellProfile: WindowsShellProfile;
  onChange: (profile: WindowsShellProfile) => void;
};

export function TerminalSettings({ windowsShellProfile, onChange }: TerminalSettingsProps) {
  if (!isWindowsPlatform()) {
    return null;
  }

  const descriptionMap: Record<WindowsShellProfile, string> = {
    auto: t('settings.terminal.windowsShellProfile.autoDescription'),
    powershell: t('settings.terminal.windowsShellProfile.powershellDescription'),
    wsl: t('settings.terminal.windowsShellProfile.wslDescription'),
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        {t('settings.terminal.windowsShellProfile.title')}
      </h2>

      <div className="flex flex-col gap-2">
        {([
          ['auto', t('settings.terminal.windowsShellProfile.auto')],
          ['powershell', t('settings.terminal.windowsShellProfile.powershell')],
          ['wsl', t('settings.terminal.windowsShellProfile.wsl')],
        ] as Array<[WindowsShellProfile, string]>).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="windowsShellProfile"
              value={value}
              checked={windowsShellProfile === value}
              onChange={() => onChange(value)}
              className="text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        {descriptionMap[windowsShellProfile]}
      </p>

      {windowsShellProfile !== 'powershell' && (
        <p className="text-xs text-gray-500 mt-2">
          {t('terminal.shell.powerShellRecommended')}
        </p>
      )}

      {windowsShellProfile === 'wsl' && (
        <p className="text-xs text-amber-600 mt-2">
          {t('terminal.shell.wslWarning')}
        </p>
      )}
    </div>
  );
}

export default TerminalSettings;
