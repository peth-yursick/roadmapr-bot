import { extractFeatures, type ExtractedFeature } from './extractor.js';
import { autoTag } from './tagger.js';
import { findSimilarFeatures, storeFeatureEmbedding } from './similarity.js';
import { detectProjects, detectNewProjects, getAllProjects } from './router.js';
import { BotVoice } from './voice.js';
import { detectIntent } from './intent.js';
import {
  getCast,
  getCastThread,
  postReply,
  postStandaloneCast,
  getNeynarScore,
  getUser
} from '../neynar/client.js';
import {
  createFeature,
  addFeatureSource,
  updateFeatureDescription,
} from '../db/features.js';
import {
  getProjectByHandle,
  createProject,
  type Project
} from '../db/projects.js';
import {
  checkProcessed,
  checkRateLimited,
  logBotMention
} from '../db/bot.js';
import { supabase } from '../db/client.js';
import {
  parseProjectSetupReply,
  parseOwner,
  getProjectBio
} from './helpers.js';

const MAX_FEATURES_PER_CAST = parseInt(process.env.MAX_FEATURES_PER_CAST || '5');
const MIN_NEYNAR_SCORE = parseFloat(process.env.MIN_NEYNAR_SCORE || '0.1');
const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85');

interface WebhookData {
  cast_hash?: string;
  hash?: string;
  author?: { fid: number };
  parent_hash?: string;
  data?: {
    hash?: string;
    author?: { fid: number };
    parent_hash?: string;
  };
}

