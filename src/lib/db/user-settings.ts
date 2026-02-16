import { supabase } from '@/lib/supabase';

export interface UserSettings {
  user_id: string;
  sidebar_width: number;
  updated_at: string;
}

export const userSettingsApi = {
  async get(userId: string): Promise<UserSettings | null> {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // no rows
      throw error;
    }
    return data as UserSettings;
  },

  async upsertSidebarWidth(userId: string, sidebarWidth: number): Promise<void> {
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          sidebar_width: Math.round(sidebarWidth),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (error) throw error;
  },
};
