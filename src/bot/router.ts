import type { Cast } from '../neynar/client.js';
import { getAllProjects } from '../db/projects.js';

export async function detectProjects(text: string, cast: Cast): Promise<string[]> {
  const detectedHandles = new Set<string>();

  // Get all existing project handles for matching
  const allProjects = await getAllProjects();
  const projectHandles = new Set(allProjects.map(p => p.project_handle.toLowerCase()));

  // Method 1: Direct @mentions in text
  const mentions = text.match(/@(\w+)/g) || [];
  for (const mention of mentions) {
    const handle = mention.slice(1).toLowerCase();
    // Filter out the bot mention and common non-project mentions
    if (handle !== 'roadmapr' && handle.length > 2) {
      // Only add if it's a known project
      if (projectHandles.has(handle)) {
        detectedHandles.add(handle);
      }
    }
  }

  // Method 2: "for @project" or "on @project" patterns
  const patterns = [
    /(?:for|on|about|regarding)\s+@(\w+)/gi,
    /@(\w+)\s+(?:needs|should|must|could)/gi,
    /(?:the|this)\s+@(\w+)/gi
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const handle = match[1].toLowerCase();
      if (projectHandles.has(handle)) {
        detectedHandles.add(handle);
      }
    }
  }

  // Method 3: Channel context (if cast is in a project's channel)
  if (cast.channel?.id) {
    const channelId = cast.channel.id.toLowerCase();
    if (projectHandles.has(channelId)) {
      detectedHandles.add(channelId);
    }
  }

  // Method 4: Look for project names mentioned (not just handles)
  const lowerText = text.toLowerCase();
  for (const project of allProjects) {
    const projectName = project.name.toLowerCase();
    if (lowerText.includes(projectName) && projectName.length > 3) {
      detectedHandles.add(project.project_handle);
    }
  }

  return Array.from(detectedHandles);
}

// Detect if someone is trying to mention a project that doesn't exist yet
export async function detectNewProjects(text: string): Promise<string[]> {
  const allProjects = await getAllProjects();
  const projectHandles = new Set(allProjects.map(p => p.project_handle.toLowerCase()));

  const newHandles: string[] = [];

  // Look for @mentions that aren't existing projects
  const mentions = text.match(/@(\w+)/g) || [];
  for (const mention of mentions) {
    const handle = mention.slice(1).toLowerCase();
    if (handle !== 'roadmapr' && handle.length > 2 && !projectHandles.has(handle)) {
      newHandles.push(handle);
    }
  }

  return newHandles;
}