export async function processWebhook(webhookData: WebhookData) {
  // Normalize webhook data structure (Neynar webhooks can have different formats)
  const data = webhookData.data || webhookData;
  const cast_hash = data.hash || (data as any).cast_hash;
  const author_fid = data.author?.fid;
  const parent_hash = data.parent_hash;

  console.log(`[Processor] Processing cast ${cast_hash?.slice(0, 8)}... by FID ${author_fid}`);

  if (!cast_hash || !author_fid) {
    console.error('[Processor] Missing required fields in webhook data');
    return;
  }

  // Check if this is a reply to the bot itself
  const BOT_FID = parseInt(process.env.ROADMAPR_BOT_FID || '0');
  const isReplyToBot = parent_hash && await isReplyToBotCast(parent_hash, BOT_FID, 'roadmapr');

  // Ignore ALL bot's own casts (prevent loops) - regardless of reply status
  if (author_fid === BOT_FID) {
    console.log(`[Processor] Ignoring bot's own cast`);
    return;
  }

  // Check if already processed
  if (await checkProcessed(cast_hash)) {
    console.log(`[Processor] Already processed: ${cast_hash}`);
    return;
  }

  // Rate limit check
  if (await checkRateLimited(author_fid)) {
    console.log(`[Processor] Rate limited: FID ${author_fid}`);
    await logBotMention(cast_hash, author_fid, parent_hash || null, {
      error: 'Rate limited'
    });
    await postReply(cast_hash, BotVoice.rateLimited());
    return;
  }

  // Neynar score check (anti-spam)
  const score = await getNeynarScore(author_fid);
  console.log(`[Processor] Neynar score for FID ${author_fid}: ${score}`);
  if (score < MIN_NEYNAR_SCORE) {
    console.log(`[Processor] Low score: ${author_fid} (${score})`);
    await logBotMention(cast_hash, author_fid, parent_hash || null, {
      error: `Low Neynar score: ${score}`
    });
    await postReply(cast_hash, BotVoice.lowNeynarScore());
    return;
  }

  // Need parent cast to extract context
  if (!parent_hash) {
    await logBotMention(cast_hash, author_fid, null, {
      error: 'No parent cast'
    });
    await postReply(cast_hash, BotVoice.noParentCast());
    return;
  }

  // Get parent cast
  const parentCast = await getCast(parent_hash);
  if (!parentCast) {
    await logBotMention(cast_hash, author_fid, parent_hash, {
      error: 'Parent cast not found'
    });
    await postReply(cast_hash, BotVoice.parentCastNotFound());
    return;
  }

  console.log(`[Processor] Parent cast: ${parentCast.hash} by @${parentCast.author.username}`);

  // Check if this is a reply to the bot - if so, get full conversation context
  let fullContext: string;
  let contextCastCount: number;

  // Get current cast text (might contain the feature request)
  const currentCastText = await getCastText(cast_hash);

  if (isReplyToBot) {
    console.log(`[Processor] Reply to bot detected - gathering conversation context`);
    // Get the full conversation thread leading to this reply
    const thread = await getCastThread(parent_hash);

    // Build context from the thread (oldest to newest)
    const threadTexts = thread.map(c => c.text).reverse();
    fullContext = [
      ...threadTexts,
      parentCast.text,
      `Reply: ${currentCastText}`
    ].join('\n\n---\n\n');

    contextCastCount = thread.length + 2;
    console.log(`[Processor] Conversation context: ${contextCastCount} messages`);
  } else {
    // Normal flow: just parent cast and its thread
    const thread = await getCastThread(parent_hash);

    // Always include the current cast text - it's the message that mentioned @roadmapr
    // so it's always relevant for intent detection
    fullContext = [
      currentCastText,
      parentCast.text,
      ...thread.map(c => c.text)
    ].join('\n\n---\n\n');
    contextCastCount = thread.length + 2;
  }

  console.log(`[Processor] Context length: ${fullContext.length} chars (${contextCastCount} casts)`);

  // PRIORITY: Check for project setup replies BEFORE intent detection.
  // Don't rely on isReplyToBot (BOT_FID may be wrong) - instead detect by content:
  // If current message has owner/token info AND context has "NEW PROJECT ALERT!", it's a setup reply.
  const setupInfo = parseProjectSetupReply(currentCastText);
  // Look for pending project setup in parent cast or thread
  let pendingProjectHandle: string | null = extractProjectHandleFromBotMessage(parentCast.text);
  if (!pendingProjectHandle) {
    const thread = await getCastThread(parent_hash);
    // Check all thread casts for bot's "NEW PROJECT ALERT!" message
    for (const cast of thread) {
      pendingProjectHandle = extractProjectHandleFromBotMessage(cast.text);
      if (pendingProjectHandle) break;
    }
  }

  if (setupInfo.owner && pendingProjectHandle) {
    console.log(`[Processor] Project setup reply detected: project=@${pendingProjectHandle}, owner=${setupInfo.owner}, token=${setupInfo.token || 'clanker'}`);
    console.log(`[Processor] Creating project: @${pendingProjectHandle}`);

    // Handle "owner: me" / "im the owner" - use the replying user's FID
    let ownerInput = setupInfo.owner;
    if (ownerInput === 'me') {
      ownerInput = String(author_fid);
      console.log(`[Processor] Owner is "me" - using author FID: ${author_fid}`);
    }

    // Parse owner (resolve @username or FID)
    const parsedOwner = await parseOwner(ownerInput, BOT_FID);
    if (!parsedOwner) {
      await logBotMention(cast_hash, author_fid, parent_hash, {
        error: `Owner not found: ${setupInfo.owner}`
      });
      await postReply(cast_hash, BotVoice.ownerNotFound(setupInfo.owner));
      return;
    }

    // Get bio from project's Farcaster profile
    const bioResult = await getProjectBio(pendingProjectHandle);
    console.log(`[Processor] Bio for @${pendingProjectHandle}: ${bioResult ? 'found' : 'not found'}`);

    // Determine voting type and token address
    const tokenInput = (setupInfo.token || 'clanker').toLowerCase();
    const voting_type: 'score' | 'token' = tokenInput === 'clanker' ? 'token' : 'score';
    const isClanker = tokenInput === 'clanker';
    const token_address = isClanker ? undefined : setupInfo.token;

    // Create project
    try {
      const project = await createProject({
        name: pendingProjectHandle.charAt(0).toUpperCase() + pendingProjectHandle.slice(1),
        project_handle: pendingProjectHandle,
        owner_fid: parsedOwner.fid,
        ...(bioResult && { bio: bioResult }),
        voting_type,
        ...(token_address && { token_address }),
        created_by_bot: true
      });

      console.log(`[Processor] Project created: ${project.id} (@${pendingProjectHandle})`);

      await logBotMention(cast_hash, author_fid, parent_hash, {
        project_created: project.id,
        project_handle: pendingProjectHandle,
        owner_fid: parsedOwner.fid,
        voting_type
      });

      await postReply(cast_hash, BotVoice.projectCreated(project, parsedOwner.username));
      return;
    } catch (err) {
      console.error(`[Processor] Failed to create project:`, err);
      await logBotMention(cast_hash, author_fid, parent_hash, {
        error: `Project creation failed: ${(err as Error).message}`
      });
      await postReply(cast_hash, BotVoice.genericError('Failed to create project'));
      return;
    }
  }

  // Use intent detection on the CURRENT cast text (the user's actual command)
  // Using fullContext would mix in old thread messages and confuse the intent
  const allKnownProjects = (await getAllProjects()).map((p: { project_handle: string }) => p.project_handle);
  const intent = await detectIntent(currentCastText, allKnownProjects);

  console.log(`[Intent] Detected: ${intent.intent} (confidence: ${intent.confidence})`);
  console.log(`[Intent] Target projects: ${intent.targetProjects.join(',') || 'none'}`);
  console.log(`[Intent] New project name: ${intent.newProjectName || 'none'}`);
  if (intent.reasoning) {
    console.log(`[Intent] Reasoning: ${intent.reasoning}`);
  }

  // Handle create_project intent
  if (intent.intent === 'create_project' && intent.newProjectName) {
    let projectHandle = intent.newProjectName.toLowerCase();

    // If LLM returned "unknown", try to extract from conversation context
    if (projectHandle === 'unknown' || projectHandle === '<project name>') {
      const thread = await getCastThread(parent_hash);
      const extractedHandle = extractProjectHandleFromThreadContext(thread);
      if (extractedHandle) {
        projectHandle = extractedHandle;
        console.log(`[Processor] Extracted project handle from context: ${projectHandle}`);
      }
    }

    await logBotMention(cast_hash, author_fid, parent_hash, {
      detected_projects: [projectHandle],
      error: 'Awaiting project setup'
    });

    await postReply(cast_hash, BotVoice.newProjectIntentDetected(projectHandle, author_fid));
    return;
  }

  // Get target projects from intent detection
  const detectedProjects = intent.targetProjects;

  // If no projects detected and confidence is low, ask for clarification
  if (detectedProjects.length === 0 && intent.confidence < 0.5) {
    await logBotMention(cast_hash, author_fid, parent_hash, {
      error: `Low confidence intent detection: ${intent.intent}`
    });
    await postReply(cast_hash, BotVoice.noProjectDetected());
    return;
  }

  // Load projects
  const projects: Project[] = [];
  for (const handle of detectedProjects) {
    const project = await getProjectByHandle(handle);
    if (project) {
      projects.push(project);
    }
  }

  if (projects.length === 0) {
    await logBotMention(cast_hash, author_fid, parent_hash, {
      parent_cast_author_fid: parentCast.author.fid,
      parent_cast_text: parentCast.text,
      detected_projects: detectedProjects,
      error: 'Projects not found in database'
    });
    await postReply(cast_hash, BotVoice.projectNotFound(detectedProjects));
    return;
  }

  // If multiple projects detected, ask for clarification
  if (projects.length > 1) {
    const projectList = projects.map(p => ({
      handle: p.project_handle,
      name: p.name
    }));
    await logBotMention(cast_hash, author_fid, parent_hash, {
      parent_cast_author_fid: parentCast.author.fid,
      parent_cast_text: parentCast.text,
      detected_projects: detectedProjects,
      projects_found: projects.map(p => p.project_handle),
      error: 'Multiple projects detected'
    });
    await postReply(cast_hash, BotVoice.multipleProjects(projectList));
    return;
  }

  console.log(`[Processor] Found ${projects.length} project(s): ${projects.map(p => p.name).join(', ')}`);

  // Extract features using LLM
  console.log('[Processor] Extracting features...');
  const extracted = await extractFeatures(fullContext);

  if (extracted.length === 0) {
    await logBotMention(cast_hash, author_fid, parent_hash, {
      parent_cast_author_fid: parentCast.author.fid,
      parent_cast_text: parentCast.text,
      detected_projects: detectedProjects,
      features_created: 0
    });
    await postReply(cast_hash, BotVoice.noFeatureExtracted());
    return;
  }

  console.log(`[Processor] Extracted ${extracted.length} feature(s)`);

  // Process each feature (limit to MAX_FEATURES_PER_CAST)
  const results = {
    created: [] as Array<{ id: string; title: string; project: string; subItems: number }>,
    merged: [] as Array<{ id: string; title: string; project: string }>
  };

  const featuresToProcess = extracted.slice(0, MAX_FEATURES_PER_CAST);
  console.log(`[Processor] Processing ${featuresToProcess.length} feature(s) (max: ${MAX_FEATURES_PER_CAST})`);

  for (const feature of featuresToProcess) {
    for (const project of projects) {
      console.log(`[Processor] Processing feature "${feature.title}" for project ${project.name}`);

      // Auto-tag
      const tags = await autoTag(feature.title, feature.description);
      console.log(`[Processor] Auto-tagged with ${tags.length} tag(s)`);

      // Similarity search
      const similar = await findSimilarFeatures(
        project.id,
        feature.title,
        feature.description
      );

      // Check if should merge (similarity > threshold)
      if (similar.length > 0 && similar[0].similarity > SIMILARITY_THRESHOLD) {
        // MERGE into existing feature
        const existingFeature = similar[0];
        console.log(`[Processor] Merging into existing feature ${existingFeature.id} (similarity: ${existingFeature.similarity.toFixed(2)})`);

        await addFeatureSource(existingFeature.id, {
          source_cast_hash: parent_hash,
          source_cast_author_fid: parentCast.author.fid,
          source_cast_text: parentCast.text
        });

        // Update description if new one is more detailed
        if (feature.description.length > existingFeature.description.length * 0.5) {
          const updated = `${existingFeature.description}\n\n---\n\nAdditional feedback:\n${feature.description}`;
          await updateFeatureDescription(existingFeature.id, updated);
        }

        results.merged.push({
          id: existingFeature.id,
          title: existingFeature.title,
          project: project.name
        });
      } else {
        // CREATE new feature
        console.log(`[Processor] Creating new feature`);

        const featureId = await createFeature({
          project_id: project.id,
          title: feature.title,
          description: feature.description,
          submitter_fid: parentCast.author.fid,
          source_cast_hash: parent_hash,
          source_cast_author_fid: parentCast.author.fid,
          tags: tags
        });

        // Store embedding for similarity matching
        await storeFeatureEmbedding(featureId, feature.title, feature.description);

        // Add source
        await addFeatureSource(featureId, {
          source_cast_hash: parent_hash,
          source_cast_author_fid: parentCast.author.fid,
          source_cast_text: parentCast.text
        });

        // Create sub-items if present
        if (feature.subItems && feature.subItems.length > 0) {
          console.log(`[Processor] Creating ${feature.subItems.length} sub-item(s)`);
          for (const sub of feature.subItems) {
            const subFeatureId = await createFeature({
              project_id: project.id,
              title: sub.title,
              description: sub.description,
              submitter_fid: parentCast.author.fid,
              parent_feature_id: featureId,
              is_sub_item: true
            });
            // Store embedding for sub-item
            await storeFeatureEmbedding(subFeatureId, sub.title, sub.description);
          }
        }

        results.created.push({
          id: featureId,
          title: feature.title,
          project: project.name,
          subItems: feature.subItems?.length || 0
        });
      }
    }
  }

  console.log(`[Processor] Created: ${results.created.length}, Merged: ${results.merged.length}`);

  // Log to database
  await logBotMention(cast_hash, author_fid, parent_hash, {
    parent_cast_author_fid: parentCast.author.fid,
    parent_cast_text: parentCast.text,
    detected_projects: detectedProjects,
    features_created: results.created.length,
    features_merged: results.merged.length
  });

  // Reply to cast
  await postReply(cast_hash, formatReply(results));

  // Post standalone cast (if features were created)
  if (results.created.length > 0) {
    const firstCreated = results.created[0];
    const author = await getUser(parentCast.author.fid);
    await postStandaloneCast(
      formatStandaloneCast(firstCreated, parentCast, author),
      parent_hash
    );
  }

  console.log(`[Processor] Done processing ${cast_hash}`);
}

