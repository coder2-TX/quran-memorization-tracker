export const APP_CONFIG = Object.freeze({
  name: 'متابعة حفظ القرآن',
  shortName: 'متابعة الحفظ',
  description: 'متابعة حفظ القرآن الكريم للطلاب بدون إنترنت',
  version: '6.5.0',
  logo: './assets/images/logo.svg',
  theme: {
    primary: '#FF9D50',
    secondary: '#B1E5E6',
    text: '#111111',
    background: '#F8F9FA',
    surface: '#FFFFFF',
    muted: '#6B7280',
    border: '#E7E7E7',
    success: '#2E7D59',
    danger: '#B42318',
  },
  font: {
    family: 'Somar Sans',
    fallback: 'Tahoma, Arial, sans-serif',
  },
  quran: {
    totalPages: 604,
    totalSurahs: 114,
    mapUrl: './data/quran-map.json',
  },
});
