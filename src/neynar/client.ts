import { NeynarAPIClient, CastParamType } from '@neynar/nodejs-sdk';

if (!process.env.NEYNAR_API_KEY) {
  throw new Error('Missing NEYNAR_API_KEY');
}

const client = new NeynarAPIClient(process.env.NEYNAR_API_KEY);

export interface Cast {
  hash: string;
  text: string;
  author: {
    fid: number;
    username: string;
    display_name: string;
    pfp_url: string;
  };
  parent_hash?: string;
  channel?: {
    id: string;
    name: string;
  };
}

export async function getCast(hash: string): Promise<Cast | null> {
  try {
    const result = await client.lookUpCastByHashOrWarpcastUrl(
      hash,
      CastParamType.Hash,
      {} // No options needed by default
    );

    if (!result?.cast) {
      return null;
    }

    const cast = result.cast;
    return {
      hash: cast.hash,
      text: cast.text,
      author: {
        fid: cast.author.fid,
        username: cast.author.username,
        display_name: cast.author.display_name || cast.author.username,
        pfp_url: cast.author.pfp_url || '',
      },
      parent_hash: cast.parent_hash || undefined,
      channel: cast.channel ? {
        id: cast.channel.id,
        name: cast.channel.name || cast.channel.id,
      } : undefined,
    };
  } catch (err) {
    console.error('Get cast error:', err);
    return null;
  }
}

export async function getCastThread(parentHash: string): Promise<Cast[]> {
  try {
    const result = await client.lookupCastConversation(
      parentHash,
      CastParamType.Hash,
      { replyDepth: 2 }
    );

    // Extract replies from the conversation
    const replies: Cast[] = [];

    // The conversation structure varies - try to extract direct replies
    // Different versions of the API return different structures
    const conversation = (result as any)?.conversation;

    if (conversation?.direct_replies) {
      for (const reply of conversation.direct_replies) {
        replies.push({
          hash: reply.hash,
          text: reply.text,
          author: {
            fid: reply.author.fid,
            username: reply.author.username,
            display_name: reply.author.display_name || reply.author.username,
            pfp_url: reply.author.pfp_url || '',
          },
        });
      }
    } else if (conversation?.replies) {
      for (const reply of conversation.replies) {
        replies.push({
          hash: reply.hash,
          text: reply.text,
          author: {
            fid: reply.author.fid,
            username: reply.author.username,
            display_name: reply.author.display_name || reply.author.username,
            pfp_url: reply.author.pfp_url || '',
          },
        });
      }
    }

    return replies;
  } catch (err) {
    console.error('Get thread error:', err);
    return [];
  }
}

export async function postReply(replyToHash: string, text: string) {
  if (!process.env.NEYNAR_BOT_SIGNER_UUID) {
    console.error('Missing NEYNAR_BOT_SIGNER_UUID');
    return;
  }

  try {
    await client.publishCast(
      process.env.NEYNAR_BOT_SIGNER_UUID,
      text,
      { replyTo: replyToHash }
    );
    console.log('Posted reply:', text.slice(0, 50));
  } catch (err) {
    console.error('Post reply error:', err);
  }
}

export async function postStandaloneCast(text: string, embedHash?: string) {
  if (!process.env.NEYNAR_BOT_SIGNER_UUID) {
    console.error('Missing NEYNAR_BOT_SIGNER_UUID');
    return;
  }

  try {
    const options: { embeds?: Array<{ castId?: { fid: number; hash: string } }> } = {};

    if (embedHash) {
      // Need to extract fid from the cast or use a default
      // For now, just use the hash - the API will fill in the rest
      options.embeds = [{ castId: { fid: 0, hash: embedHash } }];
    }

    await client.publishCast(
      process.env.NEYNAR_BOT_SIGNER_UUID,
      text,
      options
    );
    console.log('Posted cast:', text.slice(0, 50));
  } catch (err) {
    console.error('Post cast error:', err);
  }
}

export async function getNeynarScore(fid: number): Promise<number> {
  try {
    const result = await client.fetchBulkUsers([fid]);
    const user = result?.users?.[0];
    return (user as any)?.experimental?.neynar_user_score || 0;
  } catch (err) {
    console.error('Get score error:', err);
    return 0;
  }
}

export async function getUser(fid: number) {
  try {
    const result = await client.fetchBulkUsers([fid]);
    const user = result?.users?.[0];
    if (!user) return null;

    return {
      fid: user.fid,
      username: user.username,
      display_name: user.display_name || user.username,
      pfp_url: user.pfp_url || '',
      score: (user as any)?.experimental?.neynar_user_score || 0,
    };
  } catch (err) {
    console.error('Get user error:', err);
    return null;
  }
}
