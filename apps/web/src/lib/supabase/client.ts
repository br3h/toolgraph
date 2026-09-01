'use client';

/**
 * Supabase client for browser code.
 *
 * Uses the publishable key only. Every query it makes is subject to Row Level
 * Security, which is what makes it safe to hand to a browser at all.
 */

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '../public-env';

export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
}
