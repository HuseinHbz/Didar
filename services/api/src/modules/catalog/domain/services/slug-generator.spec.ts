import { SlugGenerator } from './slug-generator';

describe('SlugGenerator', () => {
  describe('base', () => {
    it('derives a lowercase, hyphenated slug from a Latin name', () => {
      expect(SlugGenerator.base('Ray-Ban Aviator Classic')).toBe('ray-ban-aviator-classic');
    });

    it('derives a hyphenated Persian slug without transliterating to Latin', () => {
      expect(SlugGenerator.base('عینک آفتابی کلاسیک')).toBe('عینک-آفتابی-کلاسیک');
    });
  });

  describe('withSuffix', () => {
    it('the first attempt returns the base slug unchanged', () => {
      expect(SlugGenerator.withSuffix('ray-ban-aviator', 1)).toBe('ray-ban-aviator');
    });

    it('subsequent attempts append a numeric suffix', () => {
      expect(SlugGenerator.withSuffix('ray-ban-aviator', 2)).toBe('ray-ban-aviator-2');
      expect(SlugGenerator.withSuffix('ray-ban-aviator', 3)).toBe('ray-ban-aviator-3');
    });
  });
});
