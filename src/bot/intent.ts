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

// Try multiple models in order of preference
const MODELS_TO_TRY = [
  'glm-4.7',      // Latest model
  'glm-4.6',
  'glm-4.5',
  'glm-4.5-air',
];

export interface DetectedIntent {
  intent: 'create_project' | 'add_feature' | 'unknown';
  targetProjects: string[];  // Project handles mentioned
  newProjectName?: string;   // For create_project intent
  confidence: number;
  reasoning?: string;
}

/**
 * Pattern-matching fallback for when LLM is unavailable
 * Handles common intents without needing API calls
 */
function detectIntentByPattern(text: string, allKnownProjects: string[]): DetectedIntent {
  const lowerText = text.toLowerCase();
  const targetProjects: string[] = [];
  let newProjectName: string | undefined;
  let intent: 'create_project' | 'add_feature' | 'unknown' = 'unknown';

  // Extract @mentions as potential projects (but exclude @roadmapr)
  const mentionRegex = /@([a-z0-9_-]+)/gi;
  const mentions = new Set<string>();
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const handle = match[1].toLowerCase();
    if (handle !== 'roadmapr') {
      mentions.add(handle);
    }
  }

  // Pattern 1: Create project intents
  const createProjectPatterns = [
    /create\s+(?:a\s+)?(?:new\s+)?project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    /new\s+project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    /make\s+(?:a\s+)?project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    /add\s+project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    /setup\s+(?:a\s+)?project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    /start\s+(?:a\s+)?project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    /project\s+(?:called\s+)?[\"']?([a-z0-9_-]+)[\"']?\s+(?:for|with|board)/i,
  ];

  for (const pattern of createProjectPatterns) {
    const match = text.match(pattern);
    if (match) {
      intent = 'create_project';
      newProjectName = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
      return {
        intent,
        targetProjects: [],
        newProjectName,
        confidence: 0.75,
        reasoning: 'Pattern matched: create project request'
      };
    }
  }

  // Pattern 2: Add feature intents
  const addFeaturePatterns = [
    /add\s+\w+\s+(?:to\s+)?@?([a-z0-9_-]+)/i,
    /for\s+@?([a-z0-9_-]+),?\s+(?:add|create|implement|build)/i,
    /@?([a-z0-9_-]+)\s+(?:should|needs|requires)\s+/i,
    /feature\s+(?:request\s+)?(?:for\s+)?@?([a-z0-9_-]+)/i,
    /(?:implement|build|make)\s+\w+\s+for\s+@?([a-z0-9_-]+)/i,
  ];

  for (const pattern of addFeaturePatterns) {
    const match = text.match(pattern);
    if (match) {
      const potentialProject = match[1].toLowerCase();
      // Check if it's a known project or was mentioned
      if (allKnownProjects.includes(potentialProject) || mentions.has(potentialProject)) {
        intent = 'add_feature';
        targetProjects.push(potentialProject);
        return {
          intent,
          targetProjects,
          confidence: 0.70,
          reasoning: 'Pattern matched: add feature request'
        };
      }
    }
  }

  // Pattern 3: If there are project mentions but no clear intent, assume add_feature
  if (mentions.size > 0) {
    const knownMentions = Array.from(mentions).filter(m => allKnownProjects.includes(m));
    if (knownMentions.length > 0) {
      return {
        intent: 'add_feature',
        targetProjects: knownMentions,
        confidence: 0.50,
        reasoning: 'Project mentions detected, assuming add feature intent'
      };
    }
  }

  // Pattern 4: Generic create project detection (no specific name)
  if (/\b(create|new|make|add|setup|start)\s+project\b/i.test(lowerText)) {
    return {
      intent: 'create_project',
      targetProjects: [],
      confidence: 0.40,
      reasoning: 'Create project keywords detected but no specific name found'
    };
  }

  return {
    intent: 'unknown',
    targetProjects: [],
    confidence: 0.2,
    reasoning: 'No clear pattern matched'
  };
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

  // Try models in order, fallback to next if model doesn't exist
  for (const model of MODELS_TO_TRY) {
    try {
      const response = await callGLMAPI('chat/completions', {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
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
    } catch (modelErr) {
      const errorMsg = modelErr instanceof Error ? modelErr.message : String(modelErr);
      console.error(`[Intent] Model ${model} failed: ${errorMsg}`);
      // If it's a 400/401/404 error or model not found, try next model
      if (errorMsg.includes('400') || errorMsg.includes('401') || errorMsg.includes('404') ||
          errorMsg.includes('1211') || errorMsg.includes('模型不存在') || errorMsg.includes('model_not_found')) {
        console.log(`[Intent] Model ${model} not available, trying next...`);
        continue;
      }
      // For other errors, also try next model
      continue;
    }
  }

  // All models failed - use pattern matching fallback
  console.log('[Intent] All GLM models failed, using pattern matching fallback');
  const patternResult = detectIntentByPattern(text, allKnownProjects);
  console.log(`[Intent] Pattern result: ${patternResult.intent} (confidence: ${patternResult.confidence})`);
  return patternResult;
}