function formatReply(results: { created: Array<{ title: string; subItems: number; project: string }>; merged: Array<{ title: string; project: string }> }): string {
  const { created, merged } = results;

  // All created, no merged
  if (created.length > 0 && merged.length === 0) {
    const first = created[0];
    if (created.length === 1) {
      return BotVoice.featureCreated(first.title, first.project);
    }
    // Multiple features
    let text = `${celebrate()}\n\n✅ Added ${created.length} features!\n`;
    created.forEach((f, i) => {
      text += `${i + 1}. ${f.title}`;
      if (f.subItems > 0) text += ` (+${f.subItems} options)`;
      text += `\n`;
    });
    text += `\nKeep 'em coming! 🎯`;
    return text;
  }

  // All merged, no created
  if (merged.length > 0 && created.length === 0) {
    return BotVoice.featureMerged(merged[0].title, `${merged[0].project}`);
  }

  // Mixed
  let text = `${celebrate()}\n\n`;
  if (created.length > 0) {
    text += `✅ Created: ${created[0].title}\n`;
  }
  if (merged.length > 0) {
    text += `🔗 Merged: ${merged[0].title}\n`;
  }
  text += `\nVote at roadmapr.xyz`;
  return text;
}

function celebrate(): string {
  const celebrations = [
    "🎉 BOOM!",
    "✨ BAM!",
    "🚀 TO THE MOON!",
    "💥 POW!",
    "🤖 ROBOT SAYS: SUCCESS!",
  ];
  return celebrations[Math.floor(Math.random() * celebrations.length)];
}

