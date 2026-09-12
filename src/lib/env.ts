import { z } from 'zod';
const schema = z.object({
  ga: z
    .string()
    .regex(/^G-[A-Z0-9]+$/)
    .optional(),
  site: z.string().url(),
});
export const env = schema.parse({
  ga: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || undefined,
  site: process.env.NEXT_PUBLIC_SITE_URL || 'https://blr-traffic.sush.dev',
});
