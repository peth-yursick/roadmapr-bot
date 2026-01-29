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
      model: 'glm-4-flash',
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
    console.error('Extraction error:', err);
    return [];
  }
}
