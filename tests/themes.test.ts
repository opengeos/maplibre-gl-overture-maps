import { describe, it, expect } from 'vitest';
import {
  THEMES,
  THEME_IDS,
  buildLayerSpecs,
  buildSourceLayerSpecs,
  layerIdsForTheme,
  layerIdsForSourceLayer,
  sourceIdForTheme,
  tileUrlForTheme,
  opacityPropertyForLayerType,
  colorPropertyForLayerType,
  effectiveOpacity,
  FILL_OPACITY_RATIO,
} from '../src/lib/core/themes';
import type { OvertureTheme } from '../src/lib/core/themes';

describe('THEMES', () => {
  it('defines all six Overture themes', () => {
    expect(THEME_IDS).toEqual([
      'addresses',
      'base',
      'buildings',
      'divisions',
      'places',
      'transportation',
    ]);
  });

  it('gives each theme a hex color and at least one layer', () => {
    for (const theme of THEME_IDS) {
      expect(THEMES[theme].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(THEMES[theme].layers.length).toBeGreaterThan(0);
    }
  });

  it('matches the Overture tiles source layers', () => {
    expect(THEMES.addresses.layers.map((l) => l.sourceLayer)).toEqual(['address']);
    expect(THEMES.buildings.layers.map((l) => l.sourceLayer)).toEqual([
      'building',
      'building_part',
    ]);
    expect(THEMES.places.layers.map((l) => l.sourceLayer)).toEqual(['place']);
    expect(THEMES.transportation.layers.map((l) => l.sourceLayer)).toEqual([
      'segment',
      'connector',
    ]);
    expect(THEMES.divisions.layers.map((l) => l.sourceLayer)).toContain('division_boundary');
    expect(THEMES.base.layers.map((l) => l.sourceLayer)).toEqual(
      expect.arrayContaining(['land', 'land_cover', 'land_use', 'water', 'infrastructure'])
    );
  });
});

describe('sourceIdForTheme / tileUrlForTheme', () => {
  it('builds the source id', () => {
    expect(sourceIdForTheme('buildings')).toBe('overture-buildings');
  });

  it('builds the pmtiles URL', () => {
    expect(tileUrlForTheme('https://tiles.example.com', '2026-05-20.0', 'places')).toBe(
      'pmtiles://https://tiles.example.com/2026-05-20.0/places.pmtiles'
    );
  });

  it('strips trailing slashes from the base URL', () => {
    expect(tileUrlForTheme('https://tiles.example.com/', '2026-05-20.0', 'base')).toBe(
      'pmtiles://https://tiles.example.com/2026-05-20.0/base.pmtiles'
    );
  });
});

describe('buildLayerSpecs', () => {
  it('maps geometry to layer types', () => {
    const placeSpecs = buildLayerSpecs('places', 1);
    expect(placeSpecs).toHaveLength(1);
    expect(placeSpecs[0].type).toBe('circle');

    const buildingSpecs = buildLayerSpecs('buildings', 1);
    // Each polygon layer renders as fill + outline line
    expect(buildingSpecs.map((s) => s.type)).toEqual(['fill', 'line', 'fill', 'line']);

    const transportationSpecs = buildLayerSpecs('transportation', 1);
    expect(transportationSpecs.map((s) => s.type)).toEqual(['line', 'circle']);
  });

  it('targets the theme source and source-layer', () => {
    for (const spec of buildLayerSpecs('divisions', 0.8)) {
      expect(spec).toMatchObject({ source: 'overture-divisions' });
      expect(THEMES.divisions.layers.map((l) => l.sourceLayer)).toContain(
        (spec as { 'source-layer': string })['source-layer']
      );
    }
  });

  it('applies the correct opacity paint property per layer type', () => {
    for (const theme of THEME_IDS) {
      for (const spec of buildLayerSpecs(theme, 0.6)) {
        const paint = spec.paint as Record<string, unknown>;
        const property = opacityPropertyForLayerType(spec.type as 'fill' | 'line' | 'circle');
        expect(paint[property]).toBe(
          effectiveOpacity(spec.type as 'fill' | 'line' | 'circle', 0.6)
        );
      }
    }
  });

  it('keeps fills translucent relative to the theme opacity', () => {
    const [fill] = buildLayerSpecs('buildings', 1);
    expect((fill.paint as Record<string, unknown>)['fill-opacity']).toBeCloseTo(
      FILL_OPACITY_RATIO
    );
  });

  it('honors a color override', () => {
    const specs = buildLayerSpecs('places', 1, '#123456');
    expect((specs[0].paint as Record<string, unknown>)['circle-color']).toBe('#123456');
  });

  it('uses the theme color by default', () => {
    const specs = buildLayerSpecs('places', 1);
    expect((specs[0].paint as Record<string, unknown>)['circle-color']).toBe(
      THEMES.places.color
    );
  });
});

describe('layerIdsForTheme', () => {
  it('round-trips with buildLayerSpecs for all themes', () => {
    for (const theme of THEME_IDS) {
      const ids = layerIdsForTheme(theme);
      const specIds = buildLayerSpecs(theme, 0.5).map((s) => s.id);
      expect(ids).toEqual(specIds);
    }
  });

  it('produces unique ids across all themes', () => {
    const all = THEME_IDS.flatMap((theme: OvertureTheme) => layerIdsForTheme(theme));
    expect(new Set(all).size).toBe(all.length);
  });

  it('prefixes ids with the source id', () => {
    for (const id of layerIdsForTheme('base')) {
      expect(id.startsWith('overture-base-')).toBe(true);
    }
  });
});

describe('opacityPropertyForLayerType', () => {
  it('returns the matching paint property', () => {
    expect(opacityPropertyForLayerType('fill')).toBe('fill-opacity');
    expect(opacityPropertyForLayerType('line')).toBe('line-opacity');
    expect(opacityPropertyForLayerType('circle')).toBe('circle-opacity');
  });
});

describe('colorPropertyForLayerType', () => {
  it('returns the matching paint property', () => {
    expect(colorPropertyForLayerType('fill')).toBe('fill-color');
    expect(colorPropertyForLayerType('line')).toBe('line-color');
    expect(colorPropertyForLayerType('circle')).toBe('circle-color');
  });
});

describe('buildSourceLayerSpecs', () => {
  it('builds specs for a single source layer only', () => {
    const specs = buildSourceLayerSpecs('base', 'water', 0.8);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect((spec as { 'source-layer': string })['source-layer']).toBe('water');
      expect(spec.source).toBe('overture-base');
    }
  });

  it('returns an empty array for an unknown source layer', () => {
    expect(buildSourceLayerSpecs('base', 'not_a_layer', 1)).toEqual([]);
  });

  it('honors a per-layer color override', () => {
    const [fill] = buildSourceLayerSpecs('buildings', 'building', 1, '#abcdef');
    expect((fill.paint as Record<string, unknown>)['fill-color']).toBe('#abcdef');
  });

  it('is a subset of the full theme specs', () => {
    const all = buildLayerSpecs('transportation', 1).map((s) => s.id);
    for (const sl of THEMES.transportation.layers.map((l) => l.sourceLayer)) {
      for (const id of layerIdsForSourceLayer('transportation', sl)) {
        expect(all).toContain(id);
      }
    }
  });
});

describe('layerIdsForSourceLayer', () => {
  it('round-trips with buildSourceLayerSpecs', () => {
    const ids = layerIdsForSourceLayer('divisions', 'division_area');
    const specIds = buildSourceLayerSpecs('divisions', 'division_area', 0.5).map((s) => s.id);
    expect(ids).toEqual(specIds);
  });

  it('partitions a theme into its source layers', () => {
    const perLayer = THEMES.base.layers.flatMap((l) =>
      layerIdsForSourceLayer('base', l.sourceLayer)
    );
    expect(perLayer.sort()).toEqual(layerIdsForTheme('base').sort());
  });
});

describe('effectiveOpacity', () => {
  it('scales fill opacity and passes through line/circle', () => {
    expect(effectiveOpacity('fill', 1)).toBeCloseTo(FILL_OPACITY_RATIO);
    expect(effectiveOpacity('line', 0.7)).toBe(0.7);
    expect(effectiveOpacity('circle', 0.7)).toBe(0.7);
  });
});
