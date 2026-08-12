import { AttributeValueValidator, InvalidAttributeValueError } from './attribute-value-validator';

describe('AttributeValueValidator', () => {
  describe('assertBelongsToAttribute', () => {
    it('does not throw when the value belongs to the expected attribute', () => {
      expect(() => {
        AttributeValueValidator.assertBelongsToAttribute(
          { id: 'value-1', attributeId: 'attr-frame-shape' },
          'attr-frame-shape',
        );
      }).not.toThrow();
    });

    it('throws when the value belongs to a different attribute', () => {
      expect(() => {
        AttributeValueValidator.assertBelongsToAttribute(
          { id: 'value-1', attributeId: 'attr-frame-shape' },
          'attr-frame-material',
        );
      }).toThrow(InvalidAttributeValueError);
    });
  });

  describe('assertNoDuplicateAttributes', () => {
    it('does not throw when every attribute appears at most once', () => {
      expect(() => {
        AttributeValueValidator.assertNoDuplicateAttributes([
          { attributeId: 'attr-frame-shape' },
          { attributeId: 'attr-frame-material' },
        ]);
      }).not.toThrow();
    });

    it('throws when the same attribute is assigned twice', () => {
      expect(() => {
        AttributeValueValidator.assertNoDuplicateAttributes([
          { attributeId: 'attr-frame-shape' },
          { attributeId: 'attr-frame-shape' },
        ]);
      }).toThrow(InvalidAttributeValueError);
    });
  });
});
