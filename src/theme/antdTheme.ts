import type { ThemeConfig } from 'antd';

export const antdThemeTokens: ThemeConfig = {
  token: {
    colorPrimary: '#242424',
    colorInfo: '#242424',
    colorSuccess: '#17703F',
    colorWarning: '#8A6400',
    colorError: '#B3382C',
    colorTextBase: '#242424',
    colorTextSecondary: '#777777',
    colorBgBase: '#FFFFFF',
    fontFamily: "var(--font-geist-sans), 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    borderRadius: 8,
    wireframe: false,
  },
  components: {
    Button: {
      colorPrimary: '#242424',
      colorPrimaryHover: '#3A3A3A',
      colorPrimaryActive: '#141414',
      borderRadius: 8,
      controlHeight: 36,
      fontWeight: 500,
    },
    Table: {
      headerBg: '#F2F3F2',
      headerColor: '#242424',
      rowHoverBg: '#F8F9FA',
      borderColor: '#E5E7E8',
      fontSize: 13,
    },
    Card: {
      colorBgContainer: '#FFFFFF',
      colorBorderSecondary: '#E5E7E8',
      borderRadiusLG: 8,
    },
    Menu: {
      itemBg: 'transparent',
      itemColor: '#242424',
      itemHoverColor: '#242424',
      itemHoverBg: '#E9EBE9',
      itemSelectedColor: '#242424',
      itemSelectedBg: '#FFF4C2',
      fontSize: 13,
      itemBorderRadius: 8,
    },
    Tag: {
      borderRadiusSM: 4,
    },
  },
};
