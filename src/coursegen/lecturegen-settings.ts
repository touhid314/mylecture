/**
 * LectureGen settings-block text for coursegen prompts.
 * Kept in coursegen so we do not patch mylecture-agent lecturegen on this branch.
 * Marker string must match mylecture-agent/src/lecturegen.ts SETTINGS_MARKER.
 */

export const SETTINGS_MARKER =
  'if the user query is for lecture generation then follow this:';

export function buildLectureGenSettingsText(options: {
  aspectRatio?: string;
  generationLength?: string;
  embedSubtitle?: boolean;
  enableGetimg?: boolean;
  includeVideo?: boolean;
  includeInteractive?: boolean;
  includeGame?: boolean;
  theme?: string;
  teachingStyle?: string;
  profile?: string;
}): string {
  const includeVideo = options.includeVideo !== false;
  const includeInteractive = options.includeInteractive === true;
  const includeGame = options.includeGame === true;
  return [
    SETTINGS_MARKER,
    `aspect ratio: ${options.aspectRatio || '16:9'}`,
    `generation length: ${options.generationLength || '1:00'}`,
    `embed subtitle in video: ${options.embedSubtitle === true ? 'yes' : 'no'}`,
    `getimg enabled: ${options.enableGetimg === false ? 'no' : 'yes'}`,
    `output video: ${includeVideo ? 'yes' : 'no'}`,
    `output interactive: ${includeInteractive ? 'yes' : 'no'}`,
    `output practice game: ${includeGame ? 'yes' : 'no'}`,
    options.theme ? `theme: ${options.theme}` : '',
    options.teachingStyle ? `teaching style: ${options.teachingStyle}` : '',
    options.profile ? `profile: ${options.profile}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function mergeLectureGenSettings(
  explicit: any,
  parsed: any
) {
  return {
    aspectRatio: explicit.aspectRatio || parsed.aspectRatio,
    generationLength: explicit.generationLength || parsed.generationLength,
    embedSubtitle: explicit.embedSubtitle !== undefined ? explicit.embedSubtitle : parsed.embedSubtitle,
    enableGetimg: explicit.enableGetimg !== undefined ? explicit.enableGetimg : parsed.enableGetimg,
    includeVideo: explicit.includeVideo !== undefined ? explicit.includeVideo : parsed.includeVideo,
    includeInteractive: explicit.includeInteractive !== undefined ? explicit.includeInteractive : parsed.includeInteractive,
    includeGame: explicit.includeGame !== undefined ? explicit.includeGame : parsed.includeGame,
    theme: explicit.theme || parsed.theme,
    teachingStyle: explicit.teachingStyle || parsed.teachingStyle,
    profile: explicit.profile || parsed.profile
  };
}
