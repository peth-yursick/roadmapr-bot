import { supabase } from '../db/client.js';

interface SimilarFeature {
  id: string;
  title: string;
  description: string;
  similarity: number;
}

// GLM API configuration
const GLM_API_URL = 'https://open.bigmodel.cn/api/paas/v4/';

async function callGLMAPI(endpoint: string, body: any) {
  const response = await fetch(`${GLM_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GLM API error: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Find features similar to the given title and description using vector search
 */
export async function findSimilarFeatures(
  projectId: string,
  title: string,
  description: string
): Promise<SimilarFeature[]> {
  try {
    // Generate embedding for the query
    const queryText = `${title}. ${description}`;
    const embedding = await generateEmbedding(queryText);

    console.log(`[Similarity] Generated embedding for: "${title.slice(0, 50)}..."`);

    // Use pgvector similarity search via RPC
    const { data, error } = await supabase.rpc('match_features', {
      query_embedding: embedding,
      match_threshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85'),
      match_count: 5,
      project_filter: projectId
    });

    if (error) {
      console.error('[Similarity] Vector search error:', error);
      return [];
    }

    const results = (data || []) as SimilarFeature[];
    console.log(`[Similarity] Found ${results.length} similar feature(s)`);

    return results;
  } catch (err) {
    console.error('[Similarity] Error:', err);
    return [];
  }
}

/**
 * Generate an embedding vector for the given text using GLM
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await callGLMAPI('embeddings', {
      model: 'embedding-3',
      input: text.trim(),
      encoding_format: 'float',
    }) as { data: Array<{ embedding: number[] }> };

    // GLM returns 1024 dimensions
    return response.data[0].embedding;
  } catch (err) {
    console.error('[Similarity] Embedding generation error:', err);
    throw err;
  }
}

/**
 * Store an embedding for a newly created feature
 * This should be called after creating a feature to enable similarity matching
 */
export async function storeFeatureEmbedding(
  featureId: string,
  title: string,
  description: string
): Promise<void> {
  try {
    const text = `${title}. ${description}`;
    const embedding = await generateEmbedding(text);

    console.log(`[Similarity] Storing embedding for feature ${featureId}`);

    const { error } = await supabase
      .from('features')
      .update({ embedding })
      .eq('id', featureId);

    if (error) {
      console.error('[Similarity] Failed to store embedding:', error);
    }
  } catch (err) {
    console.error('[Similarity] Error storing embedding:', err);
  }
}

/**
 * Batch store embeddings for multiple features
 * Useful for backfilling existing features
 */
export async function batchStoreEmbeddings(
  features: Array<{ id: string; title: string; description: string }>
): Promise<void> {
  console.log(`[Similarity] Batch storing embeddings for ${features.length} features`);

  for (const feature of features) {
    await storeFeatureEmbedding(feature.id, feature.title, feature.description);
    // Small delay to avoid rate limits
    await sleep(200);
  }

  console.log('[Similarity] Batch embedding storage complete');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
