/**
 * Browser runtime for contract-compliant lecture HTML.
 *
 * This module owns playback state, timeline derivation, audio/subtitle sync,
 * viewport detection, and the event API consumed by the IDE/website shells.
 */
export declare const lectureViewerVersion = "0.2";
export declare function createLecturePlayer(options?: {}): LecturePlayer;
export declare function estimateTextDuration(text: any): number;
export declare function normalizeSectionKind(kind: any): any;
export declare function viewportFromAspectRatio(aspectRatio: any): any;
export declare function detectDocumentViewport(win: any): {
    width: number;
    height: number;
};
export declare function detectMetadataViewport(win: any): any;
export declare function buildPreviewTimeline(win: any): any;
export declare function buildInteractiveTimeline(win: any): any[];
export declare function buildGameTimeline(win: any): any[];
export declare function buildAudioTimeline(win: any, videoTimeline: any): any;
export declare function buildSubtitleTimeline(audioTimeline: any, videoTimeline: any): any[];
declare class LecturePlayer {
    constructor(options?: {});
    createInitialState(): {
        loaded: boolean;
        playing: boolean;
        duration: number;
        time: number;
        startedAt: number;
        startTime: number;
        raf: number;
        timeline: any[];
        audioTimeline: any[];
        subtitleTimeline: any[];
        interactiveTimeline: any[];
        gameTimeline: any[];
        audio: any;
        audioCue: any;
        audioFailures: Set<unknown>;
        speechSegmentKey: string;
        volume: number;
        muted: boolean;
        completed: boolean;
        interactiveActive: boolean;
        gameActive: boolean;
        metadata: {};
        resolved: boolean;
        src: string;
    };
    on(type: any, handler: any): () => void;
    off(type: any, handler: any): void;
    emit(type: any, payload: any): void;
    snapshot(): {
        loaded: any;
        playing: any;
        duration: any;
        time: any;
        completed: any;
        interactiveActive: any;
        gameActive: any;
        timeline: any;
        audioTimeline: any;
        subtitleTimeline: any;
        interactiveTimeline: any;
        gameTimeline: any;
        metadata: any;
        resolved: any;
        subtitlesEnabled: any;
        liveTtsEnabled: any;
        speed: any;
        volume: any;
        muted: any;
        src: any;
    };
    setStatus(message: any): void;
    load(src: any): Promise<unknown>;
    prepareForFrameSwap(src: any): void;
    resetForLoad(): void;
    handleFrameLoad(): void;
    setSpeed(speed: any): void;
    setVolume(volume: any, options?: {}): void;
    setMuted(muted: any): void;
    applyVolume(): void;
    setSubtitlesEnabled(enabled: any): void;
    setLiveTtsEnabled(enabled: any): void;
    activeVideoCue(): any;
    activeAudioCue(): any;
    audioCueKey(cue: any): any;
    audioUrl(src: any): string;
    stopAudio(): void;
    stopLiveTts(): void;
    selectLiveTtsVoice(): SpeechSynthesisVoice;
    syncLiveTts(): void;
    syncAudio(): void;
    renderAt(time: any): void;
    stopInteractiveSection(): void;
    stopGameSection(): void;
    tick(now: any): void;
    play(): void;
    pause(): void;
    togglePlay(): void;
    seek(time: any, options?: {}): void;
    seekBy(deltaSeconds: any): void;
    startInteractiveSection(): void;
    startGameSection(): void;
    seekToInteractive(): void;
    seekToGame(): void;
    updateSubtitleOverlay(): void;
    destroy(): void;
}
export {};
