import { apiRequest } from './client';

/** `GET /me/permissions` — real, server-recomputed on every call (never
 * cached in a JWT). See ADR-018 decision 2. */
export async function getMyPermissions(): Promise<string[]> {
  const result = await apiRequest<{ permissions: string[] }>('/me/permissions');
  return result.permissions;
}

export interface UserProfile {
  id: string;
  phone?: string;
  email?: string | null;
  createdAt: string;
}

export async function getUserById(id: string): Promise<UserProfile> {
  return apiRequest<UserProfile>(`/users/${id}`);
}
