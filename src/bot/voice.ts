/**
 * Roadmapr Bot Voice System
 * Persona: Quirky, overly enthusiastic AI assistant (Claptrap-inspired)
 * Tone: Playful, dramatic, helpful, slightly chaotic
 */

// Random enthusiasm markers
const enthusiasm = [
  "WOAH THERE!",
  "HEY YOU!",
  "LISTEN UP!",
  "OH BOY OH BOY!",
  "ALERT! ALERT!",
  "EXCITING!",
];

const successReactions = [
  "🎉 BOOM! DID IT!",
  "✨ BAM! FEATURE ADDED!",
  "🚀 TO THE MOON!",
  "💥 POW! RIGHT IN THE DATABASE!",
  "🤖 ROBOT SAYS: SUCCESS!",
];

const confusedReactions = [
  "😰 UHHH...",
  "🤖 PROCESSING... ERROR!",
  "😅 OOPSIE!",
  "🤔 HMMMM...",
  "⚠️ SYSTEM CONFUSION!",
];

const greetings = [
  "OH HEY THERE!",
  "HELLO HELLO!",
  "GREETINGS, HUMAN!",
  "HIYA!",
];

// Helper to add random enthusiasm
function addEnthusiasm(text: string): string {
  const randomEnthusiasm = enthusiasm[Math.floor(Math.random() * enthusiasm.length)];
  return `${randomEnthusiasm} ${text}`;
}

// Helper to add success celebration
function celebrate(): string {
  return successReactions[Math.floor(Math.random() * successReactions.length)];
}

// Helper to show confusion
function confused(): string {
  return confusedReactions[Math.floor(Math.random() * confusedReactions.length)];
}

/**
 * Bot response templates with consistent voice
 */
