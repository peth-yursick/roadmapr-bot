import { supabase } from './client.js';

export async function checkProcessed(castHash: string): Promise<boolean> {
  const { data } = await supabase
    .from('bot_mentions')
    .select('id')
    .eq('cast_hash', castHash)
    .single();

  return !!data;
}

export async function checkRateLimited(fid: number): Promise<boolean> {
  const limit = parseInt(process.env.RATE_LIMIT_PER_USER_DAILY || '20');

  const { data } = await supabase
    .from('bot_mention_rate_limit')
    .select('mentions_today')
    .eq('mention_author_fid', fid)
    .single();

  return (data?.mentions_today || 0) >= limit;
}

export async function logBotMention(
  castHash: string,
  authorFid: number,
  parentCastHash: string | null,
  details: {
    parent_cast_author_fid?: number;
    parent_cast_text?: string;
    detected_projects?: string[];
    features_created?: number;
    features_merged?: number;
    error?: string;
  }
) {
  const { error } = await supabase
    .from('bot_mentions')
    .insert({
      cast_hash: castHash,
      mention_author_fid: authorFid,
      parent_cast_hash: parentCastHash,
      parent_cast_author_fid: details.parent_cast_author_fid || null,
      parent_cast_text: details.parent_cast_text || null,
      detected_projects: details.detected_projects || null,
      features_created: details.features_created || 0,
      features_merged: details.features_merged || 0,
      error_message: details.error || null,
    });

  if (error) {
    console.error('Failed to log bot mention:', error);
  }
}
