import { CategoryHierarchyService, type CategoryNode } from './category-hierarchy';

// Tree used across these tests:
//   root
//   ├── eyewear
//   │   └── sunglasses
//   │       └── aviators
//   └── accessories
const TREE: CategoryNode[] = [
  { id: 'root', parentId: null },
  { id: 'eyewear', parentId: 'root' },
  { id: 'sunglasses', parentId: 'eyewear' },
  { id: 'aviators', parentId: 'sunglasses' },
  { id: 'accessories', parentId: 'root' },
];

describe('CategoryHierarchyService', () => {
  describe('wouldCreateCycle', () => {
    it('a category cannot become its own parent', () => {
      expect(CategoryHierarchyService.wouldCreateCycle(TREE, 'eyewear', 'eyewear')).toBe(true);
    });

    it('a category cannot become a child of its own descendant', () => {
      // eyewear -> sunglasses -> aviators; making eyewear a child of aviators
      // (its own grandchild) would create a cycle.
      expect(CategoryHierarchyService.wouldCreateCycle(TREE, 'eyewear', 'aviators')).toBe(true);
    });

    it('a category CAN become a child of its own current ancestor (no cycle, just a re-parent)', () => {
      expect(CategoryHierarchyService.wouldCreateCycle(TREE, 'aviators', 'root')).toBe(false);
    });

    it('moving a category under an unrelated branch is never a cycle', () => {
      expect(CategoryHierarchyService.wouldCreateCycle(TREE, 'sunglasses', 'accessories')).toBe(
        false,
      );
    });

    it('a leaf category can never create a cycle (nothing is its descendant)', () => {
      expect(CategoryHierarchyService.wouldCreateCycle(TREE, 'aviators', 'accessories')).toBe(
        false,
      );
    });
  });

  describe('depthOf', () => {
    it('a root category has depth 0', () => {
      expect(CategoryHierarchyService.depthOf(TREE, 'root')).toBe(0);
    });

    it('depth increases by one per level', () => {
      expect(CategoryHierarchyService.depthOf(TREE, 'eyewear')).toBe(1);
      expect(CategoryHierarchyService.depthOf(TREE, 'sunglasses')).toBe(2);
      expect(CategoryHierarchyService.depthOf(TREE, 'aviators')).toBe(3);
    });

    it('throws for an unknown category id', () => {
      expect(() => CategoryHierarchyService.depthOf(TREE, 'does-not-exist')).toThrow();
    });
  });
});
