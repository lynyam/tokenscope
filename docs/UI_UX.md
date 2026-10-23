# UI and UX Setup

## Definitions
+ UI (User Interface) is what the user sees — the colors, fonts, buttons, inputs, and visual design configured by Tailwind and your shadcn preset.

+ UX (User Experience) is how the user feels using it — the ease, speed, and clarity of interacting with those styled components (e.g., a smooth login flow).

## Setup 

## 1. Configure TypeScript path

Add "paths": 

{ "@/*": ["./src/*"] }

* to frontend/tsconfig.json 
* and a matching resolve.alias entry in vite.config.js. 

This is a hard prerequisite — with or without a preset, the CLI checks for it and fails init if it's missing

## 2. Install Tailwind CSS

//TODO: rewrite instructioms synthesize real processes.

shadcn is built on Tailwind utility classes, so Tailwind must exist in frontend/ first. Utilitiy classes are defined in CSS, they serve to define different of the appeareance of the frontend. 

a. run:
```bash
    npm install tailwindcss @tailwindcss/vite
```
b. Add the Tailwind plugin to vite.config.js
TODO: remove/relocate this instruction

c. Import "tailwindcss" in your main CSS file.


## 3. Run the shadcn init command with appeareance config

1. Define preset(appearence of web application: colors, fonts and radius)

a. link to define preset:
https://ui.shadcn.com/create?preset=b1zfPaHfOq 


b. Choose preset value:
```bash
    --preset b1zfPaHfOq
```

2. From frontend/, run 
```bash
npx shadcn@latest init --preset b1zfPaHfOq --template vite -b base
```
It detects Vite + React + TS, asks the style/CSS-variable questions, and creates components.json plus a src/lib/utils.ts helper.


## 4. Add components 

example 1. One component
```bash
npx shadcn@latest add button 
```

example 2. Various components
```bash
npx shadcn@latest add button input label form card
```
Each pulls from the registry already styled according to your preset's CSS variables — you don't re-apply the preset per component

## 5. Wire components into existing pages

Swap your plain tags for the copied shadcn versions inside pages and wrappers, keeping your logic untouched. 
NOTE: Authentication components have been done, check files(SignInPage.tsx, SignUpPage.tsx, AuthLayout.tsx)


## 6. Present Change

Eventually, when preset wants to be updated, use this command

```bash
npx shadcn@latest init --preset <new-code> --force --no-reinstall
```

TODO: verify command, and file permissions in the project, could not change preset with this command 

## Notes:

Claude conversation to have context:
https://claude.ai/share/c5e31bfe-ea22-47cd-8885-6d8bb26fbd55

## Integrated public navigation and theme

`main.tsx` uses the already installed `next-themes` provider with `attribute="class"`.
It is shared by theme buttons and Sonner notifications. The saved `theme` preference
is independent of `tokenscope.accessToken`; theme changes do not change authentication.

`AppRouter.tsx` owns one `AuthProvider` boundary around the existing application
routes. `/privacy` and `/terms` are outside it and must render without calling
`/auth/me`, including with an invalid stored token or an unavailable API.

The sidebar preserves `useOrganizationProjects` and its `accessLost` handling.
At widths below 768px it uses the existing modal Dialog for focus containment,
Escape, explicit Close and focus return. Above that breakpoint it becomes a
fixed-width sidebar in the layout. Resizing navigation does not remount page content.

PR #40 covers this shared shell, theme and legal navigation. It does not establish
that every integrated page is responsive. TSE-88 still owns the full page/panel
matrix at 375 x 812, 768 x 1024 and 1440 x 900, including table scrolling, dialogs,
charts, exports, documents and the assistant. Record actual browser evidence;
do not treat component tests as proof of viewport geometry.
