import type { GlobalThemeOverrides } from 'naive-ui'

export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    bodyColor: '#111318',
    cardColor: '#191c22',
    modalColor: '#191c22',
    popoverColor: '#20242b',
    tableColor: '#191c22',
    tableHeaderColor: '#1f232a',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    dividerColor: 'rgba(255, 255, 255, 0.08)',
    textColor1: 'rgba(255, 255, 255, 0.92)',
    textColor2: 'rgba(255, 255, 255, 0.72)',
    textColor3: 'rgba(255, 255, 255, 0.52)'
  }
}

export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    bodyColor: '#f4f6f8',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff',
    tableColor: '#ffffff',
    tableHeaderColor: '#f7f8fa',
    borderColor: 'rgba(15, 23, 42, 0.11)',
    dividerColor: 'rgba(15, 23, 42, 0.09)',
    textColor1: 'rgba(15, 23, 42, 0.92)',
    textColor2: 'rgba(15, 23, 42, 0.72)',
    textColor3: 'rgba(15, 23, 42, 0.52)'
  }
}