function formatStandaloneCast(
  feature: { title: string; id: string },
  parentCast: { author: { username: string } },
  author: { username: string } | null
): string {
  const username = author?.username || parentCast.author.username;
  const intros = [
    "🚨 NEW FEATURE ALERT!",
    "📋 HOT NEW REQUEST!",
    "✨ FRESH SUGGESTION!",
    "🎯 NEW FEATURE DROP!",
  ];
  const intro = intros[Math.floor(Math.random() * intros.length)];

  return `${intro}\n\n` +
    `"${feature.title}"\n\n` +
    `👤 Suggested by @${username}\n` +
    `🗳️ Vote: roadmapr.xyz/features/${feature.id}\n\n` +
    `Make your voice heard! 📢`;
}

/**
 * Check if a cast is authored by the bot (by FID or username)
 */
async function isReplyToBotCast(castHash: string, botFid: number, botUsername?: string): Promise<boolean> {
  const cast = await getCast(castHash);
  if (!cast?.author) return false;
  return cast.author.fid === botFid ||
    (botUsername != null && cast.author.username?.toLowerCase() === botUsername.toLowerCase());
}

/**
 * Get the text content of a cast
 */
async function getCastText(castHash: string): Promise<string> {
  const cast = await getCast(castHash);
  return cast?.text || '';
}

