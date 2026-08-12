export class InvalidAttributeValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAttributeValueError';
  }
}

/**
 * Pure guard for assigning an admin-defined attribute value to a variant:
 * the value must actually belong to the attribute being assigned (no
 * cross-attribute mix-ups), and a variant can't carry the same attribute
 * twice with different values.
 */
export class AttributeValueValidator {
  static assertBelongsToAttribute(
    value: { id: string; attributeId: string },
    expectedAttributeId: string,
  ): void {
    if (value.attributeId !== expectedAttributeId) {
      throw new InvalidAttributeValueError(
        `Attribute value ${value.id} does not belong to attribute ${expectedAttributeId}`,
      );
    }
  }

  static assertNoDuplicateAttributes(assignments: readonly { attributeId: string }[]): void {
    const seen = new Set<string>();
    for (const assignment of assignments) {
      if (seen.has(assignment.attributeId)) {
        throw new InvalidAttributeValueError(
          `Attribute ${assignment.attributeId} assigned more than once to the same variant`,
        );
      }
      seen.add(assignment.attributeId);
    }
  }
}
