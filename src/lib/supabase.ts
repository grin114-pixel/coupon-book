import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: string
          pin_hash: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          pin_hash: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          pin_hash?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          id: string
          name: string
          amount: number
          expires_at: string
          is_recurring: boolean
          image_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          amount: number
          expires_at: string
          is_recurring?: boolean
          image_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          amount?: number
          expires_at?: string
          is_recurring?: boolean
          image_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const storageBucket = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'coupon-images'

let supabaseClient: SupabaseClient<Database> | null = null

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL 또는 Anon Key가 비어 있어요.')
  }

  if (!supabaseClient) {
    supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey)
  }

  return supabaseClient
}
