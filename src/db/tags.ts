import { supabase } from './client.js';

export interface Tag {
  id: string;
  name: string;
  type: 'predefined' | 'custom';
}

export async function getTagByName(name: string): Promise<Tag | null> {
  const { data, error } = await supabase
    .from('tags')
    .select('id, name, type')
    .eq('name', name.toLowerCase())
    .single();

  if (error || !data) {
    return null;
  }

  return data as Tag;
}

export async function createTag(name: string, type: 'predefined' | 'custom' = 'custom'): Promise<Tag> {
  const { data, error } = await supabase
    .from('tags')
    .insert({
      name: name.toLowerCase(),
      type,
    })
    .select('id, name, type')
    .single();

  if (error) {
    throw new Error(`Failed to create tag: ${error.message}`);
  }

  return data as Tag;
}

export async function getOrCreateTag(name: string): Promise<Tag> {
  const existing = await getTagByName(name);
  if (existing) {
    return existing;
  }
  return createTag(name, 'custom');
}

export async function getAllPredefinedTags(): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('tags')
    .select('id, name, type')
    .eq('type', 'predefined')
    .order('name');

  if (error) {
    console.error('Failed to get tags:', error);
    return [];
  }

  return (data || []) as Tag[];
}
