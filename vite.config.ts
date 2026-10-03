import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'GOOGLE_MAPS_API_KEY'],
});
