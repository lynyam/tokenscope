import { defineConfig } from 'vite'
// needed to resolve the "@" alias to an absolute path
import path from 'path' 
// ESM has no __dirname, this recreates it
import { fileURLToPath } from 'url' 
// Tailwind's Vite plugin, does the CSS scanning/build
import tailwindcss from '@tailwindcss/vite' 

const backenUrl = process.env.BACKEND_URL;
console.log(backenUrl);

// recreate __dirname in ESM context
const __dirname = path.dirname(fileURLToPath(import.meta.url)); 

export default defineConfig({
	// registers Tailwind so it processes your CSS on build/dev
	plugins: [tailwindcss()], 
	resolve: {
		alias: {
			// makes "@/components/ui/button" resolve to src/components/ui/button
			'@': path.resolve(__dirname, './src'), 
		},
	},	
	server: {
		proxy: {
			'/api': {
				target: backenUrl,
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, ''),
			},
		},
	},
})


/**
 * TODO:
 * Do I need @thingy?
 * prompt to explain more completely the role of Vite
 *  + Both are instructions read by tools before your code ever ships — one 
 *    by the bundler, one by the type checker/editor.
 *  + vite.config.js: Tells Vite how to build and serve your app.
 * 		> which plugins to run (React, Tailwind)
 * 		> how to resolve import shortcuts like @/, 
 * 		> how to proxy /api calls to your NestJS backend during local dev.
 *  + tsconfig.json: Tells TypeScript how to type-check your app. For type checking time.
 * 		> what JS features are allowed (target)
 * 		> how strict to be about types (strict)
 * 		>@/ shortcut — how to resolve it so your editor doesn't flag imports as errors.
 * Vite configuration: makes the @ path actually work at build time (bundler resolves the import)
 */