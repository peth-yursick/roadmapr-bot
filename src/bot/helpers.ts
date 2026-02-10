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
 * "im the owner, token is $ROAD token address 0x..."
 */
export function parseProjectSetupReply(text: string): {
  project?: string;
  owner?: string;
  token?: string;
} {
  const result: { project?: string; owner?: string; token?: string } = {};
  const lowerText = text.toLowerCase();

  // Extract project handle (supports "project is @handle", "project: @handle", etc.)
  const projectMatch = text.match(/project[:\s]+is[:\s]+@(\w+)|project[:\s]+@(\w+)/i);
  if (projectMatch) {
    result.project = projectMatch[1] || projectMatch[2];
  }

  // Extract owner - flexible patterns that allow words in between
  // Pattern 1: "Owner: @username" or "Owner is @username" or "Owner: 12345"
  const ownerExplicit = text.match(/owner[:\s]+(?:is[:\s]+)?(@?\w+)/i);
  if (ownerExplicit) {
    const val = ownerExplicit[1].trim();
    // Don't capture noise words as owner
    if (!['the', 'a', 'an', 'me', 'my', 'is', 'and', 'or', 'of', 'for'].includes(val.toLowerCase())) {
      result.owner = val;
    }
  }

  // Pattern 2: Self-identification as owner - very flexible
  // Matches: "im the owner", "im the project owner", "i am owner", "i'm an owner",
  // "im owner of this", "the owner is me", "owner is me", etc.
  if (!result.owner) {
    const isSelfOwner =
      /\bi['\u2019]?m\b.{0,20}\bowner\b/i.test(lowerText) ||   // "im [anything short] owner"
      /\bi\s+am\b.{0,20}\bowner\b/i.test(lowerText) ||          // "i am [anything short] owner"
      /\bowner\b.{0,10}\b(?:is\s+)?me\b/i.test(lowerText) ||    // "owner [is] me"
      /\bme\b.{0,10}\bas\s+(?:the\s+)?owner\b/i.test(lowerText); // "me as [the] owner"
    if (isSelfOwner) {
      result.owner = 'me';
    }
  }

  // Extract token - handle names, addresses, and natural language
  // Token address (0x...)
  const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
  if (addressMatch) {
    result.token = addressMatch[0];
  }
  // $SYMBOL format
  if (!result.token) {
    const symbolMatch = text.match(/\$([a-zA-Z]{2,})/);
    if (symbolMatch) {
      result.token = symbolMatch[1];
    }
  }
  // "token: X" or "token is X" or "token X"
  if (!result.token) {
    const tokenMatch = text.match(/token\s+(?:is\s+|:\s*)?(\S+)/i);
    if (tokenMatch) {
      let val = tokenMatch[1].replace(/[,&.!?]+$/, ''); // strip trailing punctuation
      if (val.startsWith('$')) val = val.slice(1);
      if (val && !['the', 'a', 'is', 'my', 'for'].includes(val.toLowerCase())) {
        result.token = val;
      }
    }
  }
  // "clanker" mentioned anywhere
  if (!result.token && /\bclanker\b/i.test(lowerText)) {
    result.token = 'clanker';
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
