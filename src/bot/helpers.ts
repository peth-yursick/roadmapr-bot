import { getUser, lookupUserByUsername } from '../neynar/client.js';

export interface ParsedOwner {
  fid: number;
  username: string;
}

export interface ParsedProjectInfo {
  owner: ParsedOwner;
  token: string;
  bio?: string;
  needsBio: boolean;
}

/**
 * Parse owner from username or FID
 * @param ownerInput - The owner input (username or FID)
 * @param botFid - The bot's FID (fallback if owner == 'roadmapr')
 */
export async function parseOwner(ownerInput: string, botFid?: number): Promise<ParsedOwner | null> {
  const input = ownerInput.trim().replace('@', '');

  // Check if it's a FID (number)
  const fidMatch = input.match(/^\d+$/);
  if (fidMatch) {
    const fid = parseInt(input);
    const user = await getUser(fid);
    if (!user) return null;

    return {
      fid,
      username: user.username
    };
  }

  // Check if it's a @username
  const usernameMatch = input.match(/^@?(\w+)$/);
  if (usernameMatch) {
    const username = usernameMatch[1];

    // Special case: if owner is 'roadmapr' and we have botFid, use that
    if (username.toLowerCase() === 'roadmapr' && botFid) {
      console.log(`[Helpers] Owner is 'roadmapr' - using bot FID: ${botFid}`);
      return {
        fid: botFid,
        username: 'roadmapr'
      };
    }

    const user = await lookupUserByUsername(username);
    if (!user) return null;

    return {
      fid: user.fid,
      username: user.username
    };
  }

  return null;
}

/**
 * Extract project handle, owner and token from a reply text
 * Supports formats like:
 * "Project: @roadmapr, Owner: @peth, Token: clanker"
 * "project is @roadmapr, owner is @roadmapr, will define token later"
 * "Owner: 12345, Token: 0x1234..."
 */
export function parseProjectSetupReply(text: string): {
  project?: string;
  owner?: string;
  token?: string;
} {
  const result: { project?: string; owner?: string; token?: string } = {};

  // Extract project handle (supports "project is @handle", "project: @handle", etc.)
  const projectMatch = text.match(/project[:\s]+is[:\s]+@(\w+)|project[:\s]+@(\w+)/i);
  if (projectMatch) {
    result.project = projectMatch[1] || projectMatch[2];
  }

  // Extract owner
  const ownerMatch = text.match(/owner[:\s]+is[:\s]+(@?\w+|@?\d+)|owner[:\s]+(@?\w+|@?\d+)/i);
  if (ownerMatch) {
    result.owner = ownerMatch[1] || ownerMatch[2];
    result.owner = result.owner.trim();
  }

  // Extract token
  const tokenMatch = text.match(/token[:\s]+is[:\s]+(\w+)|token[:\s]+(\w+)|will define token later/i);
  if (tokenMatch) {
    result.token = tokenMatch[1] || tokenMatch[2] || "clanker";
    if (result.token) {
      result.token = result.token.trim();
    }
  }

  return result;
}

/**
 * Get project bio from the project's Farcaster profile
 */
export async function getProjectBio(projectHandle: string): Promise<string | null> {
  try {
    const user = await lookupUserByUsername(projectHandle);
    if (user?.profile?.bio?.text) {
      return user.profile.bio.text;
    }
    return null;
  } catch (err) {
    console.error(`[Helpers] Failed to get bio for @${projectHandle}:`, err);
    return null;
  }
}
