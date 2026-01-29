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

import { getTagByName, createTag } from '../db/tags.js';

const PREDEFINED_TAGS = [
  'bug', 'feature', 'enhancement', 'marketing', 'strategy',
  'design', 'mobile', 'web', 'api', 'documentation', 'performance', 'security'
];

export async function autoTag(title: string, description: string): Promise<string[]> {
  const prompt = `Categorize this feature request with 2-4 relevant tags.

Predefined tags: ${PREDEFINED_TAGS.join(', ')}

You can also suggest new tags if needed (e.g., "notifications", "ux", "onboarding").

Feature:
Title: ${title}
Description: ${description}

Return JSON array of lowercase tag names only:`;

  try {
    const response = await callGLMAPI('chat/completions', {
      model: 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }) as { choices: Array<{ message: { content: string } }> };

    const content = response.choices[0]?.message?.content || '';

    // Extract JSON from response
    let jsonText = content.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.slice(7);
    }
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith('```')) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    const parsed = JSON.parse(jsonText);
    const tagNames: string[] = Array.isArray(parsed) ? parsed : [];

    // Ensure tags exist and get their IDs
    const tagIds: string[] = [];
    for (const name of tagNames.slice(0, 4)) { // Max 4 tags
      const normalizedName = name.toLowerCase().trim();
      if (!normalizedName) continue;

      let tag = await getTagByName(normalizedName);
      if (!tag) {
        tag = await createTag(normalizedName, 'custom');
      }
      tagIds.push(tag.id);
    }

    return tagIds;
  } catch (err) {
    console.error('Tagging error:', err);
    return [];
  }
}
