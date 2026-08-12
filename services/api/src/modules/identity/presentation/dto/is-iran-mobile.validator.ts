import { iranMobileSchema } from '@iecp/validation';
import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Reuses the canonical `@iecp/validation` phone schema at the DTO
 * boundary instead of re-deriving the regex — one definition of "valid
 * Iranian mobile number" for the whole monorepo. */
export function IsIranMobile(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isIranMobile',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && iranMobileSchema.safeParse(value).success;
        },
        defaultMessage(): string {
          return 'Invalid Iranian mobile number';
        },
      },
    });
  };
}
