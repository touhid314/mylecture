import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type AppConfig = {
  server: {
    host: string;
    port: number;
  };
  agent: {
    defaultTheme: string;
    defaultTeachingStyle: string;
    generationDir: string;
    enableGetimgTool: boolean;
    getimgwatchman: boolean;
    defaultAspectRatio: string;
    defaultLengthSeconds: number;
  };
  tts: {
    provider: string;
    voice: string;
    speed: number;
  };
  render: {
    fps: number;
    baseWidth: number;
    baseHeight: number;
  };
};

const defaultConfig: AppConfig = {
  server: {
    host: '127.0.0.1',
    port: 4307
  },
  agent: {
    defaultTheme: 'default',
    defaultTeachingStyle: 'default',
    generationDir: 'gens',
    enableGetimgTool: false,
    getimgwatchman: true,
    defaultAspectRatio: '16:9',
    defaultLengthSeconds: 60
  },
  tts: {
    provider: 'inworld',
    voice: 'happy-oriole-5206__mike',
    speed: 1
  },
  render: {
    fps: 30,
    baseWidth: 1920,
    baseHeight: 1080
  }
};

function parseScalar(value: string): unknown {
  const text = value.trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  const number = Number(text);
  return Number.isFinite(number) && /^-?\d+(?:\.\d+)?$/.test(text) ? number : text;
}

function parseSimpleYaml(content: string): Record<string, Record<string, unknown>> {
  const parsed: Record<string, Record<string, unknown>> = {};
  let section = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const sectionMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      parsed[section] ||= {};
      continue;
    }

    const fieldMatch = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (fieldMatch && section) {
      parsed[section] ||= {};
      parsed[section][fieldMatch[1]] = parseScalar(fieldMatch[2]);
    }
  }

  return parsed;
}

function stringValue(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function numberValue(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return fallback;
  return number;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeFileId(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.toLowerCase().endsWith('.md') ? trimmed.slice(0, -3) : trimmed;
}

function mergeConfig(raw: Record<string, Record<string, unknown>>): AppConfig {
  return {
    server: {
      host: stringValue(raw.server?.host, defaultConfig.server.host),
      port: Math.round(numberValue(raw.server?.port, defaultConfig.server.port, 1, 65535))
    },
    agent: {
      defaultTheme: normalizeFileId(stringValue(raw.agent?.defaultTheme, defaultConfig.agent.defaultTheme), defaultConfig.agent.defaultTheme),
      defaultTeachingStyle: normalizeFileId(stringValue(raw.agent?.defaultTeachingStyle, defaultConfig.agent.defaultTeachingStyle), defaultConfig.agent.defaultTeachingStyle),
      generationDir: stringValue(raw.agent?.generationDir, defaultConfig.agent.generationDir),
      enableGetimgTool: booleanValue(raw.agent?.enableGetimgTool, defaultConfig.agent.enableGetimgTool),
      getimgwatchman: booleanValue(raw.agent?.getimgwatchman, defaultConfig.agent.getimgwatchman),
      defaultAspectRatio: stringValue(raw.agent?.defaultAspectRatio, defaultConfig.agent.defaultAspectRatio),
      defaultLengthSeconds: numberValue(raw.agent?.defaultLengthSeconds, defaultConfig.agent.defaultLengthSeconds, 1)
    },
    tts: {
      provider: stringValue(raw.tts?.provider, defaultConfig.tts.provider),
      voice: stringValue(raw.tts?.voice, defaultConfig.tts.voice),
      speed: numberValue(raw.tts?.speed, defaultConfig.tts.speed, 0.1, 4)
    },
    render: {
      fps: Math.round(numberValue(raw.render?.fps, defaultConfig.render.fps, 1, 240)),
      baseWidth: Math.round(numberValue(raw.render?.baseWidth, defaultConfig.render.baseWidth, 1)),
      baseHeight: Math.round(numberValue(raw.render?.baseHeight, defaultConfig.render.baseHeight, 1))
    }
  };
}

export function loadAppConfig(rootDir = process.cwd()): AppConfig {
  const configPath = path.resolve(rootDir, 'config.yaml');
  if (!existsSync(configPath)) {
    return defaultConfig;
  }
  return mergeConfig(parseSimpleYaml(readFileSync(configPath, 'utf8')));
}

export function resolveConfigPath(rootDir: string, value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootDir, value);
}
