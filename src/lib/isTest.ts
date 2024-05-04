export const isTest = typeof window !== 'undefined' && (new URL(window.location.href)).pathname.includes('test')
