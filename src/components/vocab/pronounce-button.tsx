'use client';

import { useState, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface PronounceButtonHandle {
  /** Programmatically trigger pronunciation (e.g. keyboard hotkey). */
  play: () => void;
}

interface PronounceButtonProps {
  word: string;
  /** Real human-recording MP3 URL (Free Dictionary API). Falls back to TTS if absent/fails. */
  audioUrl?: string | null;
  size?: 'sm' | 'md';
  className?: string;
  /** Accessible label override. */
  label?: string;
}

/**
 * Play a word's pronunciation.
 *
 * Strategy: prefer a real human-recording MP3 (audioUrl); if it's missing or
 * fails to load, fall back to the browser's SpeechSynthesis (TTS). TTS covers
 * every word (including the existing library and offline use) so pronunciation
 * is always available.
 */
export const PronounceButton = forwardRef<PronounceButtonHandle, PronounceButtonProps>(
  function PronounceButton({ word, audioUrl, size = 'sm', className, label }, ref) {
    const [playing, setPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (playingTimerRef.current) clearTimeout(playingTimerRef.current);
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        audioRef.current?.pause();
      };
    }, []);

    const flashPlaying = useCallback(() => {
      setPlaying(true);
      if (playingTimerRef.current) clearTimeout(playingTimerRef.current);
      playingTimerRef.current = setTimeout(() => setPlaying(false), 1200);
    }, []);

    const speakTTS = useCallback((text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = 0.95;
      // Try to pick an English (preferably US) voice
      const voices = synth.getVoices();
      const voice =
        voices.find(v => v.lang === 'en-US') ??
        voices.find(v => v.lang?.toLowerCase().startsWith('en'));
      if (voice) utter.voice = voice;
      utter.onstart = flashPlaying;
      synth.speak(utter);
      // Fallback flash in case onstart doesn't fire (some browsers)
      flashPlaying();
    }, [flashPlaying]);

    const play = useCallback(() => {
      // Try the real recording first
      if (audioUrl) {
        // Reuse a single Audio element per button
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        const audio = audioRef.current;
        audio.src = audioUrl;
        audio.play()
          .then(() => {
            flashPlaying();
          })
          .catch(() => {
            // Autoplay rejection or load failure -> TTS fallback
            speakTTS(word);
          });
        return;
      }
      // No recording -> TTS
      speakTTS(word);
    }, [audioUrl, word, speakTTS, flashPlaying]);

    useImperativeHandle(ref, () => ({ play }), [play]);

    const dim = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
    const icon = size === 'sm' ? 13 : 17;

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          play();
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors',
          'hover:text-primary hover:bg-primary/10',
          playing && 'text-primary bg-primary/10',
          dim,
          className,
        )}
        title={label ?? `朗读 "${word}"`}
        aria-label={label ?? `朗读 ${word}`}
      >
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      </button>
    );
  }
);
