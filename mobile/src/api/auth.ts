import { api } from './client';

export type AuthUser = {
  id: number;
  name: string;
  mobile: string;
  email: string;
};

export type TokenPair = {
  access: string;
  refresh: string;
};

export type SignupPayload = {
  name: string;
  mobile: string;
  password: string;
  email?: string;
  consent: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /** Honeypot — a real caller never sets this. See app/signup.tsx. */
  website?: string;
};

export type SignupResponse = {
  id: number;
  name: string;
  mobile: string;
  email: string;
};

export function signup(payload: SignupPayload): Promise<SignupResponse> {
  return api('/auth/signup/', { method: 'POST', body: payload });
}

export function login(mobile: string, secret: string): Promise<TokenPair> {
  return api('/auth/login/', { method: 'POST', body: { mobile, secret } });
}

export function refresh(refreshToken: string): Promise<TokenPair> {
  return api('/auth/refresh/', { method: 'POST', body: { refresh: refreshToken } });
}

export async function logout(refreshToken: string): Promise<void> {
  await api('/auth/logout/', { method: 'POST', body: { refresh: refreshToken } });
}

export type MeResponse = {
  user: AuthUser;
  businesses: unknown[];
};

export function me(accessToken: string): Promise<MeResponse> {
  return api('/me/', { token: accessToken });
}
