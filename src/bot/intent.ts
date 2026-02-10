// OpenAI API configuration (primary)
async function callOpenAI(body: any) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  return response.json();
}

// GLM API configuration (fallback)
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

  const prompt = `You are analyzing a conversation with @roadmapr, a Farcaster bot.

Known projects on the platform: ${projectList || 'none yet'}

CONVERSATION TO ANALYZE:
${text}

CRITICAL CONTEXT UNDERSTANDING:
1. This may be a MULTI-TURN conversation separated by "---"
2. The bot may have asked for project setup info (owner, token type)
3. The user may be REPLYING to provide that info
4. Look for project names EARLIER in the conversation if not in the latest message

INTENT TYPES:
1. "create_project" - User wants to START a new project (mentions project name)
2. "add_feature" - User wants to add a feature to an EXISTING project
3. "unknown" - Can't determine intent or user is just providing setup info

IMPORTANT RULES:
- @roadmapr is the bot, NOT a project target
- If user says "im the owner" or provides token info WITHOUT a project name, this is SETUP INFO for an EXISTING conversation → return "unknown" intent (the processor will handle it)
- If user mentions a NEW project name that doesn't exist in known projects, return "create_project" with that name
- Extract project names from EARLIER in the conversation if not in the latest message

Return JSON ONLY:
{
  "intent": "create_project" | "add_feature" | "unknown",
  "targetProjects": ["handle1", "handle2"],  // existing projects they're referencing
  "newProjectName": "Castoors",  // only if creating NEW project
  "confidence": 0.9,  // 0-1
  "reasoning": "brief explanation"
}

Examples:
Example 1 - Initial project creation:
Input: "yo @roadmapr create a new project called Castoors"
Output: {"intent": "create_project", "targetProjects": [], "newProjectName": "Castoors", "confidence": 0.95, "reasoning": "User explicitly requests to create a new project named Castoors"}

Example 2 - Providing setup info (should return unknown):
Input: "---"
"yo @roadmapr create Castoors"
"---"
"🆕 NEW PROJECT ALERT! Let's get this set up! Reply with owner and token..."
"---"
"im the owner, use $ROAD token"
Output: {"intent": "unknown", "targetProjects": [], "confidence": 0.8, "reasoning": "User is providing setup info for Castoors project that was already mentioned. No new project creation requested."}

Example 3 - Feature request:
Input: "add dark mode to @base"
Output: {"intent": "add_feature", "targetProjects": ["base"], "confidence": 0.95, "reasoning": "User wants to add dark mode feature to the base project"}

Example 4 - Extract project name from conversation:
Input: "---"
"yo @roadmapr create Warpcast"
"---"
"let's do it, I'm the owner"
Output: {"intent": "unknown", "targetProjects": [], "confidence": 0.7, "reasoning": "Project Warpcast was mentioned earlier, user is now providing setup info. Not a new project request."}

Now analyze the conversation and return JSON only:`;

  // Try OpenAI first (primary)
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('[Intent] Trying OpenAI GPT-4o-mini...');
      const response = await callOpenAI({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }) as { choices: Array<{ message: { content: string } }> };

      const content = response.choices[0]?.message?.content || '';
      console.log('[Intent] OpenAI response received');

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
    } catch (openaiErr) {
      const errorMsg = openaiErr instanceof Error ? openaiErr.message : String(openaiErr);
      console.error(`[Intent] OpenAI failed: ${errorMsg}`);
    }
  }

  // Fallback to GLM
  console.log('[Intent] OpenAI unavailable, trying GLM...');
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
      console.error(`[Intent] GLM model ${model} failed: ${errorMsg}`);
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
  console.log('[Intent] All LLM providers failed, using pattern matching fallback');
  const patternResult = detectIntentByPattern(text, allKnownProjects);
  console.log(`[Intent] Pattern result: ${patternResult.intent} (confidence: ${patternResult.confidence})`);
  return patternResult;
}
