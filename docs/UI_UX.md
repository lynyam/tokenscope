# UI and UX Setup



## Definitions
+ UI (User Interface) is what the user sees — the colors, fonts, buttons, inputs, and visual design configured by Tailwind and your shadcn preset.

+ UX (User Experience) is how the user feels using it — the ease, speed, and clarity of interacting with those styled components (e.g., a smooth login flow).

## Setup 

## 1. Configure TypeScript path

Add "paths": 

{ "@/*": ["./src/*"] }

to frontend/tsconfig.json and a matching resolve.alias entry in vite.config.js. 
This is a hard prerequisite — with or without a preset, the CLI checks for it and fails init if it's missing

## 2. Install Tailwind CSS
//TODO: rewrite instructios synthesize real processes.

shadcn is built on Tailwind utility classes, so Tailwind must exist in frontend/ first. Utilitiy classes are defined in CSS, they serve to define different of the appeareance of the frontend. 

a. run:
```bash
    npm install tailwindcss @tailwindcss/vite
```
b. Add the Tailwind plugin to vite.config.js
TODO: remove/relocate this instruction


c. Import "tailwindcss" in your main CSS file.
TODO: define concretely with an example, probably in SignInForm. 


## 3. Run the shadcn init command with appeareance config
//TODO: rewrite instructions synthesize real processes.


1. Define preset(appearence of web application: colors, fonts and radius)

a. link to define preset(appeareance):
https://ui.shadcn.com/create?preset=b1zfPaHfOq 


b. chosen preset value:
```bash
    --preset b1zfPaHfOq
```

2. From frontend/, run 
```bash
npx shadcn@latest init --preset b1zfPaHfOq --template vite -b base
```
It detects Vite + React + TS, asks the style/CSS-variable questions, and creates components.json plus a src/lib/utils.ts helper.


## 4. Add components one at a time

TODO: prompt gema, to define what is UI and Ui

```bash
npx shadcn@latest add button input label form card
```
Each pulls from the registry already styled according to your preset's CSS variables — you don't re-apply the preset per component

TODO: create components table


## 5. Wire components into existing pages

Swap your plain tags for the copied shadcn versions inside pages like SignInPage.tsx, keeping your react-hook-form logic untouched — shadcn's Input/Button are just styled wrappers around native elements.


## 6. Present Change

Eventually, when preset wants to be updated, use this command

```bash
npx shadcn@latest init --preset <new-code> --force --no-reinstall
```

TODO: verify command, and file permissions in the project, could not change preset with this command 

## Notes:

Claude conversation to have context:
https://claude.ai/share/c5e31bfe-ea22-47cd-8885-6d8bb26fbd55
