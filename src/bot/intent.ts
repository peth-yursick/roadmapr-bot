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
  const targetProjects: string[] = [];
  let newProjectName: string | undefined;
  let intent: 'create_project' | 'add_feature' | 'unknown' = 'unknown';

  // Strip @roadmapr mentions to reduce noise in pattern matching
  const cleanText = text.replace(/@roadmapr\b/gi, '').replace(/\s+/g, ' ').trim();
  const lowerText = cleanText.toLowerCase();

  // Extract @mentions as potential projects (already excludes @roadmapr via cleanText)
  const mentionRegex = /@([a-z0-9_-]+)/gi;
  const mentions = new Set<string>();
  let match;
  while ((match = mentionRegex.exec(cleanText)) !== null) {
    const handle = match[1].toLowerCase();
    mentions.add(handle);
  }

  // Pattern 1: Create project intents
  // Patterns match against cleanText (with @roadmapr stripped)
  const createProjectPatterns = [
    // "create [a] [new] project [called] X"
    /create\s+(?:a\s+)?(?:new\s+)?project\s+(?:called\s+|named\s+|for\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    // "new project [called] X"
    /new\s+project\s+(?:called\s+|named\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    // "make [a] project [called] X"
    /make\s+(?:a\s+)?project\s+(?:called\s+|named\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    // "add project [called] X"
    /add\s+project\s+(?:called\s+|named\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    // "setup/set up [a] project [called] X"
    /set\s*up\s+(?:a\s+)?project\s+(?:called\s+|named\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    // "start [a] project [called] X"
    /start\s+(?:a\s+)?project\s+(?:called\s+|named\s+)?[\"']?([a-z0-9_-]+)[\"']?/i,
    // "project [called] X for/with/board"
    /project\s+(?:called\s+|named\s+)?[\"']?([a-z0-9_-]+)[\"']?\s+(?:for|with|board)/i,
    // "create [a/the] X project board" or "create [a/the] X board"
    /create\s+(?:a\s+|the\s+)?[\"']?([a-z0-9_-]+)[\"']?\s+(?:project\s+)?board/i,
    // "create [a/the] X project" - but NOT "create a project" (reject articles/stopwords as names)
    /create\s+(?:a\s+|the\s+)?[\"']?([a-z0-9_-]+)[\"']?\s+project\b/i,
    // "make [a/the] X project"
    /make\s+(?:a\s+|the\s+)?[\"']?([a-z0-9_-]+)[\"']?\s+project\b/i,
    // "set up [a/the] X project"
    /set\s*up\s+(?:a\s+|the\s+)?[\"']?([a-z0-9_-]+)[\"']?\s+project\b/i,
  ];

  const stopwords = new Set(['a', 'an', 'the', 'my', 'our', 'this', 'that', 'new', 'project', 'board']);

  for (const pattern of createProjectPatterns) {
    const match = cleanText.match(pattern);
    if (match) {
      const candidate = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
      // Reject stopwords captured as project names (e.g. "create a project")
      if (candidate && !stopwords.has(candidate)) {
        intent = 'create_project';
        newProjectName = candidate;
        return {
          intent,
          targetProjects: [],
          newProjectName,
          confidence: 0.75,
          reasoning: 'Pattern matched: create project request'
        };
      }
    }
  }

  // Pattern 2: Add feature intents
  const addFeaturePatterns = [
    /(?:add|create|implement|build|make)\s+.+?\s+(?:to|for|on)\s+@([a-z0-9_-]+)/i,  // "add X to @project"
    /for\s+@([a-z0-9_-]+),?\s+(?:add|create|implement|build)/i,                      // "for @project, add X"
    /@([a-z0-9_-]+)\s+(?:should|needs|requires|could use)\s+/i,                       // "@project should have X"
    /feature\s+(?:request\s+)?(?:for\s+)?@([a-z0-9_-]+)/i,                            // "feature request for @project"
    /(?:implement|build|make)\s+.+?\s+for\s+@([a-z0-9_-]+)/i,                         // "build X for @project"
  ];

  for (const pattern of addFeaturePatterns) {
    const match = cleanText.match(pattern);
    if (match) {
      const potentialProject = match[1].toLowerCase();
      // Check if it's a known project or was mentioned
      if (allKnownProjects.includes(potentialProject) || mentions.has(potentialProject)) {
        intent = 'add_feature';
        targetProjects.push(potentialProject);
        return {
          intent,
          targetProjects,
          confidence: 0.75,
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
  if (/\b(create|new|make|add|setup|set\s+up|start)\s+(?:a\s+)?(?:new\s+)?project\b/i.test(lowerText)) {
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

  // FIRST: Try pattern matching for clear, unambiguous cases
  // This catches obvious intents without needing LLM API calls
  const patternResult = detectIntentByPattern(text, allKnownProjects);
  if (patternResult.confidence >= 0.7) {
    console.log('[Intent] Pattern matched with high confidence, skipping LLM');
    return patternResult;
  }

  // SECOND: If pattern matching is uncertain, use LLM for smarter understanding
  console.log('[Intent] Pattern confidence low, using LLM for better understanding');

  // Strip @roadmapr from text before sending to LLM to reduce noise
  const cleanedText = text.replace(/@roadmapr\b/gi, '').replace(/\s+/g, ' ').trim();

  const prompt = `You are a Farcaster bot intent classifier. Analyze the user's message and determine their intent.

Known projects: ${projectList || 'none yet'}

USER MESSAGE:
${cleanedText}

INTENTS:
1. "create_project" - User wants to CREATE A NEW PROJECT. Extract the project name.
2. "add_feature" - User wants to ADD/REQUEST a feature for an existing project.
3. "unknown" - Anything else.

IMPORTANT RULES:
- @roadmapr is the bot, NEVER a project name
- Words like "alert", "project", "board", "new" are NEVER project names
- The project name is the unique identifier the user chose (e.g. "Castoors", "base", "degenswap")
- If the user mentions a known project, it's likely add_feature
- If no known project is mentioned and user wants to create something new, it's create_project

Return ONLY valid JSON:
{"intent": "create_project", "targetProjects": [], "newProjectName": "the-name", "confidence": 0.9, "reasoning": "why"}

Examples:
"create Castoors project" → {"intent": "create_project", "targetProjects": [], "newProjectName": "Castoors", "confidence": 0.95, "reasoning": "wants to create Castoors project"}
"add dark mode to @base" → {"intent": "add_feature", "targetProjects": ["base"], "confidence": 0.95, "reasoning": "wants dark mode for base"}
"yo can you set up a degenswap board" → {"intent": "create_project", "targetProjects": [], "newProjectName": "degenswap", "confidence": 0.9, "reasoning": "wants to create degenswap project"}
"@base needs better search" → {"intent": "add_feature", "targetProjects": ["base"], "confidence": 0.9, "reasoning": "requesting search feature for base"}

Analyze now:`;

  // Try OpenAI first (primary)
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('[Intent] Trying OpenAI GPT-4o-mini...');
      console.log('[Intent] Sending to LLM:', text.substring(0, 200) + '...');
      const response = await callOpenAI({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }) as { choices: Array<{ message: { content: string } }> };

      const content = response.choices[0]?.message?.content || '';
      console.log('[Intent] OpenAI response received:', content.substring(0, 150));

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
  const fallbackPatternResult = detectIntentByPattern(text, allKnownProjects);
  console.log(`[Intent] Pattern result: ${fallbackPatternResult.intent} (confidence: ${fallbackPatternResult.confidence})`);
  return fallbackPatternResult;
}
