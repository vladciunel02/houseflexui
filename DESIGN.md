# HomeFlex în myPPC: Design System (`DESIGN.md`)

Source of truth for the visual layer of **HomeFlex în myPPC**, modeled on PPC Energie România (`ppcenergy.ro`). Every component in `src/` consumes CSS variables from `src/styles/tokens.css` with zero inline hex values.

---

## 1. Brand, Scope & Client Language

- **Product context**: Single-client prosumer page inside **myPPC** for one consumption place (`Str. Fabricii 12, București`, `10 kWh` battery). No fleet view, no map, no trading desk jargon.
- **Wordmark**: `HomeFlex` (`18px`, weight `700`), next to it `în myPPC` (`15px`, weight `400`, `var(--color-on-dark-secondary)`). Never use the PPC logo file, icon marks next to the wordmark, or third-party battery/car brand shapes or names.
- **Footer**: `"Concept HomeFlex pentru clienții PPC. Date simulate."`
- **Client language only**: `lei`, `lei/kWh`, hours (`HH:MM`), percentages (`%`), `kWh` (and live instantaneous `kW` on the 3D house overlay). Never show `P10`, `P50`, `P90`, `"agregat"`, `"strategie"`, `"flotă"`, `"MaxControl"`, or `"Fabrică"` in the UI.

---

## 2. Color System (Strictly 4 Hues: Neutrals, Blue, Yellow, Red-Orange)

All colors live in `src/styles/tokens.css`. No hex literals are permitted anywhere else in `src/`.

### Neutrals
| Token | Value | Role |
| --- | --- | --- |
| `--color-text` | `#0D0D0D` | Primary text, active controls, `1.5px` `"acum"` line, 3D scene values |
| `--color-text-secondary` | `rgba(13, 13, 13, 0.62)` | Secondary copy, row labels, 3D scene captions |
| `--color-text-tertiary` | `rgba(13, 13, 13, 0.45)` | Axis hour ticks, `1px` leader lines, disabled controls |
| `--color-grid-sell` | `rgba(13, 13, 13, 0.10)` | `"Vinde surplusul"` band fill (`#0D0D0D` at `10%`) in the `"Rețeaua"` row |
| `--color-page` | `#F2F3F5` | Application page background |
| `--color-surface` | `#FFFFFF` | Tooltip background, 3D battery casing, hemisphere sky light |
| `--color-hairline` | `#E2E4E8` | `1px` dividers, positive price cell borders, `"Ține"` battery band fill, `"Așteaptă"` / `"Cumpără"` band outlines |
| `--color-dark-block` | `#0D0D0D` | Top bar, `"acum"` time badge, and fixed bottom-right `"Controale demo"` bar |
| `--color-inactive` | `#94989B` | Neutral 3D grid cable pulse |
| `--color-on-dark` | `#FFFFFF` | Text on `#0D0D0D` top bar, `"acum"` badge, `"Controale demo"`, and `#163FE8` blue bands |
| `--color-on-dark-secondary` | `rgba(255, 255, 255, 0.7)` | `"în myPPC"`, consumption address in top bar, and secondary demo labels |

### Chromatic Data Tokens (Semantic & Contrast-Safe)
| Hue | Token | Value | Exclusive Role |
| --- | --- | --- | --- |
| **Blue** | `--color-blue` | `#163FE8` | HomeFlex & battery: `"Încarcă din soare"` band & `12px` mobile swatch, active tab underline, 3D battery LED, 3D battery cable pulse, focus ring |
| **Blue tint** | `--color-blue-tint` | `#B9C5F8` | `"Folosește în casă"` battery band & `12px` mobile swatch |
| **Yellow (fill)** | `--color-yellow` | `#FFC502` | **Solar only**: `8px` solar indicator square before `Solar` 3D label, 3D solar cable pulse |
| **Solar text** | `--solar-text` | `#0D0D0D` | **Solar text on light backgrounds**: `Solar` value in the 3D scene |
| **Red-orange (fill)** | `--color-negative` | `#FF6447` | **Negative-price fills only**: 3D grid export cable pulse at negative price |
| **Red-orange 18%** | `--color-negative-18` | `rgba(255, 100, 71, 0.18)` | **Negative-price segment fill**: negative cells in `"Preț, lei/kWh"` and `"Trimite fără plată"` in `"Rețeaua"` |
| **Negative text** | `--negative-price-text` | `#C9361C` | **Negative-price text on light backgrounds**: negative values in `"Preț, lei/kWh"`, `"Trimite fără plată"`, `Rețea` 3D price, and `"Acum"` / `"Pe scurt"` copy |

### 3D White Architectural Model Tokens
| Token | Value | Role |
| --- | --- | --- |
| `--model-wall` | `#F7F7F8` | Matte house and garage walls (`roughness >= 0.85`) |
| `--model-roof` | `#E3E6EA` | Matte gabled and garage roofs, hemisphere ground bounce (`roughness >= 0.85`) |
| `--model-trim` | `#D3D7DD` | Matte window/door frames, closed garage door panels, meter box, utility post (`roughness >= 0.85`) |
| `--model-panel` | `#1B2440` | Dark solar PV cells on roof (`roughness 0.4`, the only dark element on the model) |
| `--model-cable` | `#C9CED6` | Base cable conduit tube material |

