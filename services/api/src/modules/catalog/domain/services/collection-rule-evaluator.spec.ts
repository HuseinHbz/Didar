import type { CollectionRules } from '@iecp/types';

import { CollectionRuleEvaluator, type EvaluableProduct } from './collection-rule-evaluator';

const AVIATOR: EvaluableProduct = {
  brandId: 'brand-ray-ban',
  categoryId: 'category-sunglasses',
  tags: ['classic', 'metal-frame'],
  gender: 'UNISEX',
  productType: 'SUNGLASSES',
};

describe('CollectionRuleEvaluator', () => {
  it('an empty rule bag matches everything', () => {
    expect(CollectionRuleEvaluator.matches({}, AVIATOR)).toBe(true);
  });

  it('matches when every specified field agrees', () => {
    const rules: CollectionRules = { brandId: 'brand-ray-ban', productType: 'SUNGLASSES' };
    expect(CollectionRuleEvaluator.matches(rules, AVIATOR)).toBe(true);
  });

  it('rejects when any specified scalar field disagrees', () => {
    expect(CollectionRuleEvaluator.matches({ brandId: 'brand-oakley' }, AVIATOR)).toBe(false);
    expect(CollectionRuleEvaluator.matches({ categoryId: 'category-frames' }, AVIATOR)).toBe(false);
    expect(CollectionRuleEvaluator.matches({ gender: 'KIDS' }, AVIATOR)).toBe(false);
    expect(CollectionRuleEvaluator.matches({ productType: 'EYEGLASSES' }, AVIATOR)).toBe(false);
  });

  it('tags match on ANY overlap, not requiring every listed tag', () => {
    expect(CollectionRuleEvaluator.matches({ tags: ['classic', 'polarized'] }, AVIATOR)).toBe(true);
  });

  it('rejects when none of the requested tags are present', () => {
    expect(CollectionRuleEvaluator.matches({ tags: ['polarized', 'kids'] }, AVIATOR)).toBe(false);
  });

  it('combines multiple fields with AND semantics', () => {
    const matching: CollectionRules = { brandId: 'brand-ray-ban', tags: ['classic'] };
    const nonMatching: CollectionRules = { brandId: 'brand-ray-ban', tags: ['kids'] };
    expect(CollectionRuleEvaluator.matches(matching, AVIATOR)).toBe(true);
    expect(CollectionRuleEvaluator.matches(nonMatching, AVIATOR)).toBe(false);
  });
});
