export type AuthUser = {
  id: string
  email: string
  role: string
  email_verified: boolean
  full_name?: string | null
  username?: string | null
  avatar_url?: string | null
  created_at?: string | null
}

export type MeResponse = {
  user: AuthUser | null
  auth_required: boolean
}

export type AdminUser = {
  id: string
  email: string
  role: string
  is_active: boolean
  email_verified: boolean
  is_online?: boolean
  full_name?: string | null
  username?: string | null
  avatar_url?: string | null
  created_at?: string | null
  last_login_at?: string | null
  last_seen_at?: string | null
}

export type AdminUsersResponse = {
  stats: {
    total_users: number
    verified_users: number
    online_users: number
    admin_users: number
  }
  users: AdminUser[]
}