---

## 3. Typography & Copy Rules

- **Typeface**: `@fontsource/figtree` weights `400`, `500`, `700` (`--font-sans`).
- **Numeric alignment**: `font-variant-numeric: tabular-nums` on every live value, clock, price segment, axis label, and savings line.
- **Case & tracking**: Sentence case everywhere, default tracking, minimum font size **`13px`**.
- **Type scale**:
  - Lead sentence & money headline: `28px/500` (`700` on numbers and `+X,XX lei azi`)
  - Scene values: `28px/500` (`18px/500` on `<= 860px` mobile stage)
  - Section title & wordmark: `18px/700`
  - Body, `"Pe scurt"`, & buttons: `15px/400` (`500` on buttons, `700` on current `"Pe scurt"` sentence)
  - Labels, tooltips, axis ticks, price segments: `13px/500`
- **Romanian formatting**: comma decimals (`0,30`, `−0,10`), dot thousands, 24h time (`12:30`), space before units (`7,0 kWh`, `63 %`, `+2,34 lei`). No emoji, no em dashes.

---

## 4. Layout, Surfaces & Button Hierarchy (`1440px` Desktop & `390px` Mobile)

- **Surfaces**: The page background is `--color-page` (`#F2F3F5`). Content sits directly on the page separated only by spacing and `1px` `--color-hairline` dividers. Dark `#0D0D0D` blocks are used only for the **Top bar** and the visually separate **Demo controls** bar in the bottom-right corner.
- **First row**:
  - **Desktop (`1440px`)**: `58%` left 3D house stage + `42%` right column (`"Acum"`, `"Bani"`, and `"Anulează decizia de azi"`).
  - **Mobile (`390px`)**: Single column with `"Acum"` first, the 3D house stage directly under `"Acum"` at `320px` height, then `"Bani"` and `"Anulează decizia de azi"`, with zero horizontal scroll.
- **Buttons**:
  1. **Primary** (`8px` radius, `#0D0D0D` fill, `#FFFFFF` text): `"Confirmă"` inside the inline cancel confirmation (at most one primary button on screen).
  2. **Secondary** (`8px` radius, `1px solid #0D0D0D`, transparent fill): `"Anulează decizia de azi"` (the client's single action).
  3. **Tertiary** (text only, underline on hover): `"Renunță"`, `"Reactivează acum"`, `"Resetează vederea"`, `"Compară cu bateria fără HomeFlex"`.

---

## 5. `"Planul bateriei"` (Desktop Timeline & Mobile `"Pe scurt"`)

- **Tabs**: `"Azi"` and `"Mâine"`. Before `14:00`, `"Mâine"` shows only: `"Planul pentru mâine apare la 14:00, după ce se publică prețurile."` From `14:00`, it shows tomorrow's plan.
- **Desktop (`05:00–24:00`, ticks `06 09 12 15 18 21 24`)**:
  1. `"Preț, lei/kWh"` (`32px`): merged price segments; negative segments filled with `--color-negative-18` and `--negative-price-text`.
  2. `"Bateria"` (`44px`): `"Încarcă din soare"` (`--color-blue`), `"Folosește în casă"` (`--color-blue-tint`), `"Ține"` (`--color-hairline`), `"Așteaptă"` (`1px` `--color-hairline` outline). Inline text when `>= 72px` wide.
  3. `"Rețeaua"` (`40px`): `"Vinde surplusul"` (`--color-grid-sell`, `"Vinde · +0,30"`), `"Trimite fără plată"` (`--color-negative-18`), `"Cumpără"` (`1px` `--color-hairline` outline with price), `"Nimic"` empty.
  - `1.5px` `--color-text` `"acum"` vertical line across all rows on **`"Azi"` only**.
  - Segment hover tooltip displays interval, what happens, `kWh`, and `lei`.
- **`"Pe scurt"`**:
  - Desktop: 3 to 5 plain sentences under the rows; current segment's sentence on `"Azi"` in **`700` weight**.
  - Mobile `390px`: no SVG time axis; `"Pe scurt"` renders each main segment as a hairline row with a `12px` colored battery-action square, time range, price, and sentence.
- **Comparison toggle**: Tertiary `"Compară cu bateria fără HomeFlex"` adds `"Bateria"` and `"Rețeaua"` rows for `"Fără HomeFlex"` at `55%` opacity under a `"Fără HomeFlex"` label, plus `"Diferența: +X,XX lei azi"`.

---

## 6. Do Not List

- NEVER use inline hex colors outside `src/styles/tokens.css`.
- NEVER show `P10`, `P50`, `P90`, `"agregat"`, `"strategie"`, `"flotă"`, `"MaxControl"`, or `"Fabrică"` in UI strings.
- NEVER use gradients, `box-shadow`, `blur(`, `Bloom`, `Inter`, `uppercase`, `letter-spacing > 0.01em`, font-size `< 13px`, emoji, em dashes, spring/bounce easing, or `transition: all`.
