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
 */
export async function parseOwner(ownerInput: string): Promise<ParsedOwner | null> {
  const input = ownerInput.trim();

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
 * Extract owner and token from a reply text
 * Supports formats like:
 * "Owner: @peth, Token: clanker"
 * "Owner: 12345, Token: 0x1234..."
 */
export function parseProjectSetupReply(text: string): {
  owner?: string;
  token?: string;
} {
  const result: { owner?: string; token?: string } = {};

  // Extract owner
  const ownerMatch = text.match(/owner[:\s]+(@?\w+|@?\d+)/i);
  if (ownerMatch) {
    result.owner = ownerMatch[1].trim();
  }

  // Extract token
  const tokenMatch = text.match(/token[:\s]+(\w+)/i);
  if (tokenMatch) {
    result.token = tokenMatch[1].trim();
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
