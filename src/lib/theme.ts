export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export const normalizeTheme = (value: unknown): ThemePreference => value === 'light' || value === 'dark' ? value : 'system'
export const resolveTheme = (preference: ThemePreference, prefersDark: boolean): ResolvedTheme => preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference
