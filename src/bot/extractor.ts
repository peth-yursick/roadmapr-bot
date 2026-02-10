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

export interface ExtractedFeature {
  title: string;
  description: string;
  subItems?: { title: string; description: string }[];
}

/**
 * Pattern-matching fallback for feature extraction when LLM is unavailable
 * Extracts features using common patterns from user feedback
 */
function extractFeaturesByPattern(text: string): ExtractedFeature[] {
  const features: ExtractedFeature[] = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);

  const featurePatterns = [
    // Direct feature requests
    {
      pattern: /(?:add|create|implement|build|make)\s+(?:a\s+)?(?:the\s+)?(.+?)(?:\s+(?:feature|option|setting|button|functionality|ability|support))/gi,
      action: 'Add',
      default: 'Add requested feature'
    },
    {
      pattern: /(?:add|create|implement)\s+(.+?)(?:\s+(?:to|for|in))/gi,
      action: 'Add',
      default: 'Add requested feature'
    },
    // Bug fixes
    {
      pattern: /(?:fix|repair|resolve)\s+(?:the\s+)?(.+?)(?:\s+(?:bug|issue|problem|error))/gi,
      action: 'Fix',
      default: 'Fix reported issue'
    },
    {
      pattern: /(.+?)\s+(?:doesn't work|is broken|is not working|is buggy)/gi,
      action: 'Fix',
      default: 'Fix broken functionality'
    },
    // Improvement requests
    {
      pattern: /(?:improve|enhance|optimize)\s+(.+)/gi,
      action: 'Improve',
      default: 'Improve existing feature'
    },
    // Need/want statements
    {
      pattern: /(?:i need|i want|i'd like|we need|we want|should have|could use)\s+(.+?)(?:\.|$)/gi,
      action: 'Add',
      default: 'User requested feature'
    },
    // Support requests
    {
      pattern: /(?:support for|ability to|option to)\s+(.+?)(?:\.|$)/gi,
      action: 'Add support for',
      default: 'Add support request'
    },
  ];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    // Skip if it's just a meta-comment or too short
    if (trimmed.length < 10 || /^(please|thanks|thank you|hey|hello|yes|no)/i.test(trimmed)) {
      continue;
    }

    let matched = false;
    for (const { pattern, action, default: defaultTitle } of featurePatterns) {
      const match = pattern.exec(trimmed);
      if (match) {
        const featureText = match[1]?.trim() || '';
        const title = featureText
          ? `${action} ${featureText.charAt(0).toUpperCase() + featureText.slice(1)}`
          : defaultTitle;

        features.push({
          title: title.length > 100 ? title.substring(0, 97) + '...' : title,
          description: `Extracted from: "${trimmed.trim()}"`
        });
        matched = true;
        break;
      }
    }

    // If no pattern matched but sentence looks like a feature request, add it generically
    if (!matched && /\b(add|fix|create|make|implement|need|want|should|could)\b/i.test(trimmed)) {
      const cleaned = trimmed.replace(/^(please|can you|can we|i|i'd|we'd)\s+/i, '').trim();
      features.push({
        title: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
        description: `Extracted from: "${trimmed.trim()}"`
      });
    }
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return features.filter(f => {
    const key = f.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function extractFeatures(text: string): Promise<ExtractedFeature[]> {
  const prompt = `Extract feature requests or bugs from this feedback.

Rules:
- Extract discrete, actionable items
- If multiple implementation approaches mentioned, create subItems
- Ignore spam, insults, off-topic content
- Title: clear, actionable, <100 chars
- Description: 1-3 sentences explaining what and why
- Return valid JSON array only

Example output:
[
  {
    "title": "Add dark mode",
    "description": "Users want a dark theme for the app to reduce eye strain at night",
    "subItems": [
      {"title": "Auto-switch at sunset", "description": "Automatically switch to dark mode in evening based on system settings"},
      {"title": "OLED black option", "description": "Pure black theme for OLED screens to save battery"}
    ]
  }
]

Input text:
${text}

Return JSON array (or empty array if no actionable features):`;

  try {
    const response = await callGLMAPI('chat/completions', {
      model: 'glm-4.7',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }) as { choices: Array<{ message: { content: string } }> };

    const content = response.choices[0]?.message?.content || '';

    // Extract JSON from response (handle markdown code blocks)
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
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[Extractor] GLM API error, using pattern matching fallback:', err instanceof Error ? err.message : err);
    return extractFeaturesByPattern(text);
  }
}