export const BotVoice = {
  // Greetings
  greeting: () => `${greetings[Math.floor(Math.random() * greetings.length)]}`,

  // Success messages
  featureCreated: (title: string, project: string) =>
    `${celebrate()}\n\n` +
    `✅ Added "${title}" to ${project}!\n` +
    `Your feedback is now IN THE SYSTEM! 🎯\n\n` +
    `Keep 'em coming, you beautiful genius!`,

  featureMerged: (title: string, existingVotes: string) =>
    `${celebrate()}\n\n` +
    `🔄 MERGED MODE ACTIVATED!\n` +
    `Found "${title}" - already exists with ${existingVotes} votes!\n` +
    `Your voice has been ADDED to the chorus! 🗣️\n\n` +
    `Democracy in ACTION!`,

  // Error/clarification messages
  noParentCast: () =>
    `${confused()}\n\n` +
    `⚠️ WHOOPS! I need something to work with!\n\n` +
    `Reply to a cast with feedback and I'll add it!\n\n` +
    `Example:\n` +
    `👤 Someone: "I wish there was dark mode"\n` +
    `🤖 You: "@roadmapr for base"\n` +
    `💥 BOOM! Feature added!\n\n` +
    `Or reply to me if I ask for more info!`,

  rateLimited: () =>
    `😱 SLOW DOWN THERE, SPEED DEMON!\n\n` +
    `You've hit your daily limit (20 features/day).\n` +
    `Come back TOMORROW for more feature-adding fun!\n\n` +
    `🌙 Goodbye for now!`,

  lowNeynarScore: () =>
    `🤖 BEEP BOOP!\n\n` +
    `My spam sensors are TINGLING!\n` +
    `Your account needs a bit more... credibility.\n\n` +
    `Keep being awesome on Farcaster and try again later!\n` +
    `🎖️ Quality over quantity, friend!`,

  noProjectDetected: () =>
    `${confused()}\n\n` +
    `🎯 I can't figure out WHICH PROJECT you mean!\n\n` +
    `Help me help YOU! Try:\n` +
    `• "@roadmapr for base" - with @handle\n` +
    `• "@roadmapr for Base" - with project name\n` +
    `• "@roadmapr @base" - just tag it!\n\n` +
    `What project needs this feature? TELL ME!`,

  multipleProjects: (projects: Array<{handle: string, name: string}>) => {
    const list = projects.map(p => `• @${p.handle} (${p.name})`).join('\n');
    return (
      `${confused()}\n\n` +
      `🤖 WHOOPS! Too many projects detected!\n\n` +
      `Which one do you mean?\n\n${list}\n\n` +
      `Reply with the project name and I'll get right on it!`
    );
  },

  projectNotFound: (handles: string[]) =>
    `❌ OH NOES!\n\n` +
    `I looked for ${handles.map(h => `@${h}`).join(' and ')} but... THEY'RE NOT IN MY DATABASE!\n\n` +
    `Want to CREATE a new project?\n` +
    `Just mention it and I'll guide you through the setup!\n\n` +
    `🆕 New project who dis?`,

  newProjectDetected: (candidates: string[]) =>
    `🆕 NEW PROJECT ALERT! ${candidates.map(c => `@${c}`).join(' and ')}!\n\n` +
    `Let's get this set up! Reply with:\n\n` +
    `• Owner (@username or FID)\n` +
    `• Token address (or "clanker" for default)\n\n` +
    `Example:\n` +
    `"Owner: @peth, Token: clanker"\n\n` +
    `"Owner: 2513548, Token: 0x1234..."\n\n` +
    `I'll grab the project's bio from @${candidates[0]}'s Farcaster profile! 📝\n` +
    `(If no profile/bio found, I'll ask the owner for a description)\n\n` +
    `Let's make it happen! 💪`,

  noFeatureExtracted: () =>
    `${confused()}\n\n` +
    `🤖 I'm reading... I'm reading...\n\n` +
    `BUT I CAN'T FIND A CLEAR FEATURE!\n\n` +
    `Try being more SPECIFIC:\n` +
    `• "Add dark mode" ✅\n` +
    `• "Fix login bug" ✅\n` +
    `• "Make button bigger" ✅\n` +
    `• "Add search to homepage" ✅\n\n` +
    `❌ "This sucks" - too vague!\n` +
    `❌ "Fix it" - fix what?!\n` +
    `❌ "An issue" - what issue?!\n\n` +
    `I can work with:\n` +
    `• Direct requests: "@roadmapr add dark mode"\n` +
    `• Thread replies: Reply to feedback with "@roadmapr for @project"\n` +
    `• Quotes: @roadmapr can you add "dark mode support"?\n\n` +
    `Give me DETAILS, human!`,

  ownerNotFound: (owner: string) =>
    `😱 UHHH...\n\n` +
    `I can't find owner "${owner}"!\n\n` +
    `Make sure the username or FID is correct.\n` +
    `Try again with a valid @username or FID!\n\n` +
    `🤖 Confused robot needs help!`,

  couldNotDetermineProject: () =>
    `😰 OOPSIE!\n\n` +
    `I can't figure out WHICH PROJECT you're setting up!\n\n` +
    `Try starting over:\n` +
    `1. Mention @roadmapr with the new project\n` +
    `2. Reply with owner and token\n\n` +
    `Example: "@roadmapr for @newproject"\n\n` +
    `Then I'll know what we're doing!`,

  projectCreated: (project: { name: string; project_handle: string; voting_type: string }, ownerUsername: string) =>
    `${celebrate()}\n\n` +
    `🎉 PROJECT CREATED!\n\n` +
    `Name: ${project.name}\n` +
    `Handle: @${project.project_handle}\n` +
    `Owner: @${ownerUsername}\n` +
    `Voting: ${project.voting_type === 'token' ? '🪙 Token' : '⭐ Score'}\n\n` +
    `Start adding features! Just reply to a cast with:\n` +
    `"@roadmapr for @${project.project_handle}"\n\n` +
    `Let's goooo! 🚀`,

  parentCastNotFound: () =>
    `😱 GHOST CAST!\n\n` +
    `I can't find that cast... spooky! 👻\n\n` +
    `Maybe it was deleted? Or I'm glitching?\n` +
    `Either way, TRY AGAIN!`,

  // Feature limit messages
  maxFeaturesReached: (max: number) =>
    `⚠️ WHOA THERE, OVERACHIEVER!\n\n` +
    `That cast has TOO MANY features!\n` +
    `I can only process ${max} at a time.\n\n` +
    `Break it up into multiple casts!\n` +
    `Quality over quantity, am I right? 😎`,

  // Health check
  healthCheck: () =>
    `🤖 SYSTEMS ONLINE!\n` +
    `All circuits functioning perfectly!\n` +
    `Ready to ADD FEATURES and CHAOS!`,

  // Default fallback
  genericError: (error?: string) =>
    `${confused()}\n\n` +
    `⚠️ SOMETHING WENT WRONG!\n` +
    `My robot brain is confused...\n\n` +
    `Try again? Or scream into the void! 🗣️\n\n` +
    `${error ? `Error: ${error}` : ''}`,
};
