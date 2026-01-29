import { extractFeatures, type ExtractedFeature } from './extractor.js';
import { autoTag } from './tagger.js';
import { findSimilarFeatures, storeFeatureEmbedding } from './similarity.js';
import { detectProjects, detectNewProjects } from './router.js';
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

  console.log(`[Processor] Processing webhook: cast=${cast_hash}, author=${author_fid}, parent=${parent_hash}`);

  if (!cast_hash || !author_fid) {
    console.error('[Processor] Missing required fields in webhook data');
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
    await postReply(cast_hash, "Daily limit reached (20/day). Try tomorrow!");
    await logBotMention(cast_hash, author_fid, parent_hash || null, {
      error: 'Rate limited'
    });
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
    return;
  }

  // Need parent cast to extract context
  if (!parent_hash) {
    await postReply(cast_hash,
      "Reply to a cast with feedback to add it to a roadmap!"
    );
    await logBotMention(cast_hash, author_fid, null, {
      error: 'No parent cast'
    });
    return;
  }

  // Get parent cast
  const parentCast = await getCast(parent_hash);
  if (!parentCast) {
    await postReply(cast_hash, "Couldn't find that cast.");
    await logBotMention(cast_hash, author_fid, parent_hash, {
      error: 'Parent cast not found'
    });
    return;
  }

  console.log(`[Processor] Parent cast: ${parentCast.hash} by @${parentCast.author.username}`);

  // Get thread context for better extraction
  const thread = await getCastThread(parent_hash);
  const fullContext = [
    parentCast.text,
    ...thread.map(c => c.text)
  ].join('\n\n---\n\n');

  console.log(`[Processor] Context length: ${fullContext.length} chars (${thread.length + 1} casts)`);

  // Detect projects mentioned
  const detectedProjects = await detectProjects(fullContext, parentCast);
  const newProjectCandidates = await detectNewProjects(fullContext);

  console.log(`[Processor] Detected projects: ${detectedProjects.join(', ') || 'none'}`);
  console.log(`[Processor] New project candidates: ${newProjectCandidates.join(', ') || 'none'}`);

  // If no existing projects detected, check if they want to create a new one
  if (detectedProjects.length === 0) {
    if (newProjectCandidates.length > 0) {
      const mentions = newProjectCandidates.map(h => `@${h}`).join(', ');
      await postReply(cast_hash,
        `${mentions} - New project detected!\n\nTo create your board, reply with:\n• Owner FID\n• Token address (or "clanker" for default)\n• Short bio\n\nExample: "Owner: 12345, Token: clanker, Bio: Building the future"`
      );
      await logBotMention(cast_hash, author_fid, parent_hash, {
        parent_cast_author_fid: parentCast.author.fid,
        parent_cast_text: parentCast.text,
        detected_projects: newProjectCandidates,
        error: 'Awaiting project setup'
      });
      return;
    } else {
      await postReply(cast_hash,
        "Which project is this about? Mention the project handle (e.g., @base) or say 'for @project'"
      );
      await logBotMention(cast_hash, author_fid, parent_hash, {
        parent_cast_author_fid: parentCast.author.fid,
        parent_cast_text: parentCast.text,
        error: 'No projects detected'
      });
      return;
    }
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
    await postReply(cast_hash,
      "Couldn't find those projects. Make sure to use the exact project handle."
    );
    await logBotMention(cast_hash, author_fid, parent_hash, {
      parent_cast_author_fid: parentCast.author.fid,
      parent_cast_text: parentCast.text,
      detected_projects: detectedProjects,
      error: 'Projects not found in database'
    });
    return;
  }

  console.log(`[Processor] Found ${projects.length} project(s): ${projects.map(p => p.name).join(', ')}`);

  // Extract features using LLM
  console.log('[Processor] Extracting features...');
  const extracted = await extractFeatures(fullContext);

  if (extracted.length === 0) {
    await postReply(cast_hash,
      "Couldn't find actionable feedback. Try describing specific bugs or features."
    );
    await logBotMention(cast_hash, author_fid, parent_hash, {
      parent_cast_author_fid: parentCast.author.fid,
      parent_cast_text: parentCast.text,
      detected_projects: detectedProjects,
      features_created: 0
    });
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

function formatReply(results: { created: Array<{ title: string; subItems: number }>; merged: Array<{ title: string }> }): string {
  const { created, merged } = results;
  let text = '';

  if (created.length > 0) {
    text += `✅ Added ${created.length} to roadmap:\n`;
    created.forEach((f, i) => {
      text += `${i + 1}. ${f.title}`;
      if (f.subItems > 0) text += ` (+${f.subItems} options)`;
      text += `\n`;
    });
  }

  if (merged.length > 0) {
    if (created.length > 0) text += '\n';
    text += `🔗 Merged ${merged.length} into existing:\n`;
    merged.forEach((f, i) => {
      text += `${i + 1}. ${f.title}\n`;
    });
  }

  text += '\nVote at roadmapr.xyz';
  return text;
}

function formatStandaloneCast(
  feature: { title: string; id: string },
  parentCast: { author: { username: string } },
  author: { username: string } | null
): string {
  const username = author?.username || parentCast.author.username;
  return `📋 New on roadmap:\n\n"${feature.title}"\n\n` +
    `Suggested by @${username}\n` +
    `Vote: roadmapr.xyz/features/${feature.id}`;
}
