# Design System Specification: The Blueprint Editorial

## 1. Overview & Creative North Star
### Creative North Star: "The Architectural Blueprint"
This design system moves away from the sterile, pixel-perfect gloss of modern SaaS and instead embraces the raw, intentional energy of an architect's workspace. It is a "High-End Draft"—an aesthetic that values the structural honesty of a hand-drawn sketch while maintaining the precision of a luxury editorial publication. 

By pairing a low-fidelity paper aesthetic with a sophisticated, high-contrast palette of deep navies and light aquas, we create a "Digital Atelier" experience. We break the template look through **intentional asymmetry**, using extreme "0px" sharpness to evoke the cut edge of heavy cardstock, and utilizing typography as a structural element rather than just a medium for information.

---

## 2. Colors: Tonal Architecture
The palette transitions from the depth of a moonless night (`#0D1317`) to the technical clarity of architectural vellum (`#f5faff`).

### Surface Hierarchy & Nesting
Forget shadows as a primary depth indicator. In this system, depth is chronological and physical, achieved through **Tonal Layering**:
*   **The Canvas (`surface` #f5faff):** The base level. Everything begins here.
*   **The Foundation (`surface_container_low` #eff4fa):** Used for large secondary regions or sidebars.
*   **The Focal Point (`surface_container_highest` #dde3e9):** Reserved for active workspace areas or primary content containers.

### The "No-Line" Rule
Traditional 1px borders are strictly prohibited for layout sectioning. To separate content, you must use a background color shift (e.g., a `surface_container_low` sidebar against a `surface` main body). 

### The "Glass & Blueprint" Rule
To add a layer of premium "soul," use **Glassmorphism** for floating elements (like Modals or floating Action Menus). Use a semi-transparent `surface_container_lowest` (#ffffff) with a 20px backdrop-blur. This mimics the look of tracing paper overlaid on a technical drawing.

### Signature Textures
Main CTAs and Hero accents should utilize a subtle linear gradient from `primary` (#00051e) to `primary_container` (#101d42). This provides a "carbon ink" depth that flat hex codes cannot replicate.

---

## 3. Typography: The Draftsman’s Script
Typography is our primary "high-fidelity" signal. We use **Space Grotesk** for structural elements and **Inter** for narrative elements.

*   **Display & Headlines (Space Grotesk):** These are your architectural beams. They should feel massive, authoritative, and slightly "technical." Use `display-lg` (3.5rem) with tight letter-spacing to create an editorial impact.
*   **Body & Titles (Inter):** These represent the "annotations." Clean, highly legible, and neutral. `body-lg` (1rem) is the workhorse for all descriptive content.
*   **Labels (Inter):** Small-caps or high-contrast labels in `label-md` (0.75rem) using the `secondary` (#116871) color function as technical callouts on a blueprint.

---

## 4. Elevation & Depth
In a world of "rounded everything," this system stands apart with **Hard Edges (0px radius)**.

*   **The Layering Principle:** Stacking is the new shadowing. Place a `surface_container_lowest` (#ffffff) card on top of a `surface_container` (#e9eef4) background to create a crisp, "cut-paper" lift.
*   **Ambient Shadows:** If a component must float (e.g., a dropdown), use an ultra-diffused shadow: `box-shadow: 0 20px 40px rgba(13, 19, 23, 0.06)`. The tint must match the `on_surface` charcoal, never pure black.
*   **The "Ghost Border" Fallback:** For accessibility in forms, use the `outline_variant` (#c6c6cf) at 20% opacity. It should look like a faint pencil guideline, not a structural wall.

---

## 5. Components: Technical Primitives

### Buttons: The Bold Stamp
*   **Primary:** Solid `primary` (#00051e) background, `on_primary` (#ffffff) text. 0px radius. High-contrast.
*   **Secondary:** Ghost style. `outline` (#76767f) 1px border with `primary` text. No background fill unless hovered.
*   **Interaction:** On hover, primary buttons should shift to `secondary` (#116871) to provide a "chemical" aqua glow.

### Input Fields: The Draft Line
*   **Styling:** No background fill. A single bottom border (2px) using `primary_container` (#101d42). 
*   **States:** Error states use `error` (#ba1a1a) with a subtle `error_container` highlight behind the text to mimic a red-pen correction.

### Cards & Lists: The White Space Method
*   **Constraint:** Zero dividers. Use vertical white space (32px or 48px) to separate list items.
*   **Selection:** A selected list item should transition its background to `secondary_fixed_dim` (#89d2dc) at 10% opacity, looking like a light highlighter stroke.

### Specialized Component: The "Blueprint Overlay"
A unique modal style: A full-screen `primary_container` (#101d42) at 90% opacity with `surface_bright` text. This creates a high-impact, focused environment for complex tasks.

---

## 6. Do's and Don'ts

### Do:
*   **DO** use asymmetric layouts. Align text to the left but allow imagery or secondary containers to bleed off the right edge of the grid.
*   **DO** use `secondary_fixed_dim` (#89d2dc) for accents like text underlines, bullets, or small icons. It should look like a cyan technical pencil.
*   **DO** embrace the "0px" radius everywhere. Sharpness equals precision.

### Don't:
*   **DON'T** use 1px solid borders for boxes. It breaks the "architectural" flow and feels like a generic template.
*   **DON'T** use soft, rounded corners. If it's not sharp, it doesn't belong in this system.
*   **DON'T** use generic grey shadows. Use tonal layering or very faint, charcoal-tinted ambient blurs.
*   **DON'T** clutter. If a section feels cramped, increase the white space by 1.5x. This system lives and breathes on negative space.