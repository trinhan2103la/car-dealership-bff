/** Đăng nhập tối đa 10 lần / 60 s / IP (api-overview); refresh tối đa 30 lần / 60 s / IP. */
export const LOGIN_THROTTLER = 'login';
export const REFRESH_THROTTLER = 'refresh';
export const LOGIN_RATE_LIMIT_DEFAULT = 10;
export const REFRESH_RATE_LIMIT_DEFAULT = 30;
export const RATE_WINDOW_MS_DEFAULT = 60_000;
