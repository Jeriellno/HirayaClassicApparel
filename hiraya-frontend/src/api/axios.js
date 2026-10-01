import axios from 'axios';
import { reportRequestSuccess, reportRequestFailure, isBackendReachable } from '../utils/backendHealth';
import { supabase } from '../services/supabase';

// Helper to guarantee a clean API Base URL ending with '/api'
const normalizeBaseUrl = (rawUrl) => {
  const url = (rawUrl || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  return url.endsWith('/api') ? url : `${url}/api`;
};

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

const TIMEOUTS = {
  DEFAULT: 15000,
  AUTH: 20000,
  NOTIFICATIONS: 30000,
  HEAVY_DATA: 45000,
  STATUS: 8000,
  AI_TRYON: 180000,
  AI_ANALYSIS: 300000,
};

const AUTH_ENDPOINTS = [
  '/login',
  '/register',
  '/check-email',
  '/reset-password-direct',
  '/forgot-password',
  '/validate-reset-token',
];

const TIMEOUT_RULES = [
  { pattern: /\/try-?on\/history/, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/try-?on/, timeout: TIMEOUTS.AI_TRYON },
  { pattern: /\/analyze-image/, timeout: TIMEOUTS.AI_ANALYSIS },
  { pattern: /\/notifications/, timeout: TIMEOUTS.NOTIFICATIONS },
  { pattern: /\/(measurements|outfits\/recommended|cart|wishlist)/, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/admin\/analytics\//, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/admin\/orders/, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/system-status/, timeout: TIMEOUTS.STATUS },
  { pattern: /\/admin\/api-status/, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/admin\/(accounts|settings|audit-logs|feedbacks)/, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/admin\/customers/, timeout: TIMEOUTS.HEAVY_DATA },
  { pattern: /\/products/, timeout: TIMEOUTS.HEAVY_DATA },
];

const isAuthEndpoint = (url = '') =>
  AUTH_ENDPOINTS.some((endpoint) => String(url).includes(endpoint));

const isAdminPath = (url = '') => /(^|\/)(api\/)?admin(\/|$|\?)/.test(String(url));

const CATALOG_WRITE_PATH = /^\/products\/?$/;
const CATALOG_WRITE_ITEM_PATH = /^\/products\/[^/]+\/?$/;
const CATALOG_WRITE_VERBS = new Set(['post', 'put', 'patch', 'delete']);
const PUBLIC_CATALOG_SUBROUTES = new Set(['spotlight', 'track-canvas', 'track-tryon']);

const isCatalogWrite = (method = '', url = '') => {
  const verb = String(method).toLowerCase();
  if (!CATALOG_WRITE_VERBS.has(verb)) return false;

  const path = String(url).split('?')[0].replace(/^.*\/api/, '');
  if (CATALOG_WRITE_PATH.test(path)) return true;
  if (!CATALOG_WRITE_ITEM_PATH.test(path)) return false;

  return !PUBLIC_CATALOG_SUBROUTES.has(path.split('/')[2] || '');
};

const needsSupabaseToken = (config = {}) =>
  isAdminPath(config?.url) || isCatalogWrite(config?.method, config?.url);

const getTimeoutForUrl = (url = '') => {
  const target = String(url);
  if (isAuthEndpoint(target)) return TIMEOUTS.AUTH;
  const matchedRule = TIMEOUT_RULES.find((rule) => rule.pattern.test(target));
  return matchedRule ? matchedRule.timeout : TIMEOUTS.DEFAULT;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: TIMEOUTS.DEFAULT,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

export const getAuthToken = () =>
  localStorage.getItem('token') || sessionStorage.getItem('token');

export const clearStoredSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
};

export const parseApiError = (error) => {
  if (error?.isAuthError || (error?.status !== undefined && error?.errors !== undefined)) {
    return {
      status: error.status ?? 0,
      message: error.message || 'Something went wrong. Please try again.',
      errors: error.errors || {},
      isTimeout: !!error.isTimeout,
      isCanceled: !!error.isCanceled,
      isNetworkError: !!error.isNetworkError,
      isServerError: (error.status ?? 0) >= 500,
    };
  }

  const status = error?.response?.status ?? 0;
  const data = error?.response?.data;
  const isTimeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
  const isCanceled =
    error?.code === 'ERR_CANCELED' ||
    error?.name === 'CanceledError' ||
    error?.name === 'AbortError';
  const isNetworkError =
    !isCanceled && (error?.code === 'ERR_NETWORK' || (!error?.response && !isTimeout));

  const rawErrors = data?.errors;
  const errors = {};
  if (rawErrors && typeof rawErrors === 'object') {
    Object.entries(rawErrors).forEach(([field, messages]) => {
      errors[field] = Array.isArray(messages) ? messages[0] : String(messages);
    });
  }

  let message =
    data?.message ||
    (typeof data === 'string' && data ? data : '') ||
    error?.message ||
    'Something went wrong. Please try again.';

  if (isTimeout) {
    message = 'The Hiraya server took too long to respond.';
  } else if (isCanceled) {
    message = 'That request was cancelled before it finished. Please try again.';
  } else if (isNetworkError) {
    message = 'Cannot reach the Hiraya server.';
  } else if (status === 401 && Object.keys(errors).length === 0) {
    message = data?.message || 'Invalid credentials or session expired.';
  }

  return {
    status,
    message,
    errors,
    isTimeout,
    isCanceled,
    isNetworkError,
    isServerError: status >= 500,
  };
};

// Request Interceptor
api.interceptors.request.use(
  async (config) => {
    // Normalize relative path slashes
    if (config.url) {
      config.url = config.url.replace(/^\/+/, '');
    }

    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (needsSupabaseToken(config)) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error('ADMIN SUPABASE SESSION ERROR:', error);
        }

        const accessToken = data?.session?.access_token;
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        } else {
          console.warn(
            'No Supabase session for an AAL2-gated request. Sending the last known token.',
            { method: config.method, url: config.url }
          );
        }
      } catch (error) {
        console.error('Could not read the Supabase session for an AAL2-gated request.', error);
      }
    }

    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    } else {
      config.headers['Accept'] = 'application/json';
      config.headers['Content-Type'] = 'application/json';
    }

    config.timeout = config.explicitTimeout || getTimeoutForUrl(config.url);

    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => {
    reportRequestSuccess();
    return response;
  },
  (error) => {
    const url = error?.config?.url ?? '';
    const status = error?.response?.status ?? 0;
    const data = error?.response?.data;

    if (data && typeof data === 'object') {
      const raw = String(data.message || '');
      const isTechnical = /SQLSTATE|Exception|Stack trace|\.php|SQL|syntax error|Undefined (array key|variable|property)|Call to|cURL error/i.test(raw);
      
      if (status === 500 || isTechnical) {
        data.message = 'Something went wrong on our side. Please try again in a moment.';
        delete data.error;
        delete data.exception;
        delete data.trace;
        delete data.file;
        delete data.line;
      }
    }

    if (status === 401 && isAdminPath(url)) {
      console.error('====================================');
      console.error('ADMIN API 401');
      console.error('URL:', url);
      console.error('STATUS:', status);
      console.error('RESPONSE:', error?.response?.data);
      console.error('HEADERS:', error?.response?.headers);
      console.error('====================================');
    }

    if (status === 401 && needsSupabaseToken(error?.config)) {
      const message = error?.response?.data?.message || '';

      if (/access token is required|legacy login token|Invalid or expired session token/i.test(message)) {
        const explanation =
          'Your admin session has expired or was not completed. Please sign in again (including your 2-step verification) before saving.';

        console.error('AAL2-gated request rejected — the Supabase session was missing or stale.', {
          method: error?.config?.method,
          url: error?.config?.url,
          backendMessage: message,
        });

        error.response.data.message = explanation;
        error.response.data.backend_message = message;
      }
    }

    reportRequestFailure(error);

    if (status === 401 && url?.includes('/user') && !isAuthEndpoint(url)) {
      clearStoredSession();
    }

    if (status === 403 && needsSupabaseToken(error?.config) && !isAuthEndpoint(url)) {
      console.warn('Admin request returned 403:', url, error?.response?.data);
    }

    return Promise.reject(error);
  }
);

export { isBackendReachable };
export default api;