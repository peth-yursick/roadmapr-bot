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

export interface DetectedIntent {
  intent: 'create_project' | 'add_feature' | 'unknown';
  targetProjects: string[];  // Project handles mentioned
  newProjectName?: string;   // For create_project intent
  confidence: number;
  reasoning?: string;
}

/**
 * Use LLM to intelligently detect user intent and target projects
 * This is much smarter than pattern matching - it understands context
 */
export async function detectIntent(text: string, allKnownProjects: string[]): Promise<DetectedIntent> {
  const projectList = allKnownProjects.map(p => `@${p}`).join(', ');

  const prompt = `Analyze this message to a Farcaster bot called @roadmapr.

Known projects on the platform: ${projectList || 'none yet'}

The user is replying to @roadmapr. Determine:
1. What they want to do
2. Which existing project they're talking about (if any)
3. If they want to create a new project

IMPORTANT CONTEXT RULES:
- @roadmapr is the bot being addressed, NOT a project target
- "create a project", "new project", "add project" = create_project intent
- "add feature", "bug", "implement", "request" = add_feature intent
- If they mention a project name that doesn't exist in known projects, it might be a new project name

Return JSON ONLY:
{
  "intent": "create_project" | "add_feature" | "unknown",
  "targetProjects": ["handle1", "handle2"],  // existing projects they're referencing
  "newProjectName": "Castoors",  // only if creating new project
  "confidence": 0.9,  // 0-1
  "reasoning": "brief explanation"
}

Examples:
Input: "create a new project called Castoors with me as owner"
Output: {"intent": "create_project", "targetProjects": [], "newProjectName": "Castoors", "confidence": 0.95, "reasoning": "User explicitly wants to create a new project named Castoors"}

Input: "add dark mode to @base"
Output: {"intent": "add_feature", "targetProjects": ["base"], "confidence": 0.95, "reasoning": "User wants to add a feature to the base project"}

Input: "@roadmapr can you help me add a feature?"
Output: {"intent": "unknown", "targetProjects": [], "confidence": 0.3, "reasoning": "User addressed the bot but didn't specify which project"}

Input: "for @farcaster add account abstraction"
Output: {"intent": "add_feature", "targetProjects": ["farcaster"], "confidence": 0.95, "reasoning": "User wants to add account abstraction feature to farcaster project"}

Input: "yo @roadmapr create a project called Warpcast"
Output: {"intent": "create_project", "targetProjects": [], "newProjectName": "Warpcast", "confidence": 0.95, "reasoning": "User explicitly asks to create a new project called Warpcast"}

Now analyze:
${text}

Return JSON only:`;

  try {
    const response = await callGLMAPI('chat/completions', {
      model: 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,  // Low temperature for consistent intent detection
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

    // Validate the response
    return {
      intent: parsed.intent || 'unknown',
      targetProjects: Array.isArray(parsed.targetProjects) ? parsed.targetProjects : [],
      newProjectName: parsed.newProjectName,
      confidence: parsed.confidence || 0.5,
      reasoning: parsed.reasoning
    };
  } catch (err) {
    console.error('[Intent] LLM detection error:', err);
    // Fallback to unknown
    return {
      intent: 'unknown',
      targetProjects: [],
      confidence: 0
    };
  }
}