/**
 * Extract project handle from a bot message (e.g. "NEW PROJECT ALERT! @castoors!")
 * Used when the user replies directly to the bot's message
 */
function extractProjectHandleFromBotMessage(botText: string): string | null {
  if (!botText.includes('NEW PROJECT ALERT!') && !botText.includes('NEW PROJECT ALERT')) {
    return null;
  }
  // Extract the @handle from "NEW PROJECT ALERT! @castoors!"
  // Skip @roadmapr and common non-project mentions
  const mentions = botText.match(/@(\w+)/g) || [];
  for (const mention of mentions) {
    const handle = mention.slice(1).toLowerCase();
    if (handle !== 'roadmapr' && handle !== 'unknown' && handle.length > 1) {
      console.log(`[Processor] Extracted project handle "${handle}" from bot message`);
      return handle;
    }
  }
  return null;
}

/**
 * Extract project handle from thread context (looks for "NEW PROJECT ALERT! @handle")
 */
function extractProjectHandleFromThreadContext(thread: Array<{ text: string }>): string | null {
  // First, try to find the original user request with project name
  // Look for patterns like "create project called X", "new project X", etc.
  for (const cast of thread) {
    const text = cast.text.toLowerCase();

    // Skip bot's own "NEW PROJECT ALERT!" messages
    if (text.includes('new project alert!') || text.includes('let\'s get this set up')) {
      continue;
    }

    // Look for project creation patterns (both "create project X" and "create X project")
    const patterns = [
      /create(?:\s+a)?(?:\s+new)?\s+project\s+(?:called\s+|named\s+)?[@]?(\w+)/i,
      /create\s+(?:a\s+|the\s+)?[@]?(\w+)\s+project\b/i,
      /new\s+project\s+(?:called\s+|named\s+)?[@]?(\w+)/i,
      /make\s+(?:a\s+)?project\s+(?:called\s+|named\s+)?[@]?(\w+)/i,
      /make\s+(?:a\s+|the\s+)?[@]?(\w+)\s+project\b/i,
      /add\s+project\s+(?:called\s+|named\s+)?[@]?(\w+)/i,
      /set\s*up\s+(?:a\s+)?project\s+(?:called\s+|named\s+)?[@]?(\w+)/i,
      /set\s*up\s+(?:a\s+|the\s+)?[@]?(\w+)\s+project\b/i,
      /deploy\s+project\s+[@]?(\w+)/i,
      /deploy\s+(?:a\s+|the\s+)?[@]?(\w+)\s+project\b/i,
    ];
    const stopwords = new Set(['a', 'an', 'the', 'my', 'our', 'this', 'that', 'new', 'project', 'board', 'alert']);

    for (const pattern of patterns) {
      const match = cast.text.match(pattern);
      if (match) {
        const handle = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (handle && handle !== 'roadmapr' && !stopwords.has(handle)) {
          console.log(`[Processor] Extracted project handle "${handle}" from conversation context`);
          return handle;
        }
      }
    }
  }

  // Fallback: look through the thread for the "NEW PROJECT ALERT!" message
  // (but skip if it says @unknown)
  for (const cast of thread) {
    if (cast.text.includes('NEW PROJECT ALERT!') && !cast.text.includes('@unknown')) {
      // Extract the @handle from the message
      const match = cast.text.match(/@(\w+)/);
      if (match) {
        return match[1].toLowerCase();
      }
    }
  }

  return null;
}
