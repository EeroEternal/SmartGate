# SmartGate Design System

## Overview

This document outlines the design principles and UI components for SmartGate, aiming for a consistent, "tech-geek," and clean aesthetic suitable for engineering and enterprise teams.

## Core Principles

1.  **Content First**: The interface should highlight data and functionality over decoration.
2.  **Clarity & Precision**: Use sharp, distinct boundaries. Avoid soft shadows, complex gradients, or overly decorative elements.
3.  **Minimal Rendering**: Keep the DOM and styling lightweight. Stick to flat colors and solid borders.
4.  **Tech-Geek Aesthetic**: Favor high-contrast interfaces, monospaced fonts for technical data (like keys or logs), and a utilitarian layout common in developer tools and management consoles.

## Typography

*   **Primary Font**: System sans-serif (Inter, Roboto, San Francisco) for general UI elements.
*   **Monospace Font**: System monospace (Menlo, Consolas, Courier New) for code snippets, IDs, and API keys.

## Color Palette (Tailwind reference)

*   **Backgrounds**: Pure white (`bg-white`) for main content, off-white/light gray (`bg-zinc-50`) for subtle separation.
*   **Borders**: Solid, subtle borders (`border-zinc-200` or `border-zinc-300`). No glowing effects.
*   **Text**: High contrast (`text-zinc-900` for primary, `text-zinc-600` for secondary).
*   **Primary Action (Accent)**: A solid, distinct color (e.g., pure black `bg-black` or a flat brand color without gradients).
*   **States**:
    *   Hover: Slight darkening or background shift (e.g., `hover:bg-zinc-100`).
    *   Active/Focus: Sharp, solid ring (`focus:ring-2 focus:ring-black focus:outline-none`).

## Components

### Buttons

Buttons must be strictly rectangular with a slight border radius (`rounded-md`). We use three size variants to maintain a consistent rhythm.

**Sizes:**
*   **Default (Medium)**: Used for most actions (modals, standard forms, page headers).
    *   Classes: `px-4 py-2 text-sm`
*   **Large**: Used exclusively for prominent CTAs (e.g., hero sections).
    *   Classes: `px-8 py-3 text-base`
*   **Small**: Used inside dense layouts (e.g., table rows, inline input appendages).
    *   Classes: `px-3 py-1.5 text-sm`

**Variants:**
*   **Primary Button**:
    *   Style: Solid flat background, white text, sharp or slightly rounded corners.
    *   Base Classes: `bg-black text-white font-medium hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black transition-colors rounded-md`
*   **Secondary/Outline Button**:
    *   Style: Transparent background, solid border, dark text.
    *   Base Classes: `bg-transparent border border-zinc-300 text-zinc-900 font-medium hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black transition-colors rounded-md`
*   **Ghost/Icon Button**:
    *   Style: Transparent background, no border, text/icon color changes on hover.
    *   Base Classes: `p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors`

### Modals / Dialogs

*   **Backdrop**: Solid semi-transparent dark background (`bg-black/50`). No blur effects unless necessary for readability.
*   **Panel**: Solid white background, distinct border or very subtle shadow (`bg-white border border-zinc-200 shadow-sm rounded-lg`).
*   **Header**: Clean separation from content, typically with a bottom border.

### Drawers (Side Panels)

*   **Usage**: For quick configuration adjustments (e.g., adjusting weights in a Model Pool) without losing page context.
*   **Animation**: Slide-in from the right, fast transition (`duration-200`).
*   **Style**: Solid white background, full height, distinct left border (`border-l border-zinc-200`).

### Status Indicators

*   **Healthy**: Solid green dot (`bg-emerald-500`) with no glow.
*   **Degraded**: Solid amber dot (`bg-amber-500`).
*   **Unavailable**: Solid red dot (`bg-rose-500`).
*   **Disabled**: Gray dot (`bg-zinc-300`).

### Data Visualization (Tech-Geek Style)

*   **Sparklines**: Simple polyline charts without fills or axes for showing latency/traffic trends in table rows.
*   **Bar Charts**: Flat, solid bars. Use the primary accent color or status colors.
*   **Typography**: Always use the **Monospace Font** for data points, millisecond values, and token counts.

### Inputs

*   **Text Field**: Flat white background, solid border (`bg-white border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black`).

## Interaction Guidelines

*   **Feedback**: Immediate visual feedback on hover and click states using flat color changes.
*   **Animations**: Keep animations minimal and fast (e.g., short transition times `duration-150`, simple fade-ins). Avoid complex physics or bouncy animations.
