import { supabase } from '@/lib/supabase';

export interface UserSettings {
  owner_id: string;
  sidebar_width: number;
  copy_include_evidence: boolean;
  updated_at: string;
}

export const userSettingsApi = {
  async get(userId: string): Promise<UserSettings | null> {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('owner_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // no rows
      throw error;
    }
    return data as UserSettings;
  },

  async upsertSidebarWidth(userId: string, sidebarWidth: number): Promise<void> {
    const current = await this.get(userId);
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        {
          owner_id: userId,
          sidebar_width: Math.round(sidebarWidth),
          copy_include_evidence: current?.copy_include_evidence ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_id' }
      );

    if (error) throw error;
  },

  async upsertCopyIncludeEvidence(userId: string, copyIncludeEvidence: boolean): Promise<void> {
    const current = await this.get(userId);
    const { error } = await supabase
      .from('user_settings')
      .upsert(
        {
          owner_id: userId,
          sidebar_width: current?.sidebar_width ?? 600,
          copy_include_evidence: copyIncludeEvidence,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_id' }
      );

    if (error) throw error;
  },
};
