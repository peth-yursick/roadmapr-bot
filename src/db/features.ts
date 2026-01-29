import { supabase } from './client.js';

interface CreateFeatureParams {
  project_id: string;
  title: string;
  description: string;
  submitter_fid: number;
  source_cast_hash?: string;
  source_cast_author_fid?: number;
  parent_feature_id?: string;
  is_sub_item?: boolean;
  tags?: string[];
}

export async function createFeature(params: CreateFeatureParams): Promise<string> {
  const { data, error } = await supabase
    .from('features')
    .insert({
      project_id: params.project_id,
      title: params.title,
      description: params.description,
      submitter_fid: params.submitter_fid,
      source_cast_hash: params.source_cast_hash || null,
      source_cast_author_fid: params.source_cast_author_fid || null,
      parent_feature_id: params.parent_feature_id || null,
      is_sub_item: params.is_sub_item || false,
      status: 'open',
      total_weight: 0,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create feature: ${error.message}`);
  }

  // Add tags if provided
  if (params.tags && params.tags.length > 0) {
    const tagInserts = params.tags.map(tagId => ({
      feature_id: data.id,
      tag_id: tagId
    }));

    await supabase.from('feature_tags').insert(tagInserts);
  }

  return data.id;
}

export async function addFeatureSource(
  featureId: string,
  source: {
    source_cast_hash: string;
    source_cast_author_fid?: number;
    source_cast_text?: string;
  }
) {
  const { error } = await supabase
    .from('feature_sources')
    .insert({
      feature_id: featureId,
      source_cast_hash: source.source_cast_hash,
      source_cast_author_fid: source.source_cast_author_fid || null,
      source_cast_text: source.source_cast_text || null,
    });

  if (error) {
    console.error('Failed to add feature source:', error);
  }
}

export async function updateFeatureDescription(featureId: string, newDescription: string) {
  const { error } = await supabase
    .from('features')
    .update({
      description: newDescription,
      updated_at: new Date().toISOString()
    })
    .eq('id', featureId);

  if (error) {
    console.error('Failed to update feature description:', error);
  }
}

export async function getFeatureById(featureId: string) {
  const { data, error } = await supabase
    .from('features')
    .select('*')
    .eq('id', featureId)
    .single();

  if (error) {
    return null;
  }

  return data;
}
