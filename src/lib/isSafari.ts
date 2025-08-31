const ua = navigator.userAgent
const vendor = navigator.vendor
export const isSafari = /safari/i.test(ua) && /apple computer/i.test(vendor) && !/chrome|chromium|crios|edg|firefox|brave/i.test(ua)