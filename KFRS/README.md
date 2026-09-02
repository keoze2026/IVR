# Kenya Federation of Roller Skating (KFRS) Website

This is the official responsive website for the Kenya Federation of Roller Skating (KFRS), the national governing body for roller sports disciplines in Kenya. The platform is designed to promote, manage, and supervise roller sports from grassroots to elite levels across all counties.

## Project Scope
This website is **EXCLUSIVELY** focused on roller skating disciplines recognized by KFRS, including:
- Inline Speed Skating
- Inline Freestyle
- Inline Hockey
- Artistic Roller Skating
- Roller Derby
- Recreational & Grassroots Roller Skating

## Tech Stack
- **Framework**: React with Vite
- **Language**: TypeScript (Strict Mode)
- **Styling**: Tailwind CSS v4
- **Form Handling**: Client-side validation with Formspree integration (`fetch` API)
- **Icons**: Lucide React

## Features
- **Responsive Design**: Mobile-first approach using Tailwind CSS.
- **Formspree Integration**: Working contact form with error handling and success states.
- **Image Optimization**: All below-the-fold placeholder images use `loading="lazy"`.
- **Placeholder Best Practices**: Centralized placeholder URLs in `constants/assets.ts` with explicit `placehold.co` text to avoid accidental mixed-sport imagery.

## Getting Started

First, install the dependencies:
```bash
npm install
```

Then, run the development server:
```bash
npm run dev
```

To build the production bundle:
```bash
npm run build
```

## Form Integration Note
To connect the contact form to a live Formspree account, update the `FORMSPREE_ENDPOINT` constant in `src/components/contact/ContactSection.tsx`.
