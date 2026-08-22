# Dashboard Design Tokens

This document outlines the strict design language established for the Route Weather dashboard, based on the provided visual reference. All tokens and utility classes are configured in `src/index.css` using Tailwind v4 `@theme` and `@utility` directives.

## Color Palette
The dashboard uses a disciplined, near-black color palette with green and red strictly reserved for status indicators.

| Token | CSS Variable | Value | Usage |
| :--- | :--- | :--- | :--- |
| **Background** | `--color-dash-bg` | `#0a0a0b` | Main application background |
| **Surface (Glass)** | `--color-dash-surface` | `rgba(255, 255, 255, 0.05)` | Glass panel backgrounds (`bg-white/5`) |
| **Border** | `--color-dash-border` | `rgba(255, 255, 255, 0.10)` | Glass panel borders (`border-white/10`) |
| **Text Primary** | `--color-dash-text` | `rgba(255, 255, 255, 0.9)` | Standard body text and hero numbers |
| **Text Muted** | `--color-dash-text-muted` | `rgba(255, 255, 255, 0.5)` | Section header labels and secondary text |
| **Status Online** | `--color-dash-status-online` | `#10b981` | Positive/Online indicators ONLY |
| **Status Offline**| `--color-dash-status-offline`| `#ef4444` | Negative/Offline indicators ONLY |

## Locked Spacing Scale
To maintain the disciplined layout, spacing is restricted to multiples of 4/8/16/24px.
* `p-1`, `m-1`, `gap-1` = **4px** (`0.25rem`)
* `p-2`, `m-2`, `gap-2` = **8px** (`0.5rem`)
* `p-4`, `m-4`, `gap-4` = **16px** (`1rem`)
* `p-6`, `m-6`, `gap-6` = **24px** (`1.5rem`)

## Typography Scale
We use specific utility classes for text rather than one-off Tailwind classes to maintain the restrained type scale.

### `text-dash-label`
* **Usage**: Section headers, tiny tracked-out labels
* **Properties**: `11px`, uppercase, `tracking-wide` (0.05em), muted gray
* **Example**: `<h2 className="text-dash-label">Traffic Management</h2>`

### `text-dash-hero`
* **Usage**: Large hero numbers, primary statistics
* **Properties**: `36px`, `font-light` (300 weight), primary white text
* **Example**: `<div className="text-dash-hero">78.3<span className="text-dash-body">%</span></div>`

### `text-dash-body`
* **Usage**: Standard body text, secondary metrics
* **Properties**: `13px`, `font-regular` (400 weight), primary white text
* **Example**: `<p className="text-dash-body">Passenger Load</p>`

## Glass Panel Component (`dash-glass`)
Instead of applying 5-6 utility classes on every panel, use the custom `@utility dash-glass` class.

**Properties included:**
* Background: `bg-white/5`
* Blur: `backdrop-blur-xl` (24px)
* Border: `border border-white/10`
* Radius: `rounded-2xl` (16px)

**Usage Example:**
```tsx
<div className="dash-glass p-4">
  <h3 className="text-dash-label mb-2">Bus 6023</h3>
  {/* Panel Content */}
</div>
```
*Note: Always apply padding (e.g., `p-4` or `p-6`) directly to the element alongside `dash-glass` to ensure consistent spacing.*
