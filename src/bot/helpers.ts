import { getUser } from '../neynar/client.js';

export interface ParsedOwner {
  fid: number;
  username: string;
  bio: string;
}

/**
 * Parse owner from username or FID
 * Returns user info including their bio
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
      username: user.username,
      bio: user.profile?.bio?.text || ''
    };
  }

  // Check if it's a @username
  const usernameMatch = input.match(/^@?(\w+)$/);
  if (usernameMatch) {
    const username = usernameMatch[1];

    // Need to search by username - this requires Neyar's user search API
    // For now, return null and the calling code should handle this
    // TODO: Implement username search when needed
    return null;
  }

  return null;
}

/**
 * Extract owner, token, and bio from a reply text
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
