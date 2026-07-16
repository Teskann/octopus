import type { Style } from "../types";

// Bundled caption fonts (scripts/fetch-fonts.sh) + families already installed on
// this machine (fontconfig). All resolve in both the preview and the export.
const BUNDLED_FONTS = ["Anton", "Bebas Neue", "Oswald", "Montserrat"];
const SYSTEM_FONTS = [
  "DejaVu Sans",
  "Lexend Deca",
  "Space Grotesk",
  "Ubuntu",
  "Lato",
  "Open Sans",
  "IBM Plex Sans",
  "Liberation Sans",
  "Noto Serif",
];

export function StylePanel({
  style,
  onChange,
}: {
  style: Style;
  onChange: (patch: Partial<Style>) => void;
}) {
  const set = <K extends keyof Style>(key: K, value: Style[K]) =>
    onChange({ [key]: value } as Partial<Style>);

  return (
    <div className="style-panel">
      <h3>Style des sous-titres</h3>

      <label className="row">
        Police
        <select value={style.font} onChange={(e) => set("font", e.target.value)}>
          <optgroup label="Incluses (TikTok)">
            {BUNDLED_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
                {f}
              </option>
            ))}
          </optgroup>
          <optgroup label="Système">
            {SYSTEM_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
                {f}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label className="row">
        Taille : {style.font_size}px
        <input
          type="range" min={8} max={140} value={style.font_size}
          onChange={(e) => set("font_size", Number(e.target.value))}
        />
      </label>

      <div className="two">
        <label className="row">
          Largeur max des lignes : {style.max_line_width_pct}%
          <input
            type="range" min={30} max={100} value={style.max_line_width_pct}
            onChange={(e) => set("max_line_width_pct", Number(e.target.value))}
          />
        </label>
        <label className="row">
          Lignes max : {style.max_lines}
          <input
            type="range" min={1} max={4} value={style.max_lines}
            onChange={(e) => set("max_lines", Number(e.target.value))}
          />
        </label>
      </div>

      <label className="row">
        Position
        <select
          value={style.position}
          onChange={(e) => set("position", e.target.value as Style["position"])}
        >
          <option value="top">Haut</option>
          <option value="middle">Milieu</option>
          <option value="bottom">Bas</option>
        </select>
      </label>

      <label className="row">
        Marge : {style.margin_v}px
        <input
          type="range" min={0} max={700} value={style.margin_v}
          onChange={(e) => set("margin_v", Number(e.target.value))}
        />
      </label>

      <div className="colors">
        <label>
          Texte
          <input type="color" value={style.primary_color}
            onChange={(e) => set("primary_color", e.target.value)} />
        </label>
        <label>
          Mot actif
          <input type="color" value={style.highlight_color}
            onChange={(e) => set("highlight_color", e.target.value)} />
        </label>
        <label>
          Contour
          <input type="color" value={style.outline_color}
            onChange={(e) => set("outline_color", e.target.value)} />
        </label>
        <label>
          Traduction
          <input type="color" value={style.translation_color}
            onChange={(e) => set("translation_color", e.target.value)} />
        </label>
      </div>

      <label className="row checkbox">
        <input
          type="checkbox" checked={style.highlight_enabled}
          onChange={(e) => set("highlight_enabled", e.target.checked)}
        />
        Surligner le mot en cours
      </label>

      <label className="row">
        Contour : {style.outline_width}px
        <input
          type="range" min={0} max={16} value={style.outline_width}
          disabled={style.box_enabled}
          onChange={(e) => set("outline_width", Number(e.target.value))}
        />
      </label>

      <label className="row checkbox">
        <input
          type="checkbox" checked={style.box_enabled}
          onChange={(e) => set("box_enabled", e.target.checked)}
        />
        Fond (boîte) derrière le texte
      </label>

      {style.box_enabled && (
        <div className="box-controls">
          <div className="two">
            <label className="row">
              Couleur du fond
              <input type="color" value={style.box_color}
                onChange={(e) => set("box_color", e.target.value)} />
            </label>
            <label className="row">
              Opacité : {Math.round(style.box_opacity * 100)}%
              <input
                type="range" min={0} max={1} step={0.05} value={style.box_opacity}
                onChange={(e) => set("box_opacity", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="row">
            Coins arrondis : {style.box_radius}px
            <input
              type="range" min={0} max={60} value={style.box_radius}
              onChange={(e) => set("box_radius", Number(e.target.value))}
            />
          </label>
          <div className="two">
            <label className="row">
              Marge horizontale : {style.box_padding_x}px
              <input
                type="range" min={0} max={80} value={style.box_padding_x}
                onChange={(e) => set("box_padding_x", Number(e.target.value))}
              />
            </label>
            <label className="row">
              Marge verticale : {style.box_padding_y}px
              <input
                type="range" min={0} max={60} value={style.box_padding_y}
                onChange={(e) => set("box_padding_y", Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      )}

      <div className="two">
        <label className="row">
          Taille traduction : {Math.round(style.translation_scale * 100)}%
          <input
            type="range" min={0.3} max={1} step={0.05} value={style.translation_scale}
            onChange={(e) => set("translation_scale", Number(e.target.value))}
          />
        </label>
        <label className="row">
          Position traduction
          <select
            value={style.translation_position}
            onChange={(e) =>
              set("translation_position", e.target.value as Style["translation_position"])
            }
          >
            <option value="below">Sous le texte</option>
            <option value="above">Au-dessus</option>
          </select>
        </label>
      </div>

      <label className="row checkbox">
        <input
          type="checkbox" checked={style.uppercase}
          onChange={(e) => set("uppercase", e.target.checked)}
        />
        MAJUSCULES
      </label>
    </div>
  );
}
