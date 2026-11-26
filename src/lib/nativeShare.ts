import { registerPlugin } from '@capacitor/core';

export type AndroidShare = { id: string; text?: string; checkpoint?: string };

export const nativeShare = registerPlugin<{
  send(options: { text: string }): Promise<void>;
  getShare(): Promise<Partial<AndroidShare>>;
  remember(options: { id: string; value: string }): Promise<void>;
  dismiss(options: { id: string }): Promise<void>;
  openPlan(options: { id: string; value: string }): Promise<void>;
  takePlan(): Promise<{ value?: string }>;
  working(options: { id: string; working: boolean }): Promise<void>;
  background(options: { id: string }): Promise<{ moved: boolean }>;
  ready(options: { id: string; found: boolean }): Promise<void>;
  addListener(event: 'incoming' | 'plan' | 'close', listener: () => void): Promise<{ remove(): Promise<void> }>;
}>('UnsavedShare');
