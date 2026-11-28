import { registerPlugin } from '@capacitor/core';

/** `images`: how many pictures (screenshots) were shared instead of a link. */
export type AndroidShare = { id: string; text?: string; checkpoint?: string; images?: number };

export const nativeShare = registerPlugin<{
  send(options: { text: string }): Promise<void>;
  getShare(): Promise<Partial<AndroidShare>>;
  /** The shared screenshots, shrunk by the phone, as JPEG data links. */
  getImages(options: { id: string }): Promise<{ images: string[] }>;
  remember(options: { id: string; value: string }): Promise<void>;
  dismiss(options: { id: string }): Promise<void>;
  openPlan(options: { id: string; value: string }): Promise<void>;
  takePlan(): Promise<{ value?: string }>;
  working(options: { id: string; working: boolean }): Promise<void>;
  background(options: { id: string }): Promise<{ moved: boolean }>;
  ready(options: { id: string; found: boolean }): Promise<void>;
  addListener(event: 'incoming' | 'plan' | 'close', listener: () => void): Promise<{ remove(): Promise<void> }>;
}>('UnsavedShare');
