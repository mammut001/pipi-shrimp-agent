import { getSupportedLocales, t } from '@/i18n';

type AppearanceSettingsProps = {
  theme: 'light' | 'dark';
  language: string;
  onThemeChange: (theme: 'light' | 'dark') => void;
  onLanguageChange: (language: string) => void;
};

export function AppearanceSettings({
  theme,
  language,
  onThemeChange,
  onLanguageChange,
}: AppearanceSettingsProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('settings.appearance')}</h2>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.theme')}</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={theme === 'light'}
              onChange={() => onThemeChange('light')}
              className="text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">{t('common.light')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={theme === 'dark'}
              onChange={() => onThemeChange('dark')}
              className="text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">{t('common.dark')}</span>
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.language')}</label>
        <div className="flex gap-4">
          {getSupportedLocales().map((locale) => (
            <label key={locale.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="language"
                value={locale.value}
                checked={language === locale.value}
                onChange={() => onLanguageChange(locale.value)}
                className="text-gray-900 focus:ring-gray-900"
              />
              <span className="text-sm text-gray-700">{locale.flag} {locale.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
