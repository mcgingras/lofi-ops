/**
 * Feature folders (src/client/features/<area>/index.ts), auto-imported. Kept in its own module and
 * imported by main.ts after the core screens: Vite hoists eager glob imports to the top of the
 * importing file, so a glob in main.ts itself would run the features BEFORE the core screens and
 * core would win `registerScreen('menu')` instead of the feature (CONTRACTS section 12).
 */
import.meta.glob('./features/*/index.ts', { eager: true });
